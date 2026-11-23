-- Feedback do site (/feedback/) no projeto foveo-loja.
--
-- Rodar o arquivo inteiro no SQL editor, depois de
-- 20261120220000_admin_etapa5_avisos.sql. Não usar `supabase db push`.
-- Não rode daqui. A função enviar-feedback só entra depois desta migration.
--
-- O que entra:
--   * public.feedback_respostas guarda uma resposta por envio.
--   * anon não tem GRANT. Quem está no site não lê a tabela.
--     O insert passa pela função enviar-feedback, que chama
--     public.enviar_feedback com a service role. A RPC valida de novo,
--     ignora o honeypot e segura 6 envios por IP a cada hora, com 20
--     segundos entre um e outro. Sem essa trava, um INSERT direto do
--     anon pularia o limite.
--   * authenticated só lê, marca is_test e apaga se public.is_admin().
--     O e-mail do JWT tem de ser contato@foveoatelie.com.br.
--     UPDATE de outra coluna não tem GRANT.
--   * ip_hash é o SHA-256 do IP. O painel não seleciona essa coluna.
--   * O aviso feedback_novo usa o id da resposta como chave, então cada
--     envio avisa uma vez. O webhook é o mesmo dos avisos da loja
--     (GROKBOT_AVISOS_WEBHOOK_URL e GROKBOT_AVISOS_WEBHOOK_KEY).
--     Não há secret novo.
--
-- O formulário antigo da Netlify não está neste arquivo. Eram testes de
-- 04/11 e o CSV não está no repositório. Se for importar à mão, grave
-- is_test = true. O insert direto não dispara o aviso.

CREATE TABLE IF NOT EXISTS public.feedback_respostas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  candles text[] NOT NULL,
  rating smallint NOT NULL,
  sensacao text NOT NULL DEFAULT '',
  mudaria text NOT NULL DEFAULT '',
  depoimento text NOT NULL DEFAULT '',
  instagram_share text NOT NULL,
  novidades text NOT NULL DEFAULT '',
  nome text NOT NULL DEFAULT '',
  contato text NOT NULL DEFAULT '',
  user_agent text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT '',
  is_test boolean NOT NULL DEFAULT false,
  ip_hash text NOT NULL,
  CONSTRAINT feedback_respostas_rating_check CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT feedback_respostas_share_check CHECK (
    instagram_share IN ('Sim, com meu nome', 'Sim, anônimo', 'Não')
  ),
  CONSTRAINT feedback_respostas_novidades_check CHECK (
    novidades IN ('', 'Sim', 'Não')
  ),
  CONSTRAINT feedback_respostas_sensacao_check CHECK (char_length(sensacao) <= 2000),
  CONSTRAINT feedback_respostas_mudaria_check CHECK (char_length(mudaria) <= 2000),
  CONSTRAINT feedback_respostas_depoimento_check CHECK (char_length(depoimento) <= 2000),
  CONSTRAINT feedback_respostas_nome_check CHECK (char_length(nome) <= 120),
  CONSTRAINT feedback_respostas_contato_check CHECK (char_length(contato) <= 160),
  CONSTRAINT feedback_respostas_ua_check CHECK (char_length(user_agent) <= 300),
  CONSTRAINT feedback_respostas_source_check CHECK (char_length(source) <= 80),
  CONSTRAINT feedback_respostas_hash_check CHECK (ip_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT feedback_respostas_candles_check CHECK (
    cardinality(candles) BETWEEN 1 AND 4
    AND candles <@ ARRAY['Acolher', 'Despertar', 'Permanecer', 'Não lembro']::text[]
  )
);

COMMENT ON TABLE public.feedback_respostas IS
  'Respostas do formulário /feedback/. Escrita só por enviar_feedback. Leitura, marca de teste e exclusão só do admin.';

COMMENT ON COLUMN public.feedback_respostas.ip_hash IS
  'SHA-256 do IP, com prefixo fixo. Serve ao limite de envio. O painel não lê esta coluna.';

