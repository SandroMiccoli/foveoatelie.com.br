-- Painel do ateliê, etapa 2: pedidos completos.
--
-- Rodar o arquivo inteiro de uma vez, no SQL editor do projeto foveo-loja
-- (bbksditqlgdjftwowtje), depois de ler. Não usar `supabase db push`: o
-- remoto tem migrations de 18/11/2026 que não estão neste repositório.
--
-- O que muda:
--   * pedidos: cliente_cpf, notas_internas, estoque_restaurado_em,
--     forma_pagamento, mp_taxa_centavos, mp_liquido_centavos,
--     mp_liberacao_em. CPF e dados do Mercado Pago ficam opcionais
--     (checkout da etapa 4 / retorno futuro).
--   * status aceitos: mantém pendente/pago/expirado/recusado/cancelado/
--     enviado/entregue e acrescenta etiqueta_gerada, pronto_retirada,
--     retirado, reembolsado. No painel, pendente aparece como
--     "Aguardando pagamento" — o checkout e o webhook continuam
--     gravando pendente.
--   * public.pedido_status_historico com RLS só para is_admin().
--   * RPCs SECURITY DEFINER com search_path travado e is_admin():
--     admin_alterar_status_pedido (cancela e devolve estoque sem
--     duplicar), admin_confirmar_reembolso (só depois do Mercado Pago
--     confirmar, chamada pela Edge Function), admin_apagar_pedido_teste
--     (exige teste = true), admin_salvar_notas_pedido.
--
-- O que não muda:
--   * anon sem GRANT em pedidos, histórico, estoque ou RPCs.
--   * criar-pedido, aplicar_retorno_mp, expirar_reservas e o webhook.
--   * service_role continua com bypass de RLS.

-- ── colunas ────────────────────────────────────────────────────────────

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS cliente_cpf text,
  ADD COLUMN IF NOT EXISTS notas_internas text,
  ADD COLUMN IF NOT EXISTS estoque_restaurado_em timestamptz,
  ADD COLUMN IF NOT EXISTS forma_pagamento text,
  ADD COLUMN IF NOT EXISTS mp_taxa_centavos integer,
  ADD COLUMN IF NOT EXISTS mp_liquido_centavos integer,
  ADD COLUMN IF NOT EXISTS mp_liberacao_em timestamptz;

ALTER TABLE public.pedidos
  DROP CONSTRAINT IF EXISTS pedidos_cliente_cpf_fmt,
  DROP CONSTRAINT IF EXISTS pedidos_mp_taxa_centavos_check,
  DROP CONSTRAINT IF EXISTS pedidos_mp_liquido_centavos_check;

ALTER TABLE public.pedidos
  ADD CONSTRAINT pedidos_cliente_cpf_fmt
    CHECK (
      cliente_cpf IS NULL
      OR cliente_cpf ~ '^[0-9]{11}$'
    ),
  ADD CONSTRAINT pedidos_mp_taxa_centavos_check
    CHECK (mp_taxa_centavos IS NULL OR mp_taxa_centavos >= 0),
  ADD CONSTRAINT pedidos_mp_liquido_centavos_check
    CHECK (mp_liquido_centavos IS NULL OR mp_liquido_centavos >= 0);

COMMENT ON COLUMN public.pedidos.cliente_cpf IS
  'CPF só dígitos. Opcional até a coleta no checkout (etapa 4).';
COMMENT ON COLUMN public.pedidos.notas_internas IS
  'Anotações só do ateliê. Não saem para a cliente.';
COMMENT ON COLUMN public.pedidos.estoque_restaurado_em IS
  'Quando o estoque deste pedido já foi devolvido. Evita devolução duplicada em cancelamento ou reembolso.';
COMMENT ON COLUMN public.pedidos.forma_pagamento IS
  'Forma de pagamento salva do retorno do Mercado Pago, quando houver.';
COMMENT ON COLUMN public.pedidos.mp_taxa_centavos IS
  'Taxa do Mercado Pago em centavos, quando salva.';
COMMENT ON COLUMN public.pedidos.mp_liquido_centavos IS
  'Valor líquido recebido em centavos, quando salvo.';
COMMENT ON COLUMN public.pedidos.mp_liberacao_em IS
  'Data de liberação do valor no Mercado Pago, quando salva.';

ALTER TABLE public.pedidos
  DROP CONSTRAINT IF EXISTS pedidos_status_check;

ALTER TABLE public.pedidos
  ADD CONSTRAINT pedidos_status_check
  CHECK (status = ANY (ARRAY[
    'pendente'::text,
    'pago'::text,
    'etiqueta_gerada'::text,
    'enviado'::text,
    'entregue'::text,
    'pronto_retirada'::text,
    'retirado'::text,
    'expirado'::text,
    'recusado'::text,
    'cancelado'::text,
    'reembolsado'::text
  ]));

