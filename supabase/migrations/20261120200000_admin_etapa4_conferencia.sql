-- Etapa 4, complemento: trava da compra, conferência e limite do rastreio.
--
-- Rodar o arquivo inteiro no SQL editor, depois de
-- 20261120180000_admin_etapa4_envio.sql. Não usar `supabase db push`.
--
-- O que muda:
--   * admin_reservar_compra_etiqueta trava os pedidos (FOR UPDATE) e marca
--     me_status = comprando, com tentativa e hora, antes do carrinho.
--   * admin_gravar_carrinho_etiqueta grava o id do Melhor Envio como
--     pendente assim que o item entra no carrinho, antes do checkout.
--   * admin_liberar_compra_etiqueta só solta a trava se a tentativa é a
--     nossa e nada foi comprado (ou o Melhor Envio confirmou que não pagou).
--   * admin_marcar_conferencia_etiqueta deixa precisa_conferir, que bloqueia
--     outra compra porque o me_order_id continua preenchido.
--   * pedido_emails.falhou_em marca a tentativa que quebrou. A reserva só
--     é considerada abandonada depois de 15 minutos.
--   * rastreio_falhas limita consulta errada: 5 por código por hora e 20
--     por IP por hora. anon e authenticated não leem a tabela.

-- ── trava da compra ────────────────────────────────────────────────────

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS etiqueta_tentativa uuid,
  ADD COLUMN IF NOT EXISTS etiqueta_tentativa_em timestamptz;

COMMENT ON COLUMN public.pedidos.etiqueta_tentativa IS
  'Tentativa de compra da etiqueta. Enquanto estiver comprando, outra chamada não entra no carrinho.';

CREATE OR REPLACE FUNCTION public.admin_reservar_compra_etiqueta(
  p_pedido_ids uuid[],
  p_tentativa uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  alvo uuid;
  ped public.pedidos%ROWTYPE;
  reservados jsonb := pg_catalog.jsonb_build_array();
  pulados jsonb := pg_catalog.jsonb_build_array();
  motivo text;
BEGIN
  IF NOT (SELECT public.is_admin()) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'nao_autorizado');
  END IF;
  IF p_tentativa IS NULL OR p_pedido_ids IS NULL OR pg_catalog.cardinality(p_pedido_ids) > 40 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'invalido');
  END IF;

  FOREACH alvo IN ARRAY p_pedido_ids LOOP
    motivo := NULL;
    SELECT *
    INTO ped
    FROM public.pedidos
    WHERE id = alvo
    FOR UPDATE;

    IF NOT FOUND THEN
      motivo := 'nao_encontrado';
    ELSIF ped.teste THEN
      motivo := 'teste';
    ELSIF ped.entrega_tipo IS DISTINCT FROM 'envio' THEN
      motivo := 'retirada';
    ELSIF ped.status IS DISTINCT FROM 'pago' THEN
      motivo := 'status';
    ELSIF ped.me_order_id IS NOT NULL THEN
      motivo := 'ja_tem_etiqueta';
    ELSIF ped.me_status = 'comprando'
      AND ped.etiqueta_tentativa IS DISTINCT FROM p_tentativa
      AND ped.etiqueta_tentativa_em IS NOT NULL
      AND ped.etiqueta_tentativa_em > pg_catalog.now() - interval '15 minutes'
    THEN
      motivo := 'em_compra';
    END IF;

    IF motivo IS NOT NULL THEN
      pulados := pulados || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('id', alvo, 'motivo', motivo)
      );
      CONTINUE;
    END IF;

    UPDATE public.pedidos
    SET
      me_status = 'comprando',
      etiqueta_tentativa = p_tentativa,
      etiqueta_tentativa_em = pg_catalog.now()
    WHERE id = alvo;

    reservados := reservados || pg_catalog.jsonb_build_array(pg_catalog.to_jsonb(alvo));
  END LOOP;

  RETURN pg_catalog.jsonb_build_object('ok', true, 'reservados', reservados, 'pulados', pulados);
END;
$fn$;

COMMENT ON FUNCTION public.admin_reservar_compra_etiqueta(uuid[], uuid) IS
  'Trava pedidos pagos sem etiqueta. Exige is_admin(). Quem já tem me_order_id ou compra em andamento fica de fora.';

