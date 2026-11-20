-- Painel do ateliê, etapa 4: etiqueta Melhor Envio, rastreio e e-mail.
--
-- Rodar o arquivo inteiro de uma vez, no SQL editor do projeto foveo-loja
-- (bbksditqlgdjftwowtje), depois de ler. Não usar `supabase db push`.
--
-- O que muda:
--   * pedidos ganha me_order_id, me_protocolo, rastreio, me_status,
--     me_preco_centavos e etiqueta_em.
--   * pedido_status_historico aceita origem melhor_envio (a tela lê
--     "Melhor Envio").
--   * pedido_emails guarda o evento já enviado, um por pedido.
--   * admin_registrar_etiqueta (is_admin) grava a etiqueta. Status vira
--     etiqueta_gerada só quando há id do Melhor Envio e código de rastreio,
--     e o pedido ainda está pago.
--   * aplicar_evento_melhor_envio, só service_role: postagem vira enviado,
--     entrega vira entregue. Retirada e cancelamento não são mexidos.
--   * reservar/confirmar/liberar e-mail, só service_role. anon não ganha
--     GRANT em tabela nem função.
--
-- O que não muda:
--   * anon continua sem leitura de pedidos.
--   * Sandro ainda troca status à mão por admin_alterar_status_pedido.

-- ── colunas da etiqueta ────────────────────────────────────────────────

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS me_order_id text,
  ADD COLUMN IF NOT EXISTS me_protocolo text,
  ADD COLUMN IF NOT EXISTS rastreio text,
  ADD COLUMN IF NOT EXISTS me_status text,
  ADD COLUMN IF NOT EXISTS me_preco_centavos integer,
  ADD COLUMN IF NOT EXISTS etiqueta_em timestamptz;

ALTER TABLE public.pedidos
  DROP CONSTRAINT IF EXISTS pedidos_me_order_id_fmt,
  DROP CONSTRAINT IF EXISTS pedidos_rastreio_fmt,
  DROP CONSTRAINT IF EXISTS pedidos_me_status_fmt,
  DROP CONSTRAINT IF EXISTS pedidos_me_preco_centavos_check,
  DROP CONSTRAINT IF EXISTS pedidos_me_protocolo_fmt;

ALTER TABLE public.pedidos
  ADD CONSTRAINT pedidos_me_order_id_fmt
    CHECK (me_order_id IS NULL OR me_order_id ~ '^[A-Za-z0-9-]{8,64}$'),
  ADD CONSTRAINT pedidos_rastreio_fmt
    CHECK (rastreio IS NULL OR rastreio ~ '^[A-Za-z0-9]{4,40}$'),
  ADD CONSTRAINT pedidos_me_status_fmt
    CHECK (me_status IS NULL OR char_length(me_status) <= 40),
  ADD CONSTRAINT pedidos_me_preco_centavos_check
    CHECK (me_preco_centavos IS NULL OR me_preco_centavos >= 0),
  ADD CONSTRAINT pedidos_me_protocolo_fmt
    CHECK (me_protocolo IS NULL OR char_length(me_protocolo) <= 40);

CREATE UNIQUE INDEX IF NOT EXISTS pedidos_me_order_id_uidx
  ON public.pedidos (me_order_id)
  WHERE me_order_id IS NOT NULL;

COMMENT ON COLUMN public.pedidos.me_order_id IS
  'Id da etiqueta no Melhor Envio.';
COMMENT ON COLUMN public.pedidos.rastreio IS
  'Código de rastreio da transportadora, só letras e números.';
COMMENT ON COLUMN public.pedidos.me_status IS
  'Status cru da etiqueta no Melhor Envio (pending, released, generated, posted, delivered).';
COMMENT ON COLUMN public.pedidos.me_preco_centavos IS
  'Quanto a etiqueta custou no saldo do Melhor Envio, em centavos.';
COMMENT ON COLUMN public.pedidos.etiqueta_em IS
  'Quando a etiqueta foi comprada e o rastreio gravado.';

-- ── origem Melhor Envio no histórico ───────────────────────────────────

ALTER TABLE public.pedido_status_historico
  DROP CONSTRAINT IF EXISTS pedido_status_historico_origem_check;

ALTER TABLE public.pedido_status_historico
  ADD CONSTRAINT pedido_status_historico_origem_check
  CHECK (
    origem = ANY (ARRAY[
      'admin'::text,
      'webhook'::text,
      'sistema'::text,
      'reembolso'::text,
      'mp_ja_reembolsado'::text,
      'melhor_envio'::text
    ])
  );

