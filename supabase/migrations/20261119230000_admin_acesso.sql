-- Painel do ateliê (admin.foveoatelie.com.br).
--
-- Rodar o arquivo inteiro de uma vez, no SQL editor do projeto foveo-loja,
-- depois de ler. Não usar `supabase db push`: o remoto tem migrations de
-- 18/11/2026 que não estão neste repositório, e a CLI recusa o histórico.
--
-- O que muda:
--   * pedidos.teste, falso por padrão. Os códigos 261119003–261119009
--     passam a teste. O gatilho de updated_at fica suspenso nessa marcação
--     para não reescrever a data de pedidos antigos.
--   * public.is_admin() lê o e-mail do JWT (auth.email()). Só
--     contato@foveoatelie.com.br.
--   * authenticated ganha SELECT e UPDATE em pedidos, filtrado por
--     is_admin(). Sem INSERT e sem DELETE.
--
-- O que não muda:
--   * a policy pedidos_sem_acesso_cliente (USING false) continua.
--     Policy permissiva combina com OR, então o false não bloqueia a
--     policy nova, e também não libera ninguém sozinho.
--   * anon não recebe GRANT. O PostgREST sugere "GRANT SELECT TO anon"
--     quando a chave publishable bate na tabela. Não seguir esse hint:
--     a loja lê a view catalogo, não a tabela pedidos.
--   * estoque e produtos seguem fechados (policy de negação, sem GRANT
--     para anon ou authenticated).
--   * service_role continua com bypass de RLS. criar-pedido,
--     consultar-pedido e o webhook não passam por estas policies.

ALTER TABLE public.pedidos
  ADD COLUMN teste boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.pedidos.teste IS
  'Pedido de teste. Continua na lista do painel, com a marca teste.';

ALTER TABLE public.pedidos DISABLE TRIGGER pedidos_set_updated_at;

UPDATE public.pedidos
SET teste = true
WHERE codigo IN (
  '261119003',
  '261119004',
  '261119005',
  '261119006',
  '261119007',
  '261119008',
  '261119009'
);

ALTER TABLE public.pedidos ENABLE TRIGGER pedidos_set_updated_at;

DO $fn$
DECLARE
  n integer;
BEGIN
  SELECT count(*)
  INTO n
  FROM public.pedidos
  WHERE codigo IN (
    '261119003',
    '261119004',
    '261119005',
    '261119006',
    '261119007',
    '261119008',
    '261119009'
  )
    AND teste;

  IF n <> 7 THEN
    RAISE EXCEPTION 'esperava 7 pedidos com teste, achei %', n;
  END IF;
END;
$fn$;

CREATE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $fn$
  SELECT lower(coalesce(auth.email(), '')) = 'contato@foveoatelie.com.br';
$fn$;

COMMENT ON FUNCTION public.is_admin() IS
  'Verdadeiro só quando o e-mail do JWT é contato@foveoatelie.com.br. A tela de login não é a trava.';

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

CREATE POLICY pedidos_admin_leitura
  ON public.pedidos
  FOR SELECT
  TO authenticated
  USING ((SELECT public.is_admin()));

CREATE POLICY pedidos_admin_atualizacao
  ON public.pedidos
  FOR UPDATE
  TO authenticated
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

COMMENT ON POLICY pedidos_admin_atualizacao ON public.pedidos IS
  'O estágio 1 não grava pela tela. Um UPDATE direto não passa por aplicar_retorno_mp e não mexe no estoque.';

GRANT SELECT, UPDATE ON TABLE public.pedidos TO authenticated;

NOTIFY pgrst, 'reload schema';
