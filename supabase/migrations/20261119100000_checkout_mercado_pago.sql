-- Checkout com Mercado Pago (Orders API / Checkout Pro).
--
-- O projeto foveo-loja já tem as migrations de 18/11/2026
-- (init_loja_tables_rls_catalogo_pricing, seed e deny RLS). Elas não estão
-- neste repositório. Este arquivo só acrescenta o que o pagamento precisa.
-- Rodar uma vez, no SQL editor do projeto. Não usar `supabase db push`
-- enquanto aquelas três versões existirem só no remoto: a CLI recusa
-- o histórico.
--
-- A view public.catalogo continua a mesma. private.catalogo_rows passa a
-- descontar só reservas de pedidos pendentes que ainda não venceram, então
-- o estoque da vitrine solta sozinho aos 30 minutos. A baixa de
-- estoque.reservado acontece em private.expirar_reservas, chamada ao criar
-- um pedido e depois de cada webhook.

-- ── colunas ────────────────────────────────────────────────────────────

ALTER TABLE public.pedidos
  ADD COLUMN mp_order_id text,
  ADD COLUMN mp_status text,
  ADD COLUMN mp_status_detail text,
  ADD COLUMN mp_checkout_url text,
  ADD COLUMN frete jsonb,
  ADD COLUMN idempotency_key text,
  ADD COLUMN pago_em timestamptz;

ALTER TABLE public.pedidos
  ADD CONSTRAINT pedidos_frete_objeto
    CHECK (frete IS NULL OR jsonb_typeof(frete) = 'object'),
  ADD CONSTRAINT pedidos_mp_order_id_len
    CHECK (mp_order_id IS NULL OR char_length(mp_order_id) BETWEEN 1 AND 64),
  ADD CONSTRAINT pedidos_idempotency_key_fmt
    CHECK (
      idempotency_key IS NULL
      OR idempotency_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    );

CREATE UNIQUE INDEX pedidos_mp_order_id_key
  ON public.pedidos (mp_order_id)
  WHERE mp_order_id IS NOT NULL;