-- ── e-mails já enviados ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.pedido_emails (
  pedido_id uuid NOT NULL REFERENCES public.pedidos (id) ON DELETE CASCADE,
  evento text NOT NULL,
  enviado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (pedido_id, evento),
  CONSTRAINT pedido_emails_evento_check
    CHECK (evento = ANY (ARRAY[
      'pagamento_confirmado'::text,
      'enviado'::text,
      'entregue'::text,
      'pronto_retirada'::text
    ]))
);

COMMENT ON TABLE public.pedido_emails IS
  'Um envio por evento. enviado_em nulo é reserva em andamento, não e-mail saído.';

ALTER TABLE public.pedido_emails ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.pedido_emails FROM PUBLIC, anon, authenticated;

-- ── admin: gravar etiqueta ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_registrar_etiqueta(
  p_pedido_id uuid,
  p_me_order_id text,
  p_protocolo text,
  p_rastreio text,
  p_me_status text,
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
  novo_rastreio text;
  novo_status text;
  v_protocolo text;
  v_me_status text;
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
  novo_rastreio := COALESCE(NULLIF(pg_catalog.btrim(COALESCE(p_rastreio, '')), ''), ped.rastreio);
  v_protocolo := NULLIF(pg_catalog.btrim(COALESCE(p_protocolo, '')), '');
  v_me_status := NULLIF(pg_catalog.left(pg_catalog.btrim(COALESCE(p_me_status, '')), 40), '');

  IF novo_id IS NOT NULL AND novo_id !~ '^[A-Za-z0-9-]{8,64}$' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'etiqueta_invalida');
  END IF;
  IF novo_rastreio IS NOT NULL AND novo_rastreio !~ '^[A-Za-z0-9]{4,40}$' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'rastreio_invalido');
  END IF;
  IF p_preco_centavos IS NOT NULL AND p_preco_centavos < 0 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'preco_invalido');
  END IF;
  IF ped.me_order_id IS NOT NULL AND novo_id IS DISTINCT FROM ped.me_order_id THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'etiqueta_diferente');
  END IF;

  novo_status := ped.status;
  IF ped.status = 'pago' AND novo_id IS NOT NULL AND novo_rastreio IS NOT NULL THEN
    novo_status := 'etiqueta_gerada';
  END IF;

  UPDATE public.pedidos
  SET
    me_order_id = novo_id,
    me_protocolo = COALESCE(v_protocolo, me_protocolo),
    rastreio = novo_rastreio,
    me_status = COALESCE(v_me_status, me_status),
    me_preco_centavos = COALESCE(p_preco_centavos, me_preco_centavos),
    etiqueta_em = CASE
      WHEN novo_status = 'etiqueta_gerada' AND etiqueta_em IS NULL THEN pg_catalog.now()
      ELSE etiqueta_em
    END,
    status = novo_status
  WHERE id = ped.id;

  IF novo_status IS DISTINCT FROM ped.status THEN
    INSERT INTO public.pedido_status_historico (pedido_id, status, origem)
    VALUES (ped.id, novo_status, 'melhor_envio');
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'status', novo_status,
    'rastreio', novo_rastreio,
    'me_order_id', novo_id
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'etiqueta_duplicada');
END;
$fn$;

COMMENT ON FUNCTION public.admin_registrar_etiqueta(uuid, text, text, text, text, integer) IS
  'Grava a etiqueta do Melhor Envio. Exige is_admin(). Etiqueta gerada só com id e rastreio, a partir de pago.';

