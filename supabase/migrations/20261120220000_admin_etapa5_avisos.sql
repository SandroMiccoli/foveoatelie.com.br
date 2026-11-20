-- Etapa 5: token do Melhor Envio e avisos do ateliê.
--
-- Rodar o arquivo inteiro no SQL editor, depois de
-- 20261120200000_admin_etapa4_conferencia.sql. Não usar `supabase db push`.
--
-- O que entra:
--   * private.melhor_envio_oauth guarda access_token, refresh_token e
--     expires_at. RLS ligada, sem policy e sem GRANT. anon e authenticated
--     não leem. O par só sai por RPC de service_role.
--   * A tabela começa vazia. Enquanto estiver vazia, a função usa o secret
--     MELHOR_ENVIO_TOKEN (token pessoal, não o access token do app).
--     expires_at preenchido renova quando falta menos de 7 dias.
--     expires_at nulo não gira no checkout. A manutenção diária trata nulo
--     como "renovar nesta rodada", às 08:30, para a data não ficar esquecida.
--   * A renovação faz FOR UPDATE e marca renovando_ate, para duas chamadas
--     não girarem o refresh_token ao mesmo tempo.
--   * public.avisos lista o que o painel mostra. private.avisos_dedupe
--     segura a repetição: estoque uma vez por cruzamento abaixo de 3,
--     saldo e token uma vez por dia em São Paulo, entrega uma vez por
--     etiqueta e situação.
--   * O gatilho de estoque registra a queda depois de venda, produção ou
--     ajuste. O POST do aviso não roda aqui.
--   * pg_cron chama a função manutencao-diaria todo dia às 08:30 em São
--     Paulo (11:30 UTC), se os secrets do vault existirem.
--
-- Seed do par, uma vez, no SQL editor. Troque os três valores na hora.
-- Não cole token neste arquivo nem no git. expires_at é a validade real
-- do access token (cerca de 30 dias; se saiu em 2026-11-20, 2026-12-20).
-- A diária renova uns 7 dias antes, de manhã, e o checkout não gira o par.
--
--   INSERT INTO private.melhor_envio_oauth (access_token, refresh_token, expires_at)
--   VALUES (
--     '<access_token atual do aplicativo>',
--     '<refresh_token do aplicativo>',
--     timestamptz '2026-12-20 00:00:00-03'
--   )
--   ON CONFLICT (id) DO UPDATE
--   SET access_token = EXCLUDED.access_token,
--       refresh_token = EXCLUDED.refresh_token,
--       expires_at = EXCLUDED.expires_at,
--       renovando_ate = NULL,
--       atualizado_em = pg_catalog.now();
--
-- Vault, para o cron e para o disparo depois da mudança de estoque:
--
--   SELECT vault.create_secret(
--     'https://bbksditqlgdjftwowtje.supabase.co',
--     'foveo_supabase_url'
--   );
--   SELECT vault.create_secret('<service_role>', 'foveo_service_role_key');

CREATE SCHEMA IF NOT EXISTS private;

-- ── token OAuth ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS private.melhor_envio_oauth (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  access_token text NOT NULL DEFAULT '',
  refresh_token text NOT NULL DEFAULT '',
  expires_at timestamptz,
  renovando_ate timestamptz,
  atualizado_em timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT melhor_envio_oauth_access_tamanho CHECK (char_length(access_token) <= 4000),
  CONSTRAINT melhor_envio_oauth_refresh_tamanho CHECK (char_length(refresh_token) <= 4000)
);

COMMENT ON TABLE private.melhor_envio_oauth IS
  'Par OAuth do Melhor Envio. Uma linha. Sem GRANT: só as RPCs de service_role. A tabela vazia cai no secret MELHOR_ENVIO_TOKEN.';

ALTER TABLE private.melhor_envio_oauth ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.melhor_envio_oauth FROM PUBLIC, anon, authenticated, service_role;

