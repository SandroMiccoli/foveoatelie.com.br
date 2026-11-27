-- Libera reserva de estoque ao marcar pedido como expirado ou recusado
-- no painel (admin_alterar_status_pedido). Antes só cancelado devolvia.
--
-- Rodar o arquivo inteiro de uma vez, no SQL editor do projeto foveo-loja
-- (bbksditqlgdjftwowtje), depois de ler. Não usar `supabase db push`.
--
-- O que muda:
--   * admin_alterar_status_pedido chama restaurar_estoque_pedido também
--     ao ir para expirado ou recusado (além de cancelado), ainda com o
--     status antigo — tipicamente pendente, então só o reservado desce.
--   * Idempotente: estoque_restaurado_em evita segunda devolução; se o
--     status já é o pedido, devolve ja=true sem mexer.
--   * Pedido já pago/enviado: restaurar_estoque_pedido só devolve
--     disponível se o status atual for pago+ (mesmo caminho de
--     cancelado). De pendente, só solta reservado.
--   * expirar_reservas e liberar_pedido passam a gravar
--     estoque_restaurado_em quando soltam a reserva.
--
-- Correção dos pedidos que JÁ estão expirados com reserva presa:
--   ver supabase/scripts/corrigir_reservas_presas_expirados.sql
--   (não roda neste arquivo).

-- ── admin: expirado e recusado também soltam a reserva ─────────────────

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

  -- Solta reserva (pendente) ou devolve disponível (pago+) uma vez.
  -- Chamar ANTES do UPDATE de status: restaurar_estoque_pedido lê o status
  -- atual. Pedido já no mesmo status sai acima com ja=true.
  IF p_status IN ('cancelado', 'expirado', 'recusado') THEN
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
  'Troca o status do pedido. Exige is_admin(). Em cancelado, expirado ou recusado, devolve o estoque uma vez.';

