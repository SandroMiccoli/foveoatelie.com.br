-- Código legível do pedido: YYMMDDNNN, no fuso de São Paulo.
--
-- A sequência é por dia (001, 002…), numa tabela pequena. Não é um
-- contador global, então o número não revela quantos pedidos a loja já teve.
-- Rodar o arquivo inteiro de uma vez, no SQL editor, depois de aprovar.
-- Não usar `supabase db push`.

LOCK TABLE public.pedidos IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE private.pedido_codigo_dia (
  dia date PRIMARY KEY,
  ultimo integer NOT NULL
);

REVOKE ALL ON TABLE private.pedido_codigo_dia FROM PUBLIC;

CREATE FUNCTION private.proximo_codigo_pedido(p_quando timestamptz)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_dia date;
  v_n integer;
BEGIN
  v_dia := (COALESCE(p_quando, pg_catalog.now()) AT TIME ZONE 'America/Sao_Paulo')::date;

  INSERT INTO private.pedido_codigo_dia AS c (dia, ultimo)
  VALUES (v_dia, 1)
  ON CONFLICT (dia) DO UPDATE
    SET ultimo = c.ultimo + 1
  RETURNING ultimo INTO v_n;

  IF v_n > 999 THEN
    RAISE EXCEPTION 'codigo_pedido_esgotado' USING ERRCODE = 'P0001';
  END IF;

  RETURN pg_catalog.to_char(v_dia, 'YYMMDD') || pg_catalog.lpad(v_n::text, 3, '0');
END;
$fn$;

REVOKE ALL ON FUNCTION private.proximo_codigo_pedido(timestamptz) FROM PUBLIC;

ALTER TABLE public.pedidos
  ADD COLUMN codigo text;

COMMENT ON COLUMN public.pedidos.codigo IS
  'Código do pedido, YYMMDDNNN, dia civil em America/Sao_Paulo e sequência desse dia. Não é o UUID.';

-- Pedidos já gravados, na ordem em que nasceram dentro de cada dia.
DO $fn$
DECLARE
  ped record;
BEGIN
  FOR ped IN
    SELECT id, created_at
    FROM public.pedidos
    WHERE codigo IS NULL
    ORDER BY (created_at AT TIME ZONE 'America/Sao_Paulo')::date, created_at, id
  LOOP
    UPDATE public.pedidos
    SET codigo = private.proximo_codigo_pedido(ped.created_at)
    WHERE id = ped.id
      AND codigo IS NULL;
  END LOOP;
END;
$fn$;

ALTER TABLE public.pedidos
  ALTER COLUMN codigo SET NOT NULL,
  ADD CONSTRAINT pedidos_codigo_fmt CHECK (codigo ~ '^[0-9]{9}$'),
  ADD CONSTRAINT pedidos_codigo_key UNIQUE (codigo);

CREATE FUNCTION private.pedidos_preencher_codigo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
BEGIN
  IF NEW.codigo IS NULL OR pg_catalog.btrim(NEW.codigo) = '' THEN
    NEW.codigo := private.proximo_codigo_pedido(COALESCE(NEW.created_at, pg_catalog.now()));
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION private.pedidos_preencher_codigo() FROM PUBLIC;

CREATE TRIGGER pedidos_codigo_bi
  BEFORE INSERT ON public.pedidos
  FOR EACH ROW
  EXECUTE FUNCTION private.pedidos_preencher_codigo();