-- ── avisos ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.avisos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL,
  chave text NOT NULL,
  mensagem text NOT NULL,
  detalhe jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolvido boolean NOT NULL DEFAULT false,
  resolvido_em timestamptz,
  enviado_em timestamptz,
  enviando_ate timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT avisos_tipo_check CHECK (
    tipo IN ('estoque_baixo', 'saldo_baixo', 'problema_entrega', 'token_melhor_envio')
  ),
  CONSTRAINT avisos_chave_check CHECK (chave ~ '^[A-Za-z0-9_.:-]{1,120}$'),
  CONSTRAINT avisos_mensagem_check CHECK (char_length(mensagem) BETWEEN 1 AND 500),
  CONSTRAINT avisos_detalhe_check CHECK (jsonb_typeof(detalhe) = 'object')
);

CREATE INDEX IF NOT EXISTS avisos_recentes_idx
  ON public.avisos (created_at DESC);

CREATE INDEX IF NOT EXISTS avisos_pendentes_idx
  ON public.avisos (created_at)
  WHERE enviado_em IS NULL;

COMMENT ON TABLE public.avisos IS
  'Avisos do ateliê. O painel lista e marca resolvido. O envio ao chat não bloqueia o pedido.';

CREATE TABLE IF NOT EXISTS private.avisos_dedupe (
  tipo text NOT NULL,
  chave text NOT NULL,
  aviso_id uuid,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (tipo, chave)
);

COMMENT ON TABLE private.avisos_dedupe IS
  'Trava de repetição. Estoque sai daqui quando o disponível volta a 3 ou mais. Saldo e token usam a data. Entrega usa etiqueta e situação.';

ALTER TABLE public.avisos ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.avisos_dedupe ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.avisos_dedupe FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.avisos FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.avisos TO authenticated;

DROP POLICY IF EXISTS avisos_admin_leitura ON public.avisos;
CREATE POLICY avisos_admin_leitura
  ON public.avisos
  FOR SELECT
  TO authenticated
  USING ((SELECT public.is_admin()));

-- ── HTTP em segundo plano (pg_net + vault) ─────────────────────────────

CREATE OR REPLACE FUNCTION private.enfileirar_http(
  p_caminho text,
  p_timeout integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  base text;
  chave text;
  alvo text;
BEGIN
  IF p_caminho IS NULL OR p_caminho NOT IN ('despachar-avisos', 'manutencao-diaria') THEN
    RETURN;
  END IF;

  IF p_caminho = 'despachar-avisos' THEN
    IF pg_catalog.current_setting('foveo.aviso_enfileirado', true) = '1' THEN
      RETURN;
    END IF;
    PERFORM pg_catalog.set_config('foveo.aviso_enfileirado', '1', true);
  END IF;

  IF to_regclass('vault.decrypted_secrets') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'net' AND p.proname = 'http_post'
  ) THEN
    RETURN;
  END IF;

  SELECT s.decrypted_secret
  INTO base
  FROM vault.decrypted_secrets AS s
  WHERE s.name = 'foveo_supabase_url'
  LIMIT 1;

  SELECT s.decrypted_secret
  INTO chave
  FROM vault.decrypted_secrets AS s
  WHERE s.name = 'foveo_service_role_key'
  LIMIT 1;

  IF base IS NULL OR chave IS NULL OR base = '' OR chave = '' THEN
    RETURN;
  END IF;

  base := pg_catalog.rtrim(base, '/');
  IF base !~ '^https://[A-Za-z0-9.-]+$' THEN
    RETURN;
  END IF;

  alvo := base || '/functions/v1/' || p_caminho;
  PERFORM net.http_post(
    alvo,
    '{}'::jsonb,
    '{}'::jsonb,
    pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || chave
    ),
    GREATEST(p_timeout, 1000)
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'aviso http %: %', p_caminho, SQLERRM;
END;
$fn$;

COMMENT ON FUNCTION private.enfileirar_http(text, integer) IS
  'Enfileira POST na função. Sem os secrets do vault, não faz nada. O erro não desfaz o aviso.';