REVOKE ALL ON FUNCTION public.admin_reservar_compra_etiqueta(uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reservar_compra_etiqueta(uuid[], uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_gravar_carrinho_etiqueta(
  p_pedido_id uuid,
  p_tentativa uuid,
  p_me_order_id text,
  p_protocolo text,
  p_preco_centavos integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  ped public.pedidos%ROWTYPE;
  novo_id text;
BEGIN
  IF NOT (SELECT public.is_admin()) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'nao_autorizado');
  END IF;

  SELECT *
  INTO ped
  FROM public.pedidos
  WHERE id = p_pedido_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'nao_encontrado');
  END IF;
  IF ped.etiqueta_tentativa IS DISTINCT FROM p_tentativa THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'tentativa');
  END IF;

  novo_id := NULLIF(pg_catalog.btrim(COALESCE(p_me_order_id, '')), '');
  IF novo_id IS NULL OR novo_id !~ '^[A-Za-z0-9-]{8,64}$' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'etiqueta_invalida');
  END IF;
  IF ped.me_order_id IS NOT NULL AND ped.me_order_id IS DISTINCT FROM novo_id THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'etiqueta_diferente');
  END IF;
  IF p_preco_centavos IS NOT NULL AND p_preco_centavos < 0 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'preco_invalido');
  END IF;

  UPDATE public.pedidos
  SET
    me_order_id = novo_id,
    me_protocolo = COALESCE(NULLIF(pg_catalog.btrim(COALESCE(p_protocolo, '')), ''), me_protocolo),
    me_preco_centavos = COALESCE(p_preco_centavos, me_preco_centavos),
    me_status = 'pendente'
  WHERE id = ped.id;

  RETURN pg_catalog.jsonb_build_object('ok', true, 'me_order_id', novo_id, 'me_status', 'pendente');
EXCEPTION
  WHEN unique_violation THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'etiqueta_duplicada');
END;
$fn$;

COMMENT ON FUNCTION public.admin_gravar_carrinho_etiqueta(uuid, uuid, text, text, integer) IS
  'Grava o id do carrinho como pendente, antes do checkout. Exige a tentativa que reservou o pedido.';

REVOKE ALL ON FUNCTION public.admin_gravar_carrinho_etiqueta(uuid, uuid, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_gravar_carrinho_etiqueta(uuid, uuid, text, text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_liberar_compra_etiqueta(
  p_pedido_id uuid,
  p_tentativa uuid,
  p_nada_comprado boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  ped public.pedidos%ROWTYPE;
BEGIN
  IF NOT (SELECT public.is_admin()) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'nao_autorizado');
  END IF;

  SELECT *
  INTO ped
  FROM public.pedidos
  WHERE id = p_pedido_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'nao_encontrado');
  END IF;
  IF ped.etiqueta_tentativa IS DISTINCT FROM p_tentativa THEN
    IF NOT (
      p_tentativa IS NULL
      AND p_nada_comprado IS TRUE
      AND ped.me_order_id IS NOT NULL
      AND ped.me_status IN ('pendente', 'precisa_conferir')
    ) THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'tentativa');
    END IF;
  END IF;
  IF ped.me_order_id IS NOT NULL AND p_nada_comprado IS DISTINCT FROM true THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'pode_ter_comprado');
  END IF;

  UPDATE public.pedidos
  SET
    me_order_id = NULL,
    me_protocolo = NULL,
    me_status = NULL,
    me_preco_centavos = NULL,
    etiqueta_tentativa = NULL,
    etiqueta_tentativa_em = NULL
  WHERE id = ped.id
    AND (
      etiqueta_tentativa IS NOT DISTINCT FROM p_tentativa
      OR (
        p_tentativa IS NULL
        AND me_status IN ('pendente', 'precisa_conferir')
      )
    );

  RETURN pg_catalog.jsonb_build_object('ok', true);
END;
$fn$;

COMMENT ON FUNCTION public.admin_liberar_compra_etiqueta(uuid, uuid, boolean) IS
  'Solta a trava só da tentativa atual. Com me_order_id, só se p_nada_comprado for true.';

REVOKE ALL ON FUNCTION public.admin_liberar_compra_etiqueta(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_liberar_compra_etiqueta(uuid, uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_marcar_conferencia_etiqueta(
  p_pedido_id uuid,
  p_me_order_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  ped public.pedidos%ROWTYPE;
  novo_id text;
BEGIN
  IF NOT (SELECT public.is_admin()) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'nao_autorizado');
  END IF;

  SELECT *
  INTO ped
  FROM public.pedidos
  WHERE id = p_pedido_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'nao_encontrado');
  END IF;

  novo_id := COALESCE(NULLIF(pg_catalog.btrim(COALESCE(p_me_order_id, '')), ''), ped.me_order_id);
  IF novo_id IS NULL OR novo_id !~ '^[A-Za-z0-9-]{8,64}$' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'etiqueta_invalida');
  END IF;
  IF ped.me_order_id IS NOT NULL AND ped.me_order_id IS DISTINCT FROM novo_id THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'etiqueta_diferente');
  END IF;

  UPDATE public.pedidos
  SET
    me_order_id = novo_id,
    me_status = 'precisa_conferir'
  WHERE id = ped.id;

  RETURN pg_catalog.jsonb_build_object('ok', true, 'me_status', 'precisa_conferir', 'me_order_id', novo_id);