CREATE UNIQUE INDEX pedidos_idempotency_key_key
  ON public.pedidos (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.pedidos.mp_order_id IS
  'ID da order no Mercado Pago (POST /v1/orders, Checkout Pro). Não é preference id.';
COMMENT ON COLUMN public.pedidos.mp_checkout_url IS
  'checkout_url devolvida pela Orders API. Reusada se a mesma idempotency key repetir.';
COMMENT ON COLUMN public.pedidos.frete IS
  'Frete confirmado no servidor: id, transportadora, servico, preco_centavos, prazo_dias.';
COMMENT ON COLUMN public.pedidos.idempotency_key IS
  'UUID da tentativa, enviado em X-Idempotency-Key.';
COMMENT ON COLUMN public.pedidos.endereco IS
  'Endereço de entrega. Nulo quando entrega_tipo é retirada.';
COMMENT ON COLUMN public.pedidos.pago_em IS
  'Quando o pedido passou a pago.';

-- ── estoque: soltar reservas vencidas ──────────────────────────────────

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
  SET status = 'expirado'
  WHERE id = ANY (ids);

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$fn$;

REVOKE ALL ON FUNCTION private.expirar_reservas() FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO service_role;
GRANT EXECUTE ON FUNCTION private.expirar_reservas() TO service_role;

-- ── catálogo: reserva vencida não esconde a vela ───────────────────────

CREATE OR REPLACE FUNCTION private.catalogo_rows()
RETURNS TABLE(
  id text,
  nome text,
  descricao_curta text,
  preco_unitario_centavos integer,
  ordem integer,
  disponivel_real integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
  SELECT
    p.id,
    p.nome,
    p.descricao_curta,
    p.preco_unitario_centavos,
    p.ordem,
    GREATEST(
      COALESCE(e.disponivel, 0) - COALESCE((
        SELECT SUM(
          CASE
            WHEN elem->>'qtd' ~ '^[0-9]+$' THEN (elem->>'qtd')::integer
            ELSE 0
          END
        )
        FROM public.pedidos AS ped
        CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(ped.itens) AS elem
        WHERE ped.status = 'pendente'
          AND (ped.reserva_expira_em IS NULL OR ped.reserva_expira_em > pg_catalog.now())
          AND elem->>'produto_id' = p.id
      ), 0),
      0
    )::integer AS disponivel_real
  FROM public.produtos AS p
  LEFT JOIN public.estoque AS e ON e.produto_id = p.id
  WHERE p.ativo
  ORDER BY p.ordem;
$fn$;

-- ── criar a reserva ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION private.reservar_pedido(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  chave text;
  nome text;
  email text;
  telefone text;
  entrega text;
  frete_id text;
  frete_centavos integer;
  frete jsonb;
  endereco jsonb;
  bruto jsonb;
  itens_norm jsonb;
  endereco_norm jsonb;
  frete_norm jsonb;
  existente public.pedidos%ROWTYPE;
  linha jsonb;
  pid text;
  qtd integer;
  qtd_total integer := 0;
  subtotal integer := 0;
  combo integer;
  desconto integer;
  total integer;
  prod_nome text;
  prod_preco integer;
  prod_ativo boolean;
  disp integer;
  resv integer;
  novo uuid;
  itens_gravar jsonb := '[]'::jsonb;
BEGIN
  PERFORM private.expirar_reservas();

  IF payload IS NULL OR pg_catalog.jsonb_typeof(payload) <> 'object' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'pedido_invalido');
  END IF;

  chave := payload->>'idempotency_key';
  IF chave IS NULL
     OR chave !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'pedido_invalido');
  END IF;

  nome := pg_catalog.btrim(COALESCE(payload->>'cliente_nome', ''));
  email := lower(pg_catalog.btrim(COALESCE(payload->>'cliente_email', '')));
  telefone := COALESCE(payload->>'cliente_telefone', '');
  entrega := payload->>'entrega_tipo';
  frete := payload->'frete';
  endereco := NULLIF(payload->'endereco', 'null'::jsonb);
  bruto := payload->'itens';

  IF char_length(nome) < 2 OR char_length(nome) > 120 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'pedido_invalido');
  END IF;
  IF email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR char_length(email) > 120 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'pedido_invalido');
  END IF;
  IF telefone !~ '^[0-9]{10,13}$' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'pedido_invalido');
  END IF;
  IF entrega NOT IN ('envio', 'retirada') THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'pedido_invalido');
  END IF;
  IF frete IS NULL OR pg_catalog.jsonb_typeof(frete) <> 'object' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'pedido_invalido');
  END IF;
  IF (frete->>'preco_centavos') !~ '^[0-9]+$' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'pedido_invalido');
  END IF;

  frete_centavos := (frete->>'preco_centavos')::integer;
  frete_id := frete->>'id';
  IF frete_id IS NULL OR char_length(frete_id) < 1 OR char_length(frete_id) > 40 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'pedido_invalido');
  END IF;

  IF entrega = 'retirada' THEN
    IF frete_id <> 'retirada' OR frete_centavos <> 0 OR endereco IS NOT NULL THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'pedido_invalido');
    END IF;
    endereco_norm := NULL;
  ELSE
    IF frete_id = 'retirada' OR frete_centavos < 0 THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'pedido_invalido');
    END IF;
    IF endereco IS NULL OR pg_catalog.jsonb_typeof(endereco) <> 'object' THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'pedido_invalido');
    END IF;
    endereco_norm := pg_catalog.jsonb_build_object(
      'cep', endereco->>'cep',
      'logradouro', endereco->>'logradouro',
      'numero', endereco->>'numero',
      'complemento', NULLIF(endereco->>'complemento', ''),
      'bairro', endereco->>'bairro',
      'cidade', endereco->>'cidade',
      'uf', endereco->>'uf'
    );
  END IF;

  frete_norm := pg_catalog.jsonb_build_object(
    'id', frete_id,
    'transportadora', COALESCE(frete->>'transportadora', ''),
    'servico', COALESCE(frete->>'servico', ''),
    'preco_centavos', frete_centavos,
    'prazo_dias', frete->'prazo_dias'
  );

  IF bruto IS NULL OR pg_catalog.jsonb_typeof(bruto) <> 'array'
     OR pg_catalog.jsonb_array_length(bruto) < 1
     OR pg_catalog.jsonb_array_length(bruto) > 20 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'pedido_invalido');
  END IF;

  SELECT pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object('produto_id', s.produto_id, 'qtd', s.qtd)
    ORDER BY s.produto_id
  )
  INTO itens_norm
  FROM (
    SELECT elem->>'produto_id' AS produto_id, (elem->>'qtd')::integer AS qtd
    FROM pg_catalog.jsonb_array_elements(bruto) AS elem
    WHERE elem->>'produto_id' ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
      AND elem->>'qtd' ~ '^[0-9]+$'
      AND (elem->>'qtd')::integer BETWEEN 1 AND 99
  ) AS s;

  IF itens_norm IS NULL
     OR pg_catalog.jsonb_array_length(itens_norm) <> pg_catalog.jsonb_array_length(bruto) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'pedido_invalido');
  END IF;

  -- O navegador já soma quantidades do mesmo id. Duplicata aqui seria reserva em dobro.
  IF (
    SELECT COUNT(*)
    FROM pg_catalog.jsonb_array_elements(itens_norm) AS elem
  ) <> (
    SELECT COUNT(DISTINCT elem->>'produto_id')
    FROM pg_catalog.jsonb_array_elements(itens_norm) AS elem
  ) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'pedido_invalido');
  END IF;

  SELECT *
  INTO existente
  FROM public.pedidos
  WHERE idempotency_key = chave
  FOR UPDATE;

  IF FOUND THEN
    IF existente.status = 'pendente'
       AND existente.cliente_nome = nome
       AND existente.cliente_email = email
       AND existente.cliente_telefone IS NOT DISTINCT FROM telefone
       AND existente.entrega_tipo = entrega
       AND existente.frete_centavos = frete_centavos
       AND existente.frete = frete_norm
       AND existente.endereco IS NOT DISTINCT FROM endereco_norm
       AND (
         SELECT pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object('produto_id', elem->>'produto_id', 'qtd', (elem->>'qtd')::integer)
           ORDER BY elem->>'produto_id'
         )
         FROM pg_catalog.jsonb_array_elements(existente.itens) AS elem
       ) = itens_norm
    THEN
      RETURN pg_catalog.jsonb_build_object(
        'ok', true,
        'reusado', true,
        'id', existente.id,
        'total_centavos', existente.total_centavos,
        'frete_centavos', existente.frete_centavos,
        'mp_order_id', existente.mp_order_id,
        'mp_checkout_url', existente.mp_checkout_url,
        'itens', existente.itens
      );
    END IF;
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'idempotencia');
  END IF;

  FOR linha IN
    SELECT value
    FROM pg_catalog.jsonb_array_elements(itens_norm) AS t(value)
  LOOP
    pid := linha->>'produto_id';
    qtd := (linha->>'qtd')::integer;
    qtd_total := qtd_total + qtd;

    SELECT p.nome, p.preco_unitario_centavos, p.ativo
    INTO prod_nome, prod_preco, prod_ativo
    FROM public.produtos AS p
    WHERE p.id = pid;

    IF NOT FOUND OR prod_ativo IS NOT TRUE THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'pedido_invalido');
    END IF;

    PERFORM 1
    FROM public.estoque
    WHERE produto_id = pid
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'estoque');
    END IF;

    subtotal := subtotal + qtd * prod_preco;
    itens_gravar := itens_gravar || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'produto_id', pid,
        'nome', prod_nome,
        'qtd', qtd,
        'preco_unitario_centavos', prod_preco
      )
    );
  END LOOP;

  IF qtd_total < 1 OR qtd_total > 99 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'pedido_invalido');
  END IF;

  -- Confere de novo, já com as linhas de estoque travadas, na ordem do id.
  FOR linha IN
    SELECT value
    FROM pg_catalog.jsonb_array_elements(itens_norm) AS t(value)
  LOOP
    pid := linha->>'produto_id';
    qtd := (linha->>'qtd')::integer;
    SELECT e.disponivel, e.reservado
    INTO disp, resv
    FROM public.estoque AS e
    WHERE e.produto_id = pid;

    IF disp - resv < qtd THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'estoque');
    END IF;
  END LOOP;

  combo := public.calcular_preco_centavos(qtd_total);
  desconto := GREATEST(subtotal - combo, 0);
  total := combo + frete_centavos;

  BEGIN
    INSERT INTO public.pedidos (
    status,
    cliente_nome,
    cliente_email,
    cliente_telefone,
    endereco,
    entrega_tipo,
    itens,
    subtotal_centavos,
    desconto_centavos,
    frete_centavos,
    total_centavos,
    frete,
    idempotency_key,
    reserva_expira_em
  ) VALUES (
    'pendente',
    nome,
    email,
    telefone,
    endereco_norm,
    entrega,
    itens_gravar,
    subtotal,
    desconto,
    frete_centavos,
    total,
    frete_norm,
    chave,
    pg_catalog.now() + interval '30 minutes'
  )
    RETURNING id INTO novo;
  EXCEPTION
    WHEN unique_violation THEN
      novo := NULL;
  END;

  IF novo IS NULL THEN
    SELECT *
    INTO existente
    FROM public.pedidos
    WHERE idempotency_key = chave;

    IF NOT FOUND
       OR existente.status <> 'pendente'
       OR existente.cliente_nome <> nome
       OR existente.cliente_email <> email
       OR existente.cliente_telefone IS DISTINCT FROM telefone
       OR existente.entrega_tipo <> entrega
       OR existente.frete_centavos <> frete_centavos
       OR existente.frete IS DISTINCT FROM frete_norm
       OR existente.endereco IS DISTINCT FROM endereco_norm
       OR (
         SELECT pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object('produto_id', elem->>'produto_id', 'qtd', (elem->>'qtd')::integer)
           ORDER BY elem->>'produto_id'
         )
         FROM pg_catalog.jsonb_array_elements(existente.itens) AS elem
       ) IS DISTINCT FROM itens_norm
    THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'idempotencia');
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'ok', true,
      'reusado', true,
      'id', existente.id,
      'total_centavos', existente.total_centavos,
      'frete_centavos', existente.frete_centavos,
      'mp_order_id', existente.mp_order_id,
      'mp_checkout_url', existente.mp_checkout_url,
      'itens', existente.itens
    );
  END IF;

  FOR linha IN
    SELECT value
    FROM pg_catalog.jsonb_array_elements(itens_norm) AS t(value)
  LOOP
    UPDATE public.estoque
    SET reservado = reservado + (linha->>'qtd')::integer
    WHERE produto_id = linha->>'produto_id';
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'reusado', false,
    'id', novo,
    'total_centavos', total,
    'frete_centavos', frete_centavos,
    'mp_order_id', NULL,
    'mp_checkout_url', NULL,
    'itens', itens_gravar
  );