REVOKE ALL ON FUNCTION public.admin_alterar_status_pedido(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_alterar_status_pedido(uuid, text, text) TO authenticated;

-- ── expirar_reservas: carimba estoque_restaurado_em ────────────────────

CREATE OR REPLACE FUNCTION private.expirar_reservas()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  ped record;
  item jsonb;
  ids uuid[] := ARRAY[]::uuid[];
  deltas jsonb := '{}'::jsonb;
  pid text;
  qtd integer;
  n integer;
BEGIN
  FOR ped IN
    SELECT id, itens
    FROM public.pedidos
    WHERE status = 'pendente'
      AND reserva_expira_em IS NOT NULL
      AND reserva_expira_em <= pg_catalog.now()
    ORDER BY id
    FOR UPDATE
  LOOP
    ids := ids || ped.id;

    FOR item IN
      SELECT value
      FROM pg_catalog.jsonb_array_elements(ped.itens) AS t(value)
    LOOP
      pid := item->>'produto_id';
      IF pid IS NULL OR item->>'qtd' !~ '^[0-9]+$' THEN
        CONTINUE;
      END IF;
      qtd := (item->>'qtd')::integer;
      IF qtd < 1 THEN
        CONTINUE;
      END IF;
      deltas := deltas || pg_catalog.jsonb_build_object(
        pid,
        COALESCE((deltas->>pid)::integer, 0) + qtd
      );
    END LOOP;
  END LOOP;

  IF pg_catalog.cardinality(ids) = 0 THEN
    RETURN 0;
  END IF;

  FOR pid IN
    SELECT k
    FROM pg_catalog.jsonb_object_keys(deltas) AS t(k)
    ORDER BY k
  LOOP
    UPDATE public.estoque
    SET reservado = GREATEST(reservado - (deltas->>pid)::integer, 0)
    WHERE produto_id = pid;
  END LOOP;

  UPDATE public.pedidos
  SET status = 'expirado',
      estoque_restaurado_em = COALESCE(estoque_restaurado_em, pg_catalog.now())
  WHERE id = ANY (ids);

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$fn$;

REVOKE ALL ON FUNCTION private.expirar_reservas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.expirar_reservas() TO service_role;

-- ── liberar_pedido: carimba ao cancelar sem order no MP ────────────────

CREATE OR REPLACE FUNCTION private.liberar_pedido(p_pedido_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  ped public.pedidos%ROWTYPE;
  item jsonb;
  pid text;
  qtd integer;
BEGIN
  SELECT *
  INTO ped
  FROM public.pedidos
  WHERE id = p_pedido_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'nao_encontrado');
  END IF;

  IF ped.status <> 'pendente' THEN
    RETURN pg_catalog.jsonb_build_object('ok', true, 'ja_resolvido', true, 'status', ped.status);
  END IF;

  -- Order já existe no Mercado Pago: quem decide é o webhook.
  IF ped.mp_order_id IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', true, 'mantido', true);
  END IF;

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

  UPDATE public.pedidos
  SET status = 'cancelado',
      estoque_restaurado_em = COALESCE(estoque_restaurado_em, pg_catalog.now())
  WHERE id = ped.id;

  RETURN pg_catalog.jsonb_build_object('ok', true, 'status', 'cancelado');
END;
$fn$;

REVOKE ALL ON FUNCTION private.liberar_pedido(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.liberar_pedido(uuid) TO service_role;

-- ── aplicar_retorno_mp: só o ramo que solta reserva ganha o carimbo ───
-- Corpo idêntico ao de 20261119100000, com estoque_restaurado_em no
-- UPDATE de recusado/expirado/cancelado a partir de pendente.

CREATE OR REPLACE FUNCTION private.aplicar_retorno_mp(
  p_pedido_id uuid,
  p_mp_order_id text,
  p_mp_payment_id text,
  p_mp_status text,
  p_mp_status_detail text,
  p_total_centavos integer,
  p_acao text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  ped public.pedidos%ROWTYPE;
  item jsonb;
  pid text;
  qtd integer;
  falta boolean := false;
  n integer;
BEGIN
  IF p_acao NOT IN ('pago', 'recusado', 'expirado', 'cancelado', 'registrar') THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'pedido_invalido');
  END IF;

  IF p_pedido_id IS NOT NULL THEN
    SELECT *
    INTO ped
    FROM public.pedidos
    WHERE id = p_pedido_id
    FOR UPDATE;
  END IF;

  IF NOT FOUND AND p_mp_order_id IS NOT NULL THEN
    SELECT *
    INTO ped
    FROM public.pedidos
    WHERE mp_order_id = p_mp_order_id
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'nao_encontrado');
  END IF;

  IF ped.mp_order_id IS NOT NULL
     AND p_mp_order_id IS NOT NULL
     AND ped.mp_order_id <> p_mp_order_id THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'divergente');
  END IF;

  -- Notificação repetida de um pedido já pago não mexe no estoque.
  IF ped.status = 'pago' THEN
    UPDATE public.pedidos
    SET mp_order_id = COALESCE(ped.mp_order_id, p_mp_order_id),
        mp_payment_id = COALESCE(ped.mp_payment_id, p_mp_payment_id),
        mp_status = p_mp_status,
        mp_status_detail = p_mp_status_detail
    WHERE id = ped.id;
    RETURN pg_catalog.jsonb_build_object('ok', true, 'status', 'pago', 'ja', true);
  END IF;

  IF p_acao = 'pago'
     AND p_total_centavos IS NOT NULL
     AND p_total_centavos <> ped.total_centavos THEN
    UPDATE public.pedidos
    SET mp_order_id = COALESCE(ped.mp_order_id, p_mp_order_id),
        mp_status = p_mp_status,
        mp_status_detail = p_mp_status_detail
    WHERE id = ped.id;
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'valor');
  END IF;

  IF p_acao = 'registrar' THEN
    UPDATE public.pedidos
    SET mp_order_id = COALESCE(ped.mp_order_id, p_mp_order_id),
        mp_payment_id = COALESCE(ped.mp_payment_id, p_mp_payment_id),
        mp_status = p_mp_status,
        mp_status_detail = p_mp_status_detail
    WHERE id = ped.id;
    RETURN pg_catalog.jsonb_build_object('ok', true, 'status', ped.status, 'ja', ped.status = 'pago');
  END IF;

  IF p_acao = 'pago' AND ped.status = 'pendente' THEN
    FOR item IN
      SELECT value
      FROM pg_catalog.jsonb_array_elements(ped.itens) AS t(value)
      ORDER BY value->>'produto_id'
    LOOP
      pid := item->>'produto_id';
      qtd := (item->>'qtd')::integer;
      PERFORM 1
      FROM public.estoque
      WHERE produto_id = pid
        AND disponivel >= qtd
        AND reservado >= qtd
      FOR UPDATE;
      IF NOT FOUND THEN
        falta := true;
      END IF;
    END LOOP;

    IF falta THEN
      UPDATE public.pedidos
      SET mp_order_id = COALESCE(ped.mp_order_id, p_mp_order_id),
          mp_payment_id = COALESCE(ped.mp_payment_id, p_mp_payment_id),
          mp_status = p_mp_status,
          mp_status_detail = p_mp_status_detail
      WHERE id = ped.id;
      RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'sem_estoque', 'status', ped.status);
    END IF;

    FOR item IN
      SELECT value
      FROM pg_catalog.jsonb_array_elements(ped.itens) AS t(value)
      ORDER BY value->>'produto_id'
    LOOP
      pid := item->>'produto_id';
      qtd := (item->>'qtd')::integer;
      UPDATE public.estoque
      SET disponivel = disponivel - qtd,
          reservado = reservado - qtd
      WHERE produto_id = pid
        AND disponivel >= qtd
        AND reservado >= qtd;
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n <> 1 THEN
        RAISE EXCEPTION 'estoque_inconsistente' USING ERRCODE = 'P0001';
      END IF;
    END LOOP;

    UPDATE public.pedidos
    SET status = 'pago',
        pago_em = pg_catalog.now(),
        mp_order_id = COALESCE(ped.mp_order_id, p_mp_order_id),
        mp_payment_id = COALESCE(ped.mp_payment_id, p_mp_payment_id),
        mp_status = p_mp_status,
        mp_status_detail = p_mp_status_detail
    WHERE id = ped.id;

    RETURN pg_catalog.jsonb_build_object('ok', true, 'status', 'pago');
  END IF;

  IF p_acao = 'pago' AND ped.status IN ('expirado', 'cancelado', 'recusado') THEN
    -- A reserva já foi solta. Tenta baixar o estoque físico se ainda houver.
    FOR item IN
      SELECT value
      FROM pg_catalog.jsonb_array_elements(ped.itens) AS t(value)
      ORDER BY value->>'produto_id'
    LOOP
      pid := item->>'produto_id';
      qtd := (item->>'qtd')::integer;
      PERFORM 1
      FROM public.estoque
      WHERE produto_id = pid
        AND disponivel >= qtd
      FOR UPDATE;
      IF NOT FOUND THEN
        falta := true;
      END IF;
    END LOOP;

    IF falta THEN
      UPDATE public.pedidos
      SET mp_order_id = COALESCE(mp_order_id, p_mp_order_id),
          mp_payment_id = COALESCE(mp_payment_id, p_mp_payment_id),
          mp_status = p_mp_status,
          mp_status_detail = p_mp_status_detail
      WHERE id = ped.id;
      RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'sem_estoque', 'status', ped.status);
    END IF;

    FOR item IN
      SELECT value
      FROM pg_catalog.jsonb_array_elements(ped.itens) AS t(value)
      ORDER BY value->>'produto_id'
    LOOP
      pid := item->>'produto_id';
      qtd := (item->>'qtd')::integer;
      UPDATE public.estoque
      SET disponivel = disponivel - qtd
      WHERE produto_id = pid
        AND disponivel >= qtd;
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n <> 1 THEN
        RAISE EXCEPTION 'estoque_inconsistente' USING ERRCODE = 'P0001';
      END IF;
    END LOOP;

    UPDATE public.pedidos
    SET status = 'pago',
        pago_em = pg_catalog.now(),
        mp_order_id = COALESCE(ped.mp_order_id, p_mp_order_id),
        mp_payment_id = COALESCE(ped.mp_payment_id, p_mp_payment_id),
        mp_status = p_mp_status,
        mp_status_detail = p_mp_status_detail
    WHERE id = ped.id;

    RETURN pg_catalog.jsonb_build_object('ok', true, 'status', 'pago', 'tarde', true);
  END IF;

  IF p_acao IN ('recusado', 'expirado', 'cancelado') AND ped.status = 'pendente' THEN
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

    UPDATE public.pedidos
    SET status = p_acao,
        estoque_restaurado_em = COALESCE(estoque_restaurado_em, pg_catalog.now()),
        mp_order_id = COALESCE(ped.mp_order_id, p_mp_order_id),
        mp_payment_id = COALESCE(ped.mp_payment_id, p_mp_payment_id),
        mp_status = p_mp_status,
        mp_status_detail = p_mp_status_detail
    WHERE id = ped.id;

    RETURN pg_catalog.jsonb_build_object('ok', true, 'status', p_acao);
  END IF;

  UPDATE public.pedidos
  SET mp_order_id = COALESCE(ped.mp_order_id, p_mp_order_id),
      mp_payment_id = COALESCE(ped.mp_payment_id, p_mp_payment_id),
      mp_status = p_mp_status,
      mp_status_detail = p_mp_status_detail
  WHERE id = ped.id;

  RETURN pg_catalog.jsonb_build_object('ok', true, 'status', ped.status, 'inalterado', true);
END;
$fn$;

REVOKE ALL ON FUNCTION private.aplicar_retorno_mp(uuid, text, text, text, text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.aplicar_retorno_mp(uuid, text, text, text, text, integer, text) TO service_role;
