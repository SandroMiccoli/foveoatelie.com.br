-- Painel do ateliê, etapa 3: início, estoque e clientes.
--
-- Rodar o arquivo inteiro de uma vez, no SQL editor do projeto foveo-loja
-- (bbksditqlgdjftwowtje), depois de ler. Não usar `supabase db push`: o
-- remoto tem migrations de 18/11/2026 que não estão neste repositório.
--
-- O que muda:
--   * produtos.colecao, com "Coleção 2026" nas velas que já existem.
--   * public.estoque_movimentos: histórico (data, tipo, quantidade,
--     saldo depois, observação). RLS só de leitura para is_admin().
--   * Gatilho AFTER UPDATE em estoque. Infere venda, devolução, reserva
--     e liberação pelo delta. Entrada e ajuste manual marcam o tipo
--     antes do UPDATE. Se o histórico falhar, a mudança de estoque
--     segue: o checkout e o webhook não dependem desta tabela.
--   * RPCs SECURITY DEFINER, search_path travado e is_admin():
--     admin_entrada_producao (soma ao disponível) e
--     admin_ajuste_estoque (define o disponível; o histórico fica
--     como ajuste manual). Disponível nunca fica negativo.
--   * authenticated ganha SELECT em produtos, estoque e no histórico.
--     Sem INSERT, UPDATE ou DELETE direto. anon não recebe GRANT.
--
-- O que não muda:
--   * criar-pedido, aplicar_retorno_mp, expirar_reservas, liberar_pedido
--     e o webhook. O gatilho só observa o UPDATE que eles já fazem.
--   * private.restaurar_estoque_pedido. Devolução de cancelamento ou
--     reembolso aparece como devolução (disponível sobe) ou liberação
--     (só o reservado desce).
--   * a view do catálogo e o service_role.

-- ── coleção ────────────────────────────────────────────────────────────

ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS colecao text;

UPDATE public.produtos
SET colecao = 'Coleção 2026'
WHERE colecao IS NULL OR btrim(colecao) = '';

ALTER TABLE public.produtos
  ALTER COLUMN colecao SET DEFAULT 'Coleção 2026';

ALTER TABLE public.produtos
  ALTER COLUMN colecao SET NOT NULL;

COMMENT ON COLUMN public.produtos.colecao IS
  'Agrupa as velas no início do painel. Hoje, Coleção 2026.';

-- ── disponível não negativo ────────────────────────────────────────────

DO $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'estoque_disponivel_nao_negativo'
      AND conrelid = 'public.estoque'::regclass
  ) THEN
    ALTER TABLE public.estoque
      ADD CONSTRAINT estoque_disponivel_nao_negativo
      CHECK (disponivel >= 0);
  END IF;
END;
$fn$;

-- ── histórico de movimentações ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.estoque_movimentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id text NOT NULL REFERENCES public.produtos (id),
  tipo text NOT NULL,
  quantidade integer NOT NULL,
  saldo_disponivel integer NOT NULL,
  saldo_reservado integer NOT NULL,
  observacao text,
  pedido_id uuid REFERENCES public.pedidos (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT estoque_movimentos_tipo_check
    CHECK (tipo = ANY (ARRAY[
      'producao'::text,
      'ajuste'::text,
      'venda'::text,
      'devolucao'::text,
      'reserva'::text,
      'liberacao'::text
    ])),
  CONSTRAINT estoque_movimentos_saldo_disponivel_check
    CHECK (saldo_disponivel >= 0),
  CONSTRAINT estoque_movimentos_saldo_reservado_check
    CHECK (saldo_reservado >= 0),
  CONSTRAINT estoque_movimentos_observacao_check
    CHECK (observacao IS NULL OR char_length(observacao) <= 400)
);

CREATE INDEX IF NOT EXISTS estoque_movimentos_produto_created_idx
  ON public.estoque_movimentos (produto_id, created_at DESC);

COMMENT ON TABLE public.estoque_movimentos IS
  'Movimentos de estoque. producao e ajuste vêm do painel. venda, devolucao, reserva e liberacao vêm do gatilho, sem mudar o checkout.';

COMMENT ON COLUMN public.estoque_movimentos.quantidade IS
  'Delta com sinal. Em produção, venda, devolução e ajuste é o disponível. Em reserva e liberação é o reservado.';

COMMENT ON COLUMN public.estoque_movimentos.saldo_disponivel IS
  'Disponível depois do movimento.';

