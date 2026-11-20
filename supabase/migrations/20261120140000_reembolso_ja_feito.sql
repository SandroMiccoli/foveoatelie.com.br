-- Origem distinta quando o Mercado Pago já devolveu o valor fora do painel.
-- admin_confirmar_reembolso passa a aceitar p_origem (default 'reembolso').

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
      'mp_ja_reembolsado'::text
    ])
  );

-- Remove a assinatura antiga antes de criar a nova (evita ambiguidade com DEFAULT).
DROP FUNCTION IF EXISTS public.admin_confirmar_reembolso(uuid);

CREATE OR REPLACE FUNCTION public.admin_confirmar_reembolso(
  p_pedido_id uuid,
  p_origem text DEFAULT 'reembolso'
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

  origem := COALESCE(NULLIF(pg_catalog.btrim(p_origem), ''), 'reembolso');
  IF origem NOT IN ('reembolso', 'mp_ja_reembolsado') THEN
    origem := 'reembolso';
  END IF;

  PERFORM private.restaurar_estoque_pedido(ped);

  UPDATE public.pedidos
  SET status = 'reembolsado'
  WHERE id = ped.id;

  INSERT INTO public.pedido_status_historico (pedido_id, status, origem)
  VALUES (ped.id, 'reembolsado', origem);

  RETURN pg_catalog.jsonb_build_object('ok', true, 'status', 'reembolsado');
END;
$fn$;

COMMENT ON FUNCTION public.admin_confirmar_reembolso(uuid, text) IS
  'Marca reembolsado e devolve estoque. Só depois do Mercado Pago confirmar (ou já ter confirmado). Exige is_admin().';

REVOKE ALL ON FUNCTION public.admin_confirmar_reembolso(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_confirmar_reembolso(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_confirmar_reembolso(uuid, text) TO service_role;