END;
$fn$;

REVOKE ALL ON FUNCTION private.reservar_pedido(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.reservar_pedido(jsonb) TO service_role;

-- ── gravar a order depois que o Mercado Pago responde ──────────────────

CREATE OR REPLACE FUNCTION private.registrar_order_mp(
  p_pedido_id uuid,
  p_mp_order_id text,
  p_checkout_url text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  ped public.pedidos%ROWTYPE;
BEGIN
  IF p_mp_order_id IS NULL OR char_length(p_mp_order_id) < 1 OR char_length(p_mp_order_id) > 64 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'pedido_invalido');
  END IF;
  IF p_checkout_url IS NULL OR char_length(p_checkout_url) < 12 OR char_length(p_checkout_url) > 500 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'pedido_invalido');
  END IF;

  SELECT *
  INTO ped
  FROM public.pedidos
  WHERE id = p_pedido_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'nao_encontrado');
  END IF;

  IF ped.mp_order_id IS NOT NULL AND ped.mp_order_id <> p_mp_order_id THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'erro', 'divergente');
  END IF;

  UPDATE public.pedidos
  SET mp_order_id = p_mp_order_id,
      mp_checkout_url = p_checkout_url
  WHERE id = ped.id;

  RETURN pg_catalog.jsonb_build_object('ok', true, 'id', ped.id);