REVOKE ALL ON FUNCTION private.enfileirar_http(text, integer) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.disparar_manutencao_diaria()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
BEGIN
  PERFORM private.enfileirar_http('manutencao-diaria', 20000);
END;
$fn$;

COMMENT ON FUNCTION private.disparar_manutencao_diaria() IS
  'Cron diário. Renova o token se estiver a menos de 7 dias e confere o saldo.';

REVOKE ALL ON FUNCTION private.disparar_manutencao_diaria() FROM PUBLIC, anon, authenticated, service_role;

-- ── leitura e renovação do token ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ler_oauth_melhor_envio()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  linha private.melhor_envio_oauth%ROWTYPE;
BEGIN
  SELECT *
  INTO linha
  FROM private.melhor_envio_oauth
  WHERE id = 1;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('vazio', true);
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'vazio', false,
    'access_token', linha.access_token,
    'tem_refresh', linha.refresh_token <> '',
    'expires_at', linha.expires_at,
    'renovando', linha.renovando_ate IS NOT NULL AND linha.renovando_ate > pg_catalog.now()
  );
END;
$fn$;

COMMENT ON FUNCTION public.ler_oauth_melhor_envio() IS
  'Lê o par sem travar. Não devolve o refresh_token. Só service_role.';

REVOKE ALL ON FUNCTION public.ler_oauth_melhor_envio() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ler_oauth_melhor_envio() TO service_role;

CREATE OR REPLACE FUNCTION public.reivindicar_oauth_melhor_envio(p_forcar boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  linha private.melhor_envio_oauth%ROWTYPE;
  precisa boolean;
BEGIN
  SELECT *
  INTO linha
  FROM private.melhor_envio_oauth
  WHERE id = 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('vazio', true, 'reivindicou', false, 'sem_refresh', true);
  END IF;

  IF linha.renovando_ate IS NOT NULL AND linha.renovando_ate > pg_catalog.now() THEN
    RETURN pg_catalog.jsonb_build_object(
      'reivindicou', false,
      'renovando', true,
      'access_token', linha.access_token,
      'expires_at', linha.expires_at
    );
  END IF;

  -- Nulo não entra na janela de 7 dias. Checkout não manda p_forcar.
  -- A manutenção diária manda p_forcar quando a data falta, às 08:30.
  precisa := COALESCE(p_forcar, false)
    OR (
      linha.expires_at IS NOT NULL
      AND linha.expires_at <= pg_catalog.now() + interval '7 days'
    );

  IF COALESCE(p_forcar, false)
    AND linha.access_token <> ''
    AND linha.expires_at IS NOT NULL
    AND linha.expires_at > pg_catalog.now() + interval '7 days'
    AND linha.atualizado_em > pg_catalog.now() - interval '2 minutes' THEN
    precisa := false;
  END IF;

  IF NOT precisa THEN
    RETURN pg_catalog.jsonb_build_object(
      'reivindicou', false,
      'renovando', false,
      'access_token', linha.access_token,
      'expires_at', linha.expires_at,
      'tem_refresh', linha.refresh_token <> ''
    );
  END IF;

  IF linha.refresh_token = '' THEN
    RETURN pg_catalog.jsonb_build_object(
      'reivindicou', false,
      'sem_refresh', true,
      'access_token', linha.access_token,
      'expires_at', linha.expires_at
    );
  END IF;

  UPDATE private.melhor_envio_oauth
  SET renovando_ate = pg_catalog.now() + interval '50 seconds'
  WHERE id = 1;

  RETURN pg_catalog.jsonb_build_object(
    'reivindicou', true,
    'refresh_token', linha.refresh_token,
    'access_token', linha.access_token,
    'expires_at', linha.expires_at
  );
END;
$fn$;

COMMENT ON FUNCTION public.reivindicar_oauth_melhor_envio(boolean) IS
  'Trava a linha e marca renovando_ate. Quem perde a corrida recebe renovando e espera.';

REVOKE ALL ON FUNCTION public.reivindicar_oauth_melhor_envio(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reivindicar_oauth_melhor_envio(boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.gravar_oauth_melhor_envio(
  p_access_token text,
  p_refresh_token text,
  p_expires_at timestamptz,
  p_refresh_usado text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  access text;
  refresh text;
  usado text;
BEGIN
  access := pg_catalog.btrim(COALESCE(p_access_token, ''));
  refresh := pg_catalog.btrim(COALESCE(p_refresh_token, ''));
  usado := pg_catalog.btrim(COALESCE(p_refresh_usado, ''));
  IF access = '' OR refresh = '' OR usado = '' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'invalido');
  END IF;
  IF char_length(access) > 4000 OR char_length(refresh) > 4000 OR char_length(usado) > 4000 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'invalido');
  END IF;
  IF p_expires_at IS NULL
    OR p_expires_at < pg_catalog.now() - interval '1 minute'
    OR p_expires_at > pg_catalog.now() + interval '70 days' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'validade');
  END IF;

  UPDATE private.melhor_envio_oauth
  SET
    access_token = access,
    refresh_token = refresh,
    expires_at = p_expires_at,
    renovando_ate = NULL,
    atualizado_em = pg_catalog.now()
  WHERE id = 1
    AND refresh_token = usado;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'conflito');
  END IF;
  RETURN pg_catalog.jsonb_build_object('ok', true);