COMMENT ON COLUMN public.feedback_respostas.is_test IS
  'Resposta de teste. O formulário público grava falso. O painel pode marcar depois.';

CREATE INDEX IF NOT EXISTS feedback_respostas_recentes_idx
  ON public.feedback_respostas (created_at DESC);

CREATE INDEX IF NOT EXISTS feedback_respostas_ip_hora_idx
  ON public.feedback_respostas (ip_hash, created_at DESC);

ALTER TABLE public.feedback_respostas ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.feedback_respostas FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT (
  id,
  created_at,
  candles,
  rating,
  sensacao,
  mudaria,
  depoimento,
  instagram_share,
  novidades,
  nome,
  contato,
  user_agent,
  source,
  is_test
) ON TABLE public.feedback_respostas TO authenticated;

GRANT UPDATE (is_test) ON TABLE public.feedback_respostas TO authenticated;
GRANT DELETE ON TABLE public.feedback_respostas TO authenticated;

DROP POLICY IF EXISTS feedback_respostas_admin_leitura ON public.feedback_respostas;
CREATE POLICY feedback_respostas_admin_leitura
  ON public.feedback_respostas
  FOR SELECT
  TO authenticated
  USING ((SELECT public.is_admin()));

DROP POLICY IF EXISTS feedback_respostas_admin_atualizacao ON public.feedback_respostas;
CREATE POLICY feedback_respostas_admin_atualizacao
  ON public.feedback_respostas
  FOR UPDATE
  TO authenticated
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

DROP POLICY IF EXISTS feedback_respostas_admin_exclusao ON public.feedback_respostas;
CREATE POLICY feedback_respostas_admin_exclusao
  ON public.feedback_respostas
  FOR DELETE
  TO authenticated
  USING ((SELECT public.is_admin()));

-- ── aviso feedback_novo ────────────────────────────────────────────────

ALTER TABLE public.avisos DROP CONSTRAINT IF EXISTS avisos_tipo_check;
ALTER TABLE public.avisos ADD CONSTRAINT avisos_tipo_check CHECK (
  tipo IN (
    'estoque_baixo',
    'saldo_baixo',
    'problema_entrega',
    'token_melhor_envio',
    'feedback_novo'
  )
);

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
  IF v_tipo NOT IN (
    'estoque_baixo',
    'saldo_baixo',
    'problema_entrega',
    'token_melhor_envio',
    'feedback_novo'
  ) THEN
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
  'Insere o aviso se a chave ainda não está na trava. feedback_novo usa o id da resposta, uma vez por envio.';