END;
$fn$;

REVOKE ALL ON FUNCTION private.registrar_order_mp(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.registrar_order_mp(uuid, text, text) TO service_role;

-- ── soltar a reserva se a order nem chegou a ser criada ────────────────

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
  SET status = 'cancelado'
  WHERE id = ped.id;

  RETURN pg_catalog.jsonb_build_object('ok', true, 'status', 'cancelado');
END;
$fn$;

REVOKE ALL ON FUNCTION private.liberar_pedido(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.liberar_pedido(uuid) TO service_role;

-- ── webhook: pago consome, recusa/cancela/expira solta ─────────────────
-- p_acao: pago | recusado | expirado | cancelado | registrar
-- registrar só grava o espelho do Mercado Pago e deixa o pedido pendente.

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

-- Wrappers no schema public para a Edge Function chamar via PostgREST.
-- SECURITY INVOKER: anon e authenticated não têm EXECUTE. O service_role
-- chama, e a função private (SECURITY DEFINER) faz a escrita.

CREATE OR REPLACE FUNCTION public.expirar_reservas()
RETURNS integer
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog
AS $fn$
  SELECT private.expirar_reservas();
$fn$;

CREATE OR REPLACE FUNCTION public.reservar_pedido(payload jsonb)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog
AS $fn$
  SELECT private.reservar_pedido(payload);
$fn$;

CREATE OR REPLACE FUNCTION public.registrar_order_mp(
  p_pedido_id uuid,
  p_mp_order_id text,
  p_checkout_url text
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog
AS $fn$
  SELECT private.registrar_order_mp(p_pedido_id, p_mp_order_id, p_checkout_url);
$fn$;

CREATE OR REPLACE FUNCTION public.liberar_pedido(p_pedido_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog
AS $fn$
  SELECT private.liberar_pedido(p_pedido_id);
$fn$;

CREATE OR REPLACE FUNCTION public.aplicar_retorno_mp(
  p_pedido_id uuid,
  p_mp_order_id text,
  p_mp_payment_id text,
  p_mp_status text,
  p_mp_status_detail text,
  p_total_centavos integer,
  p_acao text
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog
AS $fn$
  SELECT private.aplicar_retorno_mp(
    p_pedido_id,
    p_mp_order_id,
    p_mp_payment_id,
    p_mp_status,
    p_mp_status_detail,
    p_total_centavos,
    p_acao
  );
$fn$;

REVOKE ALL ON FUNCTION public.expirar_reservas() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reservar_pedido(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.registrar_order_mp(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.liberar_pedido(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aplicar_retorno_mp(uuid, text, text, text, text, integer, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.expirar_reservas() TO service_role;
GRANT EXECUTE ON FUNCTION public.reservar_pedido(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.registrar_order_mp(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.liberar_pedido(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.aplicar_retorno_mp(uuid, text, text, text, text, integer, text) TO service_role;