REVOKE ALL ON FUNCTION public.admin_registrar_etiqueta(uuid, text, text, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_registrar_etiqueta(uuid, text, text, text, text, integer) TO authenticated;

-- ── webhook: postado e entregue ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.aplicar_evento_melhor_envio(
  p_me_order_id text,
  p_evento text,
  p_rastreio text,
  p_me_status text,
  p_protocolo text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  ped public.pedidos%ROWTYPE;
  evento text;
  v_rastreio text;
  alvo text;
  v_email text;
  v_me_status text;
  v_protocolo text;
BEGIN
  IF p_me_order_id IS NULL OR p_me_order_id !~ '^[A-Za-z0-9-]{8,64}$' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'invalido');
  END IF;

  evento := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_evento, '')));
  v_me_status := NULLIF(pg_catalog.left(pg_catalog.btrim(COALESCE(p_me_status, '')), 40), '');
  v_protocolo := NULLIF(pg_catalog.left(pg_catalog.btrim(COALESCE(p_protocolo, '')), 40), '');
  v_rastreio := NULLIF(pg_catalog.btrim(COALESCE(p_rastreio, '')), '');
  IF v_rastreio IS NOT NULL AND v_rastreio !~ '^[A-Za-z0-9]{4,40}$' THEN
    v_rastreio := NULL;
  END IF;

  SELECT *
  INTO ped
  FROM public.pedidos
  WHERE me_order_id = p_me_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', true, 'ausente', true);
  END IF;

  IF v_rastreio IS NULL THEN
    v_rastreio := ped.rastreio;
  END IF;

  alvo := ped.status;
  v_email := NULL;

  IF ped.status NOT IN (
    'cancelado',
    'reembolsado',
    'expirado',
    'recusado',
    'pendente',
    'pronto_retirada',
    'retirado'
  ) THEN
    IF evento = 'order.posted' AND ped.status IN ('pago', 'etiqueta_gerada') THEN
      alvo := 'enviado';
      v_email := 'enviado';
    ELSIF evento = 'order.delivered' AND ped.status IN ('pago', 'etiqueta_gerada', 'enviado') THEN
      alvo := 'entregue';
      v_email := 'entregue';
    ELSIF evento IN ('order.generated', 'order.released')
      AND ped.status = 'pago'
      AND v_rastreio IS NOT NULL
    THEN
      alvo := 'etiqueta_gerada';
    END IF;
  END IF;

  UPDATE public.pedidos
  SET
    rastreio = v_rastreio,
    me_status = COALESCE(v_me_status, me_status),
    me_protocolo = COALESCE(v_protocolo, me_protocolo),
    etiqueta_em = CASE
      WHEN alvo = 'etiqueta_gerada' AND etiqueta_em IS NULL THEN pg_catalog.now()
      ELSE etiqueta_em
    END,
    status = alvo
  WHERE id = ped.id;

  IF alvo IS DISTINCT FROM ped.status THEN
    INSERT INTO public.pedido_status_historico (pedido_id, status, origem)
    VALUES (ped.id, alvo, 'melhor_envio');
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'pedido_id', ped.id,
    'status', alvo,
    'mudou', alvo IS DISTINCT FROM ped.status,
    'email', v_email
  );
END;
$fn$;

COMMENT ON FUNCTION public.aplicar_evento_melhor_envio(text, text, text, text, text) IS
  'Aplica postagem e entrega do Melhor Envio. Só service_role. Não mexe em retirada nem em pedido cancelado.';

REVOKE ALL ON FUNCTION public.aplicar_evento_melhor_envio(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aplicar_evento_melhor_envio(text, text, text, text, text) TO service_role;

-- ── reserva do e-mail, para não mandar duas vezes ──────────────────────

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

  IF existente.created_at < pg_catalog.now() - interval '2 minutes' THEN
    UPDATE public.pedido_emails
    SET created_at = pg_catalog.now()
    WHERE pedido_id = ped.id
      AND evento = p_evento
      AND enviado_em IS NULL;
    RETURN pg_catalog.jsonb_build_object('ok', true, 'pode', true, 'ja', false);
  END IF;

  RETURN pg_catalog.jsonb_build_object('ok', true, 'pode', false, 'ja', false, 'em_andamento', true);
END;
$fn$;

COMMENT ON FUNCTION public.reservar_email_cliente(uuid, text) IS
  'Reserva o envio de um evento. Só service_role. pode=false e ja=true significa que o e-mail já saiu.';

REVOKE ALL ON FUNCTION public.reservar_email_cliente(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reservar_email_cliente(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.confirmar_email_cliente(
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
  SET enviado_em = pg_catalog.now()
  WHERE pedido_id = p_pedido_id
    AND evento = p_evento
    AND enviado_em IS NULL;

  RETURN pg_catalog.jsonb_build_object('ok', true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.confirmar_email_cliente(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirmar_email_cliente(uuid, text) TO service_role;

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
  DELETE FROM public.pedido_emails
  WHERE pedido_id = p_pedido_id
    AND evento = p_evento
    AND enviado_em IS NULL;

  RETURN pg_catalog.jsonb_build_object('ok', true);
END;
$fn$;

COMMENT ON FUNCTION public.liberar_email_cliente(uuid, text) IS
  'Solta a reserva se o SMTP falhou, para a próxima tentativa poder enviar.';

REVOKE ALL ON FUNCTION public.liberar_email_cliente(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liberar_email_cliente(uuid, text) TO service_role;