REVOKE ALL ON FUNCTION private.registrar_aviso(text, text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- ── insert com validação e limite ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.enviar_feedback(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_ordem text[] := ARRAY['Acolher', 'Despertar', 'Permanecer', 'Não lembro'];
  v_candles text[] := ARRAY[]::text[];
  v_item text;
  v_rating integer;
  v_share text;
  v_novidades text;
  v_sensacao text;
  v_mudaria text;
  v_depoimento text;
  v_nome text;
  v_contato text;
  v_ua text;
  v_source text;
  v_hash text;
  v_bot text;
  v_recentes integer;
  v_ultimo timestamptz;
  v_id uuid;
BEGIN
  IF p_payload IS NULL OR pg_catalog.jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'invalido');
  END IF;

  v_bot := pg_catalog.btrim(COALESCE(p_payload->>'bot', ''));
  IF v_bot = '' THEN
    v_bot := pg_catalog.btrim(COALESCE(p_payload->>'bot-field', ''));
  END IF;
  IF v_bot <> '' THEN
    RETURN pg_catalog.jsonb_build_object('ok', true);
  END IF;

  IF pg_catalog.jsonb_typeof(p_payload->'candles') IS DISTINCT FROM 'array' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'invalido');
  END IF;

  FOR v_item IN
    SELECT pg_catalog.btrim(elem)
    FROM pg_catalog.jsonb_array_elements_text(p_payload->'candles') AS elem
  LOOP
    IF v_item = ANY (v_ordem) THEN
      IF NOT (v_item = ANY (v_candles)) THEN
        v_candles := v_candles || v_item;
      END IF;
    ELSIF v_item <> '' THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'invalido');
    END IF;
  END LOOP;

  IF pg_catalog.cardinality(v_candles) < 1 OR pg_catalog.cardinality(v_candles) > 4 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'invalido');
  END IF;

  SELECT COALESCE(pg_catalog.array_agg(t.nome ORDER BY t.ordem), ARRAY[]::text[])
  INTO v_candles
  FROM pg_catalog.unnest(v_ordem) WITH ORDINALITY AS t(nome, ordem)
  WHERE t.nome = ANY (v_candles);

  IF COALESCE(p_payload->>'rating', '') !~ '^[1-5]$' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'invalido');
  END IF;
  v_rating := (p_payload->>'rating')::integer;

  v_share := pg_catalog.btrim(COALESCE(p_payload->>'instagram_share', ''));
  IF v_share NOT IN ('Sim, com meu nome', 'Sim, anônimo', 'Não') THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'invalido');
  END IF;

  v_novidades := pg_catalog.btrim(COALESCE(p_payload->>'novidades', ''));
  IF v_novidades NOT IN ('', 'Sim', 'Não') THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'invalido');
  END IF;

  v_sensacao := pg_catalog.btrim(COALESCE(p_payload->>'sensacao', ''));
  v_mudaria := pg_catalog.btrim(COALESCE(p_payload->>'mudaria', ''));
  v_depoimento := pg_catalog.btrim(COALESCE(p_payload->>'depoimento', ''));
  v_nome := pg_catalog.btrim(COALESCE(p_payload->>'nome', ''));
  v_contato := pg_catalog.btrim(COALESCE(p_payload->>'contato', ''));
  IF char_length(v_sensacao) > 2000
    OR char_length(v_mudaria) > 2000
    OR char_length(v_depoimento) > 2000
    OR char_length(v_nome) > 120
    OR char_length(v_contato) > 160 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'longo');
  END IF;

  v_ua := pg_catalog.left(pg_catalog.btrim(COALESCE(p_payload->>'user_agent', '')), 300);
  v_source := pg_catalog.left(pg_catalog.btrim(COALESCE(p_payload->>'source', '')), 80);
  v_hash := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_payload->>'ip_hash', '')));
  IF v_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'invalido');
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('feedback:' || v_hash)::bigint);

  SELECT count(*)::integer, max(created_at)
  INTO v_recentes, v_ultimo
  FROM public.feedback_respostas
  WHERE ip_hash = v_hash
    AND created_at > pg_catalog.now() - interval '1 hour';

  IF v_recentes >= 6
    OR (v_ultimo IS NOT NULL AND v_ultimo > pg_catalog.now() - interval '20 seconds') THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'taxa');
  END IF;

  INSERT INTO public.feedback_respostas (
    candles,
    rating,
    sensacao,
    mudaria,
    depoimento,
    instagram_share,
    novidades,
    nome,
    contato,
    user_agent,
    source,
    is_test,
    ip_hash
  ) VALUES (
    v_candles,
    v_rating,
    v_sensacao,
    v_mudaria,
    v_depoimento,
    v_share,
    v_novidades,
    v_nome,
    v_contato,
    v_ua,
    v_source,
    false,
    v_hash
  )
  RETURNING id INTO v_id;

  RETURN pg_catalog.jsonb_build_object('ok', true, 'id', v_id);
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'feedback nao gravado: %', SQLERRM;
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'indisponivel');
END;
$fn$;

COMMENT ON FUNCTION public.enviar_feedback(jsonb) IS
  'Grava uma resposta do formulário. Honeypot devolve ok sem gravar. 6 por IP a cada hora, 20 segundos entre envios. Só service_role.';

REVOKE ALL ON FUNCTION public.enviar_feedback(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enviar_feedback(jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
