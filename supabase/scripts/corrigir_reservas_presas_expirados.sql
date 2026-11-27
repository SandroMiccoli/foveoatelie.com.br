-- Correção pontual: pedidos já marcados como expirado/recusado pelo admin
-- sem liberar a reserva de estoque.
--
-- NÃO roda sozinho. Aplicar no SQL editor do projeto foveo-loja
-- (bbksditqlgdjftwowtje), depois da migration
-- 20261127120000_liberar_reserva_ao_expirar.sql.
--
-- Por quê só estes?
--   * expirar_reservas (automático) e o webhook já soltam o reservado
--     ao marcar expirado/cancelado/recusado, mas não gravavam
--     estoque_restaurado_em. Soltar de novo neles baixaria o reservado
--     em dobro.
--   * O bug do painel: admin_alterar_status_pedido só devolvia estoque
--     em cancelado. Expirado/recusado pelo admin ficaram com status
--     terminal, reservado intacto e estoque_restaurado_em nulo, com
--     histórico origem = 'admin'.
--
-- Idempotente: pedidos com estoque_restaurado_em preenchido são
-- ignorados. Pode rodar de novo sem efeito.

BEGIN;

-- 1) Conferir o que será corrigido (rode só este SELECT antes, se quiser)
-- SELECT
--   p.id,
--   p.codigo,
--   p.status,
--   p.estoque_restaurado_em,
--   p.itens,
--   p.reserva_expira_em,
--   p.created_at
-- FROM public.pedidos AS p
-- WHERE p.status IN ('expirado', 'recusado')
--   AND p.estoque_restaurado_em IS NULL
--   AND EXISTS (
--     SELECT 1
--     FROM public.pedido_status_historico AS h
--     WHERE h.pedido_id = p.id
--       AND h.status = p.status
--       AND h.origem = 'admin'
--   )
-- ORDER BY p.created_at;

-- 2) Soltar o reservado e carimbar, pedido a pedido (trava a linha)
DO $fix$
DECLARE
  ped public.pedidos%ROWTYPE;
  item jsonb;
  pid text;
  qtd integer;
  n integer := 0;
BEGIN
  FOR ped IN
    SELECT p.*
    FROM public.pedidos AS p
    WHERE p.status IN ('expirado', 'recusado')
      AND p.estoque_restaurado_em IS NULL
      AND EXISTS (
        SELECT 1
        FROM public.pedido_status_historico AS h
        WHERE h.pedido_id = p.id
          AND h.status = p.status
          AND h.origem = 'admin'
      )
    ORDER BY p.id
    FOR UPDATE OF p
  LOOP
    -- Ainda sem carimbo (evita corrida se alguém aplicar a migration
    -- nova e re-marcar o pedido no meio tempo).
    IF ped.estoque_restaurado_em IS NOT NULL THEN
      CONTINUE;
    END IF;

    FOR item IN
      SELECT value
      FROM pg_catalog.jsonb_array_elements(ped.itens) AS t(value)
      ORDER BY value->>'produto_id'
    LOOP
      pid := item->>'produto_id';
      IF pid IS NULL OR item->>'qtd' !~ '^[0-9]+$' THEN
        CONTINUE;
      END IF;
      qtd := (item->>'qtd')::integer;
      IF qtd < 1 THEN
        CONTINUE;
      END IF;
      UPDATE public.estoque
      SET reservado = GREATEST(reservado - qtd, 0)
      WHERE produto_id = pid;
    END LOOP;

    UPDATE public.pedidos
    SET estoque_restaurado_em = pg_catalog.now()
    WHERE id = ped.id
      AND estoque_restaurado_em IS NULL;

    n := n + 1;
  END LOOP;

  RAISE NOTICE 'reservas liberadas em % pedido(s) expirado/recusado pelo admin', n;
END;
$fix$;

-- 3) Opcional e seguro: carimbar terminais que JÁ tiveram a reserva
-- solta (expirar_reservas / webhook / liberar_pedido) e ficaram sem
-- estoque_restaurado_em. Não mexe em estoque.reservado.
UPDATE public.pedidos
SET estoque_restaurado_em = pg_catalog.now()
WHERE status IN ('expirado', 'cancelado', 'recusado')
  AND estoque_restaurado_em IS NULL;

COMMIT;