END;
$fn$;

COMMENT ON FUNCTION public.gravar_oauth_melhor_envio(text, text, timestamptz, text) IS
  'Grava o par novo só se o refresh_token usado ainda é o da linha.';

REVOKE ALL ON FUNCTION public.gravar_oauth_melhor_envio(text, text, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gravar_oauth_melhor_envio(text, text, timestamptz, text) TO service_role;

CREATE OR REPLACE FUNCTION public.soltar_oauth_melhor_envio(p_refresh_usado text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
BEGIN
  UPDATE private.melhor_envio_oauth
  SET renovando_ate = NULL
  WHERE id = 1
    AND refresh_token = pg_catalog.btrim(COALESCE(p_refresh_usado, ''))
    AND renovando_ate IS NOT NULL;
END;
$fn$;

COMMENT ON FUNCTION public.soltar_oauth_melhor_envio(text) IS
  'Solta a trava se a renovação falhou e o refresh_token não girou.';

REVOKE ALL ON FUNCTION public.soltar_oauth_melhor_envio(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.soltar_oauth_melhor_envio(text) TO service_role;

-- ── registrar aviso, com dedupe ────────────────────────────────────────

CREATE OR REPLACE FUNCTION private.registrar_aviso(
  p_tipo text,
  p_chave text,
  p_mensagem text,
  p_detalhe jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_tipo text;
  v_chave text;
  v_mensagem text;
  v_detalhe jsonb;
  v_id uuid;
BEGIN
  v_tipo := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_tipo, '')));
  IF v_tipo NOT IN ('estoque_baixo', 'saldo_baixo', 'problema_entrega', 'token_melhor_envio') THEN
    RETURN NULL;
  END IF;

  v_chave := pg_catalog.btrim(COALESCE(p_chave, ''));
  IF v_chave !~ '^[A-Za-z0-9_.:-]{1,120}$' THEN
    RETURN NULL;
  END IF;

  v_mensagem := pg_catalog.btrim(COALESCE(p_mensagem, ''));
  IF char_length(v_mensagem) < 1 OR char_length(v_mensagem) > 500 THEN
    RETURN NULL;
  END IF;

  IF p_detalhe IS NULL OR pg_catalog.jsonb_typeof(p_detalhe) IS DISTINCT FROM 'object' THEN
    v_detalhe := '{}'::jsonb;
  ELSE
    v_detalhe := p_detalhe;
  END IF;

  INSERT INTO private.avisos_dedupe (tipo, chave)
  VALUES (v_tipo, v_chave)
  ON CONFLICT (tipo, chave) DO NOTHING;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.avisos (tipo, chave, mensagem, detalhe)
  VALUES (v_tipo, v_chave, v_mensagem, v_detalhe)
  RETURNING id INTO v_id;

  UPDATE private.avisos_dedupe AS d
  SET aviso_id = v_id
  WHERE d.tipo = v_tipo
    AND d.chave = v_chave;

  PERFORM private.enfileirar_http('despachar-avisos', 8000);
  RETURN v_id;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'aviso nao registrado (%): %', v_tipo, SQLERRM;
    RETURN NULL;
END;
$fn$;

COMMENT ON FUNCTION private.registrar_aviso(text, text, text, jsonb) IS
  'Insere o aviso se a chave ainda não está na trava. Repetição devolve nulo.';

REVOKE ALL ON FUNCTION private.registrar_aviso(text, text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.registrar_aviso(
  p_tipo text,
  p_chave text,
  p_mensagem text,
  p_detalhe jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  v_id := private.registrar_aviso(p_tipo, p_chave, p_mensagem, p_detalhe);
  RETURN pg_catalog.jsonb_build_object('ok', true, 'novo', v_id IS NOT NULL, 'id', v_id);
END;
$fn$;

COMMENT ON FUNCTION public.registrar_aviso(text, text, text, jsonb) IS
  'Registra aviso. novo false quando a trava já existe. Só service_role.';

REVOKE ALL ON FUNCTION public.registrar_aviso(text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_aviso(text, text, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.reivindicar_avisos_pendentes(p_limite integer DEFAULT 8)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  limite integer;
  resultado jsonb;
BEGIN
  limite := COALESCE(p_limite, 8);
  IF limite < 1 THEN
    limite := 1;
  ELSIF limite > 20 THEN
    limite := 20;
  END IF;

  WITH escolhidos AS (
    SELECT id
    FROM public.avisos
    WHERE enviado_em IS NULL
      AND (enviando_ate IS NULL OR enviando_ate < pg_catalog.now())
    ORDER BY created_at
    LIMIT limite
    FOR UPDATE SKIP LOCKED
  ),
  marcados AS (
    UPDATE public.avisos AS a
    SET enviando_ate = pg_catalog.now() + interval '45 seconds'
    FROM escolhidos AS e
    WHERE a.id = e.id
    RETURNING a.id, a.tipo, a.mensagem, a.detalhe, a.created_at
  )
  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', marcados.id,
        'tipo', marcados.tipo,
        'mensagem', marcados.mensagem,
        'detalhe', marcados.detalhe,
        'created_at', marcados.created_at
      )
      ORDER BY marcados.created_at
    ),
    '[]'::jsonb
  )
  INTO resultado
  FROM marcados;

  RETURN COALESCE(resultado, '[]'::jsonb);
END;
$fn$;

COMMENT ON FUNCTION public.reivindicar_avisos_pendentes(integer) IS
  'Reserva avisos ainda não enviados. Duas chamadas não pegam a mesma linha.';

REVOKE ALL ON FUNCTION public.reivindicar_avisos_pendentes(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reivindicar_avisos_pendentes(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.marcar_aviso_enviado(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
BEGIN
  UPDATE public.avisos
  SET enviado_em = pg_catalog.now(),
      enviando_ate = NULL
  WHERE id = p_id
    AND enviado_em IS NULL;

  RETURN pg_catalog.jsonb_build_object('ok', FOUND);
END;
$fn$;

REVOKE ALL ON FUNCTION public.marcar_aviso_enviado(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marcar_aviso_enviado(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.soltar_aviso(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
BEGIN
  UPDATE public.avisos
  SET enviando_ate = NULL
  WHERE id = p_id
    AND enviado_em IS NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.soltar_aviso(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.soltar_aviso(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_resolver_aviso(
  p_id uuid,
  p_resolvido boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  linha public.avisos%ROWTYPE;
BEGIN
  IF NOT (SELECT public.is_admin()) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'nao_autorizado');
  END IF;
  IF p_id IS NULL OR p_resolvido IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'invalido');
  END IF;

  UPDATE public.avisos
  SET
    resolvido = p_resolvido,
    resolvido_em = CASE WHEN p_resolvido THEN pg_catalog.now() ELSE NULL END
  WHERE id = p_id
  RETURNING * INTO linha;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'ausente');
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'id', linha.id,
    'resolvido', linha.resolvido
  );
END;
$fn$;

COMMENT ON FUNCTION public.admin_resolver_aviso(uuid, boolean) IS
  'Marca o aviso como resolvido ou reabre. Não libera a trava do estoque: isso só acontece quando o disponível volta a 3.';

REVOKE ALL ON FUNCTION public.admin_resolver_aviso(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_resolver_aviso(uuid, boolean) TO authenticated;

-- ── estoque abaixo de 3, uma vez por cruzamento ────────────────────────

CREATE OR REPLACE FUNCTION private.avaliar_estoque_baixo(
  p_produto_id text,
  p_antes integer,
  p_depois integer,
  p_tipo text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_nome text;
  v_msg text;
BEGIN
  IF p_produto_id IS NULL OR p_antes IS NULL OR p_depois IS NULL THEN
    RETURN;
  END IF;
  IF p_antes = p_depois THEN
    RETURN;
  END IF;

  IF p_depois >= 3 THEN
    DELETE FROM private.avisos_dedupe
    WHERE tipo = 'estoque_baixo'
      AND chave = p_produto_id;
    RETURN;
  END IF;

  IF p_antes < 3 THEN
    RETURN;
  END IF;
  IF p_tipo NOT IN ('venda', 'ajuste', 'producao') THEN
    RETURN;
  END IF;

  SELECT pg_catalog.left(pg_catalog.btrim(COALESCE(nome, '')), 80)
  INTO v_nome
  FROM public.produtos
  WHERE id = p_produto_id;

  IF v_nome IS NULL OR v_nome = '' THEN
    v_nome := pg_catalog.left(p_produto_id, 80);
  END IF;

  v_msg := v_nome || ' está com ' || p_depois::text || ' ' ||
    CASE WHEN p_depois = 1 THEN 'vela' ELSE 'velas' END ||
    ' no estoque.';

  PERFORM private.registrar_aviso(
    'estoque_baixo',
    p_produto_id,
    v_msg,
    pg_catalog.jsonb_build_object('produto', v_nome, 'disponivel', p_depois)
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'aviso de estoque ignorado para %: %', p_produto_id, SQLERRM;
END;
$fn$;

COMMENT ON FUNCTION private.avaliar_estoque_baixo(text, integer, integer, text) IS
  'Alerta quando o disponível cruza para baixo de 3 em venda, produção ou ajuste. Voltar a 3 libera a próxima vez.';

REVOKE ALL ON FUNCTION private.avaliar_estoque_baixo(text, integer, integer, text) FROM PUBLIC, anon, authenticated, service_role;

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

  BEGIN
    PERFORM private.avaliar_estoque_baixo(NEW.produto_id, OLD.disponivel, NEW.disponivel, tipo);
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'aviso de estoque ignorado para %: %', NEW.produto_id, SQLERRM;
  END;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION private.registrar_movimento_estoque() IS
  'Depois de um UPDATE em estoque, grava o histórico e, se o disponível cruzou para baixo de 3, o aviso. Falha aqui não desfaz a baixa.';

REVOKE ALL ON FUNCTION private.registrar_movimento_estoque() FROM PUBLIC, anon, authenticated;

-- ── cron diário ────────────────────────────────────────────────────────

DO $cron$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_net;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'etapa 5: pg_net nao instalado (%). O cron fica sem HTTP.', SQLERRM;
  END;

  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'etapa 5: pg_cron nao instalado (%). Agende manutencao-diaria no painel.', SQLERRM;
  END;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'foveo_manutencao_diaria') THEN
      PERFORM cron.unschedule('foveo_manutencao_diaria');
    END IF;
    PERFORM cron.schedule(
      'foveo_manutencao_diaria',
      '30 11 * * *',
      'SELECT private.disparar_manutencao_diaria()'
    );
  END IF;
END;
$cron$;

NOTIFY pgrst, 'reload schema';
