-- Contato do feedback em três campos.
--
-- Rodar o arquivo inteiro no SQL editor, depois de
-- 20261123210000_feedback_respostas.sql. Não usar `supabase db push`.
-- Não rode daqui. A função enviar-feedback atualizada só entra depois.
--
-- O que entra:
--   * nome_completo, whatsapp e email nas respostas novas.
--   * nome e contato continuam para as respostas que já existem.
--     O formulário antigo, que manda só esses dois, segue gravando.
--   * whatsapp fica só com dígitos e o 55. E-mail vazio é permitido
--     se o WhatsApp veio. Os dois vazios, com novidades Sim, não grava.
--   * Quem não aceitou contato não guarda esses três campos, mesmo
--     que o corpo tenha vindo preenchido.
--   * authenticated ganha SELECT nas colunas novas. Continua sem
--     UPDATE nelas. anon continua sem GRANT.

ALTER TABLE public.feedback_respostas
  ADD COLUMN nome_completo text NOT NULL DEFAULT '',
  ADD COLUMN whatsapp text NOT NULL DEFAULT '',
  ADD COLUMN email text NOT NULL DEFAULT '';

ALTER TABLE public.feedback_respostas
  ADD CONSTRAINT feedback_respostas_nome_completo_check
    CHECK (char_length(nome_completo) <= 160),
  ADD CONSTRAINT feedback_respostas_whatsapp_check
    CHECK (whatsapp = '' OR whatsapp ~ '^55[1-9][1-9][0-9]{8,9}$'),
  ADD CONSTRAINT feedback_respostas_email_check
    CHECK (
      email = ''
      OR (
        char_length(email) <= 254
        AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'
      )
    );

COMMENT ON COLUMN public.feedback_respostas.nome_completo IS
  'Nome completo de quem aceitou contato. Resposta antiga fica em nome.';

COMMENT ON COLUMN public.feedback_respostas.whatsapp IS
  'WhatsApp só com dígitos, começando em 55. Vazio se a pessoa não deixou telefone.';

COMMENT ON COLUMN public.feedback_respostas.email IS
  'E-mail de quem aceitou contato. Vazio se a pessoa não deixou e-mail.';

COMMENT ON COLUMN public.feedback_respostas.contato IS
  'Texto único das respostas antigas. O formulário novo grava whatsapp e email.';

GRANT SELECT (nome_completo, whatsapp, email)
  ON TABLE public.feedback_respostas TO authenticated;

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
  v_nome_completo text := '';
  v_whatsapp text := '';
  v_email text := '';
  v_zap_bruto text := '';
  v_digits text := '';
  v_novo boolean := false;
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

  v_novo := pg_catalog.jsonb_exists(p_payload, 'nome_completo')
    OR pg_catalog.jsonb_exists(p_payload, 'whatsapp')
    OR pg_catalog.jsonb_exists(p_payload, 'email');

  IF v_novo AND v_novidades = 'Sim' THEN
    v_nome_completo := pg_catalog.btrim(COALESCE(p_payload->>'nome_completo', ''));
    v_email := pg_catalog.btrim(COALESCE(p_payload->>'email', ''));
    v_zap_bruto := pg_catalog.btrim(COALESCE(p_payload->>'whatsapp', ''));
  END IF;

  IF char_length(v_sensacao) > 2000
    OR char_length(v_mudaria) > 2000
    OR char_length(v_depoimento) > 2000
    OR char_length(v_nome) > 120
    OR char_length(v_contato) > 160
    OR char_length(v_nome_completo) > 160
    OR char_length(v_email) > 254
    OR char_length(v_zap_bruto) > 40 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'longo');
  END IF;

  IF v_zap_bruto <> '' THEN
    v_digits := pg_catalog.regexp_replace(v_zap_bruto, '[^0-9]', '', 'g');
    IF v_digits ~ '^00' THEN
      v_digits := pg_catalog.substring(v_digits FROM 3);
    END IF;
    IF v_digits ~ '^0' AND char_length(v_digits) BETWEEN 11 AND 14 THEN
      v_digits := pg_catalog.substring(v_digits FROM 2);
    END IF;
    IF v_digits ~ '^55' AND char_length(v_digits) IN (12, 13) THEN
      v_digits := pg_catalog.substring(v_digits FROM 3);
    END IF;
    IF v_digits ~ '^[1-9][1-9][0-9]{8,9}$' THEN
      v_whatsapp := '55' || v_digits;
    ELSE
      RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'invalido');
    END IF;
  END IF;

  IF v_email <> '' AND v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'invalido');
  END IF;

  IF v_novo AND v_novidades = 'Sim' AND v_whatsapp = '' AND v_email = '' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'invalido');
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
    nome_completo,
    whatsapp,
    email,
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
    v_nome_completo,
    v_whatsapp,
    v_email,
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
  'Grava uma resposta do formulário. Sem as chaves novas, grava nome e contato como antes. Com nome_completo, whatsapp ou email, e novidades Sim, exige um contato válido. Honeypot devolve ok sem gravar. 6 por IP a cada hora, 20 segundos entre envios. Só service_role.';

REVOKE ALL ON FUNCTION public.enviar_feedback(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enviar_feedback(jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