ALTER TABLE public.estoque_movimentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS estoque_movimentos_admin_leitura ON public.estoque_movimentos;
CREATE POLICY estoque_movimentos_admin_leitura
  ON public.estoque_movimentos
  FOR SELECT
  TO authenticated
  USING ((SELECT public.is_admin()));

REVOKE ALL ON TABLE public.estoque_movimentos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.estoque_movimentos TO authenticated;

-- ── gatilho: registra o que o checkout já altera ───────────────────────

CREATE OR REPLACE FUNCTION private.registrar_movimento_estoque()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  delta_d integer;
  delta_r integer;
  tipo text;
  qtd integer;
  obs text;
  ped text;
  ped_uuid uuid;
BEGIN
  delta_d := NEW.disponivel - OLD.disponivel;
  delta_r := NEW.reservado - OLD.reservado;
  IF delta_d = 0 AND delta_r = 0 THEN
    RETURN NEW;
  END IF;

  tipo := NULLIF(pg_catalog.current_setting('foveo.estoque_tipo', true), '');
  obs := NULLIF(
    pg_catalog.btrim(COALESCE(pg_catalog.current_setting('foveo.estoque_obs', true), '')),
    ''
  );
  ped := NULLIF(pg_catalog.btrim(COALESCE(pg_catalog.current_setting('foveo.estoque_pedido', true), '')), '');

  IF tipo IS NULL THEN
    IF delta_d < 0 THEN
      tipo := 'venda';
      qtd := delta_d;
    ELSIF delta_d > 0 THEN
      tipo := 'devolucao';
      qtd := delta_d;
    ELSIF delta_r > 0 THEN
      tipo := 'reserva';
      qtd := delta_r;
    ELSE
      tipo := 'liberacao';
      qtd := delta_r;
    END IF;
  ELSIF tipo NOT IN ('producao', 'ajuste', 'venda', 'devolucao', 'reserva', 'liberacao') THEN
    IF delta_d <> 0 THEN
      qtd := delta_d;
    ELSE
      qtd := delta_r;
    END IF;
    tipo := 'ajuste';
  ELSIF delta_d <> 0 THEN
    qtd := delta_d;
  ELSE
    qtd := delta_r;
  END IF;

  IF obs IS NULL AND tipo IN ('reserva', 'liberacao') THEN
    obs := 'Reservado ficou em ' || NEW.reservado::text;
  END IF;

  ped_uuid := NULL;
  IF ped IS NOT NULL AND ped ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    ped_uuid := ped::uuid;
  END IF;

  BEGIN
    INSERT INTO public.estoque_movimentos (
      produto_id,
      tipo,
      quantidade,
      saldo_disponivel,
      saldo_reservado,
      observacao,
      pedido_id
    ) VALUES (
      NEW.produto_id,
      tipo,
      qtd,
      NEW.disponivel,
      NEW.reservado,
      obs,
      ped_uuid
    );
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'estoque_movimento ignorado para %: %', NEW.produto_id, SQLERRM;
  END;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION private.registrar_movimento_estoque() IS
  'Depois de um UPDATE em estoque, grava o histórico. Falha aqui não desfaz a baixa.';

REVOKE ALL ON FUNCTION private.registrar_movimento_estoque() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS estoque_registra_movimento ON public.estoque;
CREATE TRIGGER estoque_registra_movimento
  AFTER UPDATE OF disponivel, reservado ON public.estoque
  FOR EACH ROW
  WHEN (
    OLD.disponivel IS DISTINCT FROM NEW.disponivel
    OR OLD.reservado IS DISTINCT FROM NEW.reservado
  )
  EXECUTE FUNCTION private.registrar_movimento_estoque();

-- ── leitura para o admin ───────────────────────────────────────────────

ALTER TABLE public.produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estoque ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS produtos_admin_leitura ON public.produtos;
CREATE POLICY produtos_admin_leitura
  ON public.produtos
  FOR SELECT
  TO authenticated
  USING ((SELECT public.is_admin()));

DROP POLICY IF EXISTS estoque_admin_leitura ON public.estoque;
CREATE POLICY estoque_admin_leitura
  ON public.estoque
  FOR SELECT
  TO authenticated
  USING ((SELECT public.is_admin()));

REVOKE ALL ON TABLE public.produtos FROM anon;
REVOKE ALL ON TABLE public.estoque FROM anon;
GRANT SELECT ON TABLE public.produtos TO authenticated;
GRANT SELECT ON TABLE public.estoque TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.produtos FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.estoque FROM authenticated;