-- ── histórico de status ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.pedido_status_historico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id uuid NOT NULL REFERENCES public.pedidos (id) ON DELETE CASCADE,
  status text NOT NULL,
  origem text NOT NULL DEFAULT 'sistema',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pedido_status_historico_status_check
    CHECK (status = ANY (ARRAY[
      'pendente'::text,
      'pago'::text,
      'etiqueta_gerada'::text,
      'enviado'::text,
      'entregue'::text,
      'pronto_retirada'::text,
      'retirado'::text,
      'expirado'::text,
      'recusado'::text,
      'cancelado'::text,
      'reembolsado'::text
    ])),
  CONSTRAINT pedido_status_historico_origem_check
    CHECK (
      origem = ANY (ARRAY[
        'admin'::text,
        'webhook'::text,
        'sistema'::text,
        'reembolso'::text
      ])
    )
);

CREATE INDEX IF NOT EXISTS pedido_status_historico_pedido_created_idx
  ON public.pedido_status_historico (pedido_id, created_at ASC);

COMMENT ON TABLE public.pedido_status_historico IS
  'Mudanças de status do pedido. Só o admin lê; a escrita passa pelas RPCs.';

ALTER TABLE public.pedido_status_historico ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pedido_status_historico_admin_leitura ON public.pedido_status_historico;
CREATE POLICY pedido_status_historico_admin_leitura
  ON public.pedido_status_historico
  FOR SELECT
  TO authenticated
  USING ((SELECT public.is_admin()));

REVOKE ALL ON TABLE public.pedido_status_historico FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.pedido_status_historico TO authenticated;

-- Pedidos que já existem entram no histórico com o status atual.
INSERT INTO public.pedido_status_historico (pedido_id, status, origem, created_at)
SELECT p.id, p.status, 'sistema', p.created_at
FROM public.pedidos AS p
WHERE NOT EXISTS (
  SELECT 1
  FROM public.pedido_status_historico AS h
  WHERE h.pedido_id = p.id
);

-- ── estoque: devolver sem duplicar ─────────────────────────────────────

CREATE OR REPLACE FUNCTION private.restaurar_estoque_pedido(ped public.pedidos)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  item jsonb;
  pid text;
  qtd integer;
BEGIN
  IF ped.estoque_restaurado_em IS NOT NULL THEN
    RETURN false;
  END IF;

  -- Já cancelado/expirado/recusado/reembolsado: a reserva (ou a baixa)
  -- já saiu. Só marca o carimbo se ainda não havia.
  IF ped.status IN ('cancelado', 'expirado', 'recusado', 'reembolsado') THEN
    UPDATE public.pedidos
    SET estoque_restaurado_em = pg_catalog.now()
    WHERE id = ped.id
      AND estoque_restaurado_em IS NULL;
    RETURN false;
  END IF;

  IF ped.status = 'pendente' THEN
    FOR item IN
      SELECT value
      FROM pg_catalog.jsonb_array_elements(ped.itens) AS t(value)
      ORDER BY value->>'produto_id'
    LOOP
      pid := item->>'produto_id';
      IF item->>'qtd' !~ '^[0-9]+$' THEN
        CONTINUE;
      END IF;
      qtd := (item->>'qtd')::integer;
      UPDATE public.estoque
      SET reservado = GREATEST(reservado - qtd, 0)
      WHERE produto_id = pid;
    END LOOP;
  ELSIF ped.status IN (
    'pago',
    'etiqueta_gerada',
    'enviado',
    'entregue',
    'pronto_retirada',
    'retirado'
  ) THEN
    FOR item IN
      SELECT value
      FROM pg_catalog.jsonb_array_elements(ped.itens) AS t(value)
      ORDER BY value->>'produto_id'
    LOOP
      pid := item->>'produto_id';
      IF item->>'qtd' !~ '^[0-9]+$' THEN
        CONTINUE;
      END IF;
      qtd := (item->>'qtd')::integer;
      UPDATE public.estoque
      SET disponivel = disponivel + qtd
      WHERE produto_id = pid;
    END LOOP;
  ELSE
    RETURN false;
  END IF;

  UPDATE public.pedidos
  SET estoque_restaurado_em = pg_catalog.now()
  WHERE id = ped.id;

  RETURN true;
END;
$fn$;

REVOKE ALL ON FUNCTION private.restaurar_estoque_pedido(public.pedidos) FROM PUBLIC;

-- ── admin: mudar status (cancela e devolve estoque) ────────────────────