END;
$fn$;

COMMENT ON FUNCTION public.admin_marcar_conferencia_etiqueta(uuid, text) IS
  'Marca a etiqueta como precisa conferir. O id permanece, então uma compra nova não entra.';

REVOKE ALL ON FUNCTION public.admin_marcar_conferencia_etiqueta(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_marcar_conferencia_etiqueta(uuid, text) TO authenticated;

-- ── e-mail: falha explícita e janela mais longa ────────────────────────

ALTER TABLE public.pedido_emails
  ADD COLUMN IF NOT EXISTS falhou_em timestamptz;

COMMENT ON COLUMN public.pedido_emails.falhou_em IS
  'A tentativa quebrou. A próxima reserva pode enviar de novo. Não é e-mail saído.';

CREATE OR REPLACE FUNCTION public.reservar_email_cliente(
  p_pedido_id uuid,
  p_evento text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  ped public.pedidos%ROWTYPE;
  existente public.pedido_emails%ROWTYPE;
  inseriu uuid;
  entrega text;
BEGIN
  IF p_evento IS NULL OR p_evento NOT IN (
    'pagamento_confirmado',
    'enviado',
    'entregue',
    'pronto_retirada'
  ) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'evento');
  END IF;

  SELECT *
  INTO ped
  FROM public.pedidos
  WHERE id = p_pedido_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'nao_encontrado');
  END IF;

  entrega := CASE WHEN ped.entrega_tipo = 'retirada' THEN 'retirada' ELSE 'envio' END;

  IF p_evento = 'pagamento_confirmado' AND ped.status NOT IN (
    'pago', 'etiqueta_gerada', 'enviado', 'entregue', 'pronto_retirada', 'retirado'
  ) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'status');
  END IF;
  IF p_evento = 'enviado' AND (entrega <> 'envio' OR ped.status NOT IN ('enviado', 'entregue')) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'status');
  END IF;
  IF p_evento = 'entregue' AND (entrega <> 'envio' OR ped.status <> 'entregue') THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'status');
  END IF;
  IF p_evento = 'pronto_retirada' AND (entrega <> 'retirada' OR ped.status NOT IN ('pronto_retirada', 'retirado')) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'status');
  END IF;

  INSERT INTO public.pedido_emails (pedido_id, evento)
  VALUES (ped.id, p_evento)
  ON CONFLICT (pedido_id, evento) DO NOTHING
  RETURNING pedido_id INTO inseriu;

  IF inseriu IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', true, 'pode', true, 'ja', false);
  END IF;

  SELECT *
  INTO existente
  FROM public.pedido_emails
  WHERE pedido_id = ped.id
    AND evento = p_evento
  FOR UPDATE;

  IF existente.enviado_em IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', true, 'pode', false, 'ja', true);
  END IF;

  IF existente.falhou_em IS NOT NULL
    OR existente.created_at < pg_catalog.now() - interval '15 minutes'
  THEN
    UPDATE public.pedido_emails
    SET
      falhou_em = NULL,
      created_at = pg_catalog.now()
    WHERE pedido_id = ped.id
      AND evento = p_evento
      AND enviado_em IS NULL;
    RETURN pg_catalog.jsonb_build_object('ok', true, 'pode', true, 'ja', false);
  END IF;

  RETURN pg_catalog.jsonb_build_object('ok', true, 'pode', false, 'ja', false, 'em_andamento', true);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.liberar_email_cliente(
  p_pedido_id uuid,
  p_evento text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
BEGIN
  UPDATE public.pedido_emails
  SET falhou_em = pg_catalog.now()
  WHERE pedido_id = p_pedido_id
    AND evento = p_evento
    AND enviado_em IS NULL;

  RETURN pg_catalog.jsonb_build_object('ok', true, 'falhou', true);
END;
$fn$;

COMMENT ON FUNCTION public.liberar_email_cliente(uuid, text) IS
  'Marca a tentativa como falha. Não apaga a linha. A próxima reserva pode enviar.';

-- ── limite da página de rastreio ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.rastreio_falhas (
  chave text PRIMARY KEY,
  falhas integer NOT NULL,
  janela_inicio timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT rastreio_falhas_falhas_check CHECK (falhas >= 0),
  CONSTRAINT rastreio_falhas_chave_fmt CHECK (chave ~ '^[ci]:[A-Za-z0-9.:_-]{1,80}$')
);

COMMENT ON TABLE public.rastreio_falhas IS
  'Falhas de consulta pública. c: código do pedido, i: IP. Só service_role.';

ALTER TABLE public.rastreio_falhas ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.rastreio_falhas FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bloqueio_rastreio(
  p_codigo text,
  p_ip text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  codigo text;
  ip text;
  falhas_codigo integer := 0;
  falhas_ip integer := 0;
  inicio_codigo timestamptz;
  inicio_ip timestamptz;
BEGIN
  codigo := pg_catalog.btrim(COALESCE(p_codigo, ''));
  ip := pg_catalog.left(pg_catalog.btrim(COALESCE(p_ip, '')), 64);
  IF codigo !~ '^[0-9]{9}$' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'invalido');
  END IF;
  IF ip = '' OR ip !~ '^[A-Za-z0-9.:_-]+$' THEN
    ip := 'sem-ip';
  END IF;

  SELECT falhas, janela_inicio
  INTO falhas_codigo, inicio_codigo
  FROM public.rastreio_falhas
  WHERE chave = 'c:' || codigo;

  SELECT falhas, janela_inicio
  INTO falhas_ip, inicio_ip
  FROM public.rastreio_falhas
  WHERE chave = 'i:' || ip;

  IF inicio_codigo IS NULL OR inicio_codigo < pg_catalog.now() - interval '1 hour' THEN
    falhas_codigo := 0;
  END IF;
  IF inicio_ip IS NULL OR inicio_ip < pg_catalog.now() - interval '1 hour' THEN
    falhas_ip := 0;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'bloqueado', falhas_codigo >= 5 OR falhas_ip >= 20
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.anotar_falha_rastreio(
  p_codigo text,
  p_ip text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  codigo text;
  ip text;
  bloqueado boolean := false;
BEGIN
  codigo := pg_catalog.btrim(COALESCE(p_codigo, ''));
  ip := pg_catalog.left(pg_catalog.btrim(COALESCE(p_ip, '')), 64);
  IF codigo !~ '^[0-9]{9}$' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'invalido');
  END IF;
  IF ip = '' OR ip !~ '^[A-Za-z0-9.:_-]+$' THEN
    ip := 'sem-ip';
  END IF;

  INSERT INTO public.rastreio_falhas (chave, falhas, janela_inicio)
  VALUES ('c:' || codigo, 1, pg_catalog.now())
  ON CONFLICT (chave) DO UPDATE
  SET
    falhas = CASE
      WHEN public.rastreio_falhas.janela_inicio < pg_catalog.now() - interval '1 hour' THEN 1
      ELSE public.rastreio_falhas.falhas + 1
    END,
    janela_inicio = CASE
      WHEN public.rastreio_falhas.janela_inicio < pg_catalog.now() - interval '1 hour' THEN pg_catalog.now()
      ELSE public.rastreio_falhas.janela_inicio
    END;

  INSERT INTO public.rastreio_falhas (chave, falhas, janela_inicio)
  VALUES ('i:' || ip, 1, pg_catalog.now())
  ON CONFLICT (chave) DO UPDATE
  SET
    falhas = CASE
      WHEN public.rastreio_falhas.janela_inicio < pg_catalog.now() - interval '1 hour' THEN 1
      ELSE public.rastreio_falhas.falhas + 1
    END,
    janela_inicio = CASE
      WHEN public.rastreio_falhas.janela_inicio < pg_catalog.now() - interval '1 hour' THEN pg_catalog.now()
      ELSE public.rastreio_falhas.janela_inicio
    END;

  SELECT (c.falhas >= 5 OR i.falhas >= 20)
  INTO bloqueado
  FROM public.rastreio_falhas AS c
  JOIN public.rastreio_falhas AS i ON true
  WHERE c.chave = 'c:' || codigo
    AND i.chave = 'i:' || ip;

  RETURN pg_catalog.jsonb_build_object('ok', true, 'bloqueado', COALESCE(bloqueado, false));
END;
$fn$;

COMMENT ON FUNCTION public.bloqueio_rastreio(text, text) IS
  'Diz se o código ou o IP já passou do limite nesta hora. Só service_role.';
COMMENT ON FUNCTION public.anotar_falha_rastreio(text, text) IS
  'Conta uma consulta que não achou o pedido. 5 por código e 20 por IP, por hora.';

REVOKE ALL ON FUNCTION public.bloqueio_rastreio(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.anotar_falha_rastreio(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bloqueio_rastreio(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.anotar_falha_rastreio(text, text) TO service_role;