-- ── admin: entrada de produção ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_entrada_producao(
  p_produto_id text,
  p_quantidade integer,
  p_observacao text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  pid text;
  obs text;
  linha public.estoque%ROWTYPE;
BEGIN
  IF NOT (SELECT public.is_admin()) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'nao_autorizado');
  END IF;

  pid := pg_catalog.btrim(COALESCE(p_produto_id, ''));
  IF pid = '' OR char_length(pid) > 64 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'produto_invalido');
  END IF;

  IF p_quantidade IS NULL OR p_quantidade < 1 OR p_quantidade > 100000 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'quantidade_invalida');
  END IF;

  obs := NULLIF(pg_catalog.btrim(COALESCE(p_observacao, '')), '');
  IF obs IS NOT NULL AND char_length(obs) > 400 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'motivo_longo');
  END IF;

  SELECT *
  INTO linha
  FROM public.estoque
  WHERE produto_id = pid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'produto_ausente');
  END IF;

  IF linha.disponivel > 1000000 - p_quantidade THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'quantidade_invalida');
  END IF;

  PERFORM pg_catalog.set_config('foveo.estoque_tipo', 'producao', true);
  PERFORM pg_catalog.set_config('foveo.estoque_obs', COALESCE(obs, ''), true);
  PERFORM pg_catalog.set_config('foveo.estoque_pedido', '', true);

  UPDATE public.estoque
  SET disponivel = disponivel + p_quantidade,
      updated_at = pg_catalog.now()
  WHERE produto_id = pid
  RETURNING disponivel, reservado
  INTO linha.disponivel, linha.reservado;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'produto_id', pid,
    'disponivel', linha.disponivel,
    'reservado', linha.reservado,
    'quantidade', p_quantidade
  );
END;
$fn$;

COMMENT ON FUNCTION public.admin_entrada_producao(text, integer, text) IS
  'Soma unidades ao disponível. Exige is_admin(). O histórico fica como producao.';

REVOKE ALL ON FUNCTION public.admin_entrada_producao(text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_entrada_producao(text, integer, text) TO authenticated;

-- ── admin: ajuste rápido ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_ajuste_estoque(
  p_produto_id text,
  p_disponivel integer,
  p_observacao text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  pid text;
  obs text;
  linha public.estoque%ROWTYPE;
  delta integer;
BEGIN
  IF NOT (SELECT public.is_admin()) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'nao_autorizado');
  END IF;

  pid := pg_catalog.btrim(COALESCE(p_produto_id, ''));
  IF pid = '' OR char_length(pid) > 64 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'produto_invalido');
  END IF;

  IF p_disponivel IS NULL OR p_disponivel > 100000 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'quantidade_invalida');
  END IF;

  IF p_disponivel < 0 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'ficaria_negativo');
  END IF;

  obs := NULLIF(pg_catalog.btrim(COALESCE(p_observacao, '')), '');
  IF obs IS NOT NULL AND char_length(obs) > 400 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'motivo_longo');
  END IF;

  SELECT *
  INTO linha
  FROM public.estoque
  WHERE produto_id = pid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'produto_ausente');
  END IF;

  IF linha.disponivel = p_disponivel THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', true,
      'ja', true,
      'produto_id', pid,
      'disponivel', linha.disponivel,
      'reservado', linha.reservado
    );
  END IF;

  delta := p_disponivel - linha.disponivel;

  PERFORM pg_catalog.set_config('foveo.estoque_tipo', 'ajuste', true);
  PERFORM pg_catalog.set_config('foveo.estoque_obs', COALESCE(obs, ''), true);
  PERFORM pg_catalog.set_config('foveo.estoque_pedido', '', true);

  UPDATE public.estoque
  SET disponivel = p_disponivel,
      updated_at = pg_catalog.now()
  WHERE produto_id = pid
    AND p_disponivel >= 0
  RETURNING disponivel, reservado
  INTO linha.disponivel, linha.reservado;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'produto_id', pid,
    'disponivel', linha.disponivel,
    'reservado', linha.reservado,
    'quantidade', delta
  );
END;
$fn$;

COMMENT ON FUNCTION public.admin_ajuste_estoque(text, integer, text) IS
  'Define o disponível. Exige is_admin(). O histórico fica como ajuste manual. Não mexe no reservado.';

REVOKE ALL ON FUNCTION public.admin_ajuste_estoque(text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ajuste_estoque(text, integer, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