CREATE OR REPLACE FUNCTION public.admin_alterar_status_pedido(
  p_pedido_id uuid,
  p_status text,
  p_origem text DEFAULT 'admin'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  ped public.pedidos%ROWTYPE;
  origem text;
BEGIN
  IF NOT (SELECT public.is_admin()) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'nao_autorizado');
  END IF;

  IF p_status IS NULL OR p_status NOT IN (
    'pendente',
    'pago',
    'etiqueta_gerada',
    'enviado',
    'entregue',
    'pronto_retirada',
    'retirado',
    'expirado',
    'recusado',
    'cancelado',
    'reembolsado'
  ) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'status_invalido');
  END IF;

  -- Reembolso só pela Edge Function (Mercado Pago primeiro).
  IF p_status = 'reembolsado' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'use_reembolso');
  END IF;

  origem := COALESCE(NULLIF(pg_catalog.btrim(p_origem), ''), 'admin');
  IF origem NOT IN ('admin', 'webhook', 'sistema', 'reembolso') THEN
    origem := 'admin';
  END IF;

  SELECT *
  INTO ped
  FROM public.pedidos
  WHERE id = p_pedido_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'nao_encontrado');
  END IF;

  IF ped.status = p_status THEN
    RETURN pg_catalog.jsonb_build_object('ok', true, 'status', ped.status, 'ja', true);
  END IF;

  IF p_status = 'cancelado' THEN
    PERFORM private.restaurar_estoque_pedido(ped);
  END IF;

  UPDATE public.pedidos
  SET status = p_status
  WHERE id = ped.id;

  INSERT INTO public.pedido_status_historico (pedido_id, status, origem)
  VALUES (ped.id, p_status, origem);

  RETURN pg_catalog.jsonb_build_object('ok', true, 'status', p_status);
END;
$fn$;

COMMENT ON FUNCTION public.admin_alterar_status_pedido(uuid, text, text) IS
  'Troca o status do pedido. Exige is_admin(). Em cancelado, devolve o estoque uma vez.';

REVOKE ALL ON FUNCTION public.admin_alterar_status_pedido(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_alterar_status_pedido(uuid, text, text) TO authenticated;

-- ── admin: confirmar reembolso depois do Mercado Pago ──────────────────

CREATE OR REPLACE FUNCTION public.admin_confirmar_reembolso(
  p_pedido_id uuid
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

  IF ped.status = 'reembolsado' THEN
    RETURN pg_catalog.jsonb_build_object('ok', true, 'status', 'reembolsado', 'ja', true);
  END IF;

  PERFORM private.restaurar_estoque_pedido(ped);

  UPDATE public.pedidos
  SET status = 'reembolsado'
  WHERE id = ped.id;

  INSERT INTO public.pedido_status_historico (pedido_id, status, origem)
  VALUES (ped.id, 'reembolsado', 'reembolso');

  RETURN pg_catalog.jsonb_build_object('ok', true, 'status', 'reembolsado');
END;
$fn$;

COMMENT ON FUNCTION public.admin_confirmar_reembolso(uuid) IS
  'Marca reembolsado e devolve estoque. Só depois do Mercado Pago confirmar. Exige is_admin().';

REVOKE ALL ON FUNCTION public.admin_confirmar_reembolso(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_confirmar_reembolso(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_confirmar_reembolso(uuid) TO service_role;

-- ── admin: apagar só pedido de teste ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_apagar_pedido_teste(
  p_pedido_id uuid
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

  IF ped.teste IS NOT TRUE THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'nao_teste');
  END IF;

  PERFORM private.restaurar_estoque_pedido(ped);

  DELETE FROM public.pedidos
  WHERE id = ped.id
    AND teste IS TRUE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'nao_teste');
  END IF;

  RETURN pg_catalog.jsonb_build_object('ok', true, 'apagado', true);
END;
$fn$;

COMMENT ON FUNCTION public.admin_apagar_pedido_teste(uuid) IS
  'Apaga pedido só se teste = true e is_admin(). Pedido real nunca some por aqui.';

REVOKE ALL ON FUNCTION public.admin_apagar_pedido_teste(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_apagar_pedido_teste(uuid) TO authenticated;

-- ── admin: notas internas ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_salvar_notas_pedido(
  p_pedido_id uuid,
  p_notas text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  notas text;
BEGIN
  IF NOT (SELECT public.is_admin()) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'nao_autorizado');
  END IF;

  notas := COALESCE(p_notas, '');
  IF char_length(notas) > 4000 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'notas_longas');
  END IF;

  UPDATE public.pedidos
  SET notas_internas = NULLIF(notas, '')
  WHERE id = p_pedido_id;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'nao_encontrado');
  END IF;

  RETURN pg_catalog.jsonb_build_object('ok', true);
END;
$fn$;

COMMENT ON FUNCTION public.admin_salvar_notas_pedido(uuid, text) IS
  'Grava notas internas do pedido. Exige is_admin().';

REVOKE ALL ON FUNCTION public.admin_salvar_notas_pedido(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_salvar_notas_pedido(uuid, text) TO authenticated;

-- Sem DELETE e sem UPDATE direto: pedido real não some pela API REST, e
-- status/estoque só mudam pelas RPCs (histórico + devolução atômica).
DROP POLICY IF EXISTS pedidos_admin_atualizacao ON public.pedidos;
REVOKE UPDATE, DELETE, INSERT ON TABLE public.pedidos FROM authenticated;
-- SELECT do estágio 1 permanece (pedidos_admin_leitura + GRANT SELECT).

NOTIFY pgrst, 'reload schema';
