// Cotação de frete da sacola (Melhor Envio). O token não sai do servidor.
// A conta e a chamada ao Melhor Envio ficam em ../_shared/frete.ts,
// para o checkout usar a mesma cotação. Deploy: ver README.md nesta pasta.

import { cabecalhosCors, json, origemPermitida } from "../_shared/http.ts";
import { cotarItens, type ItemPedido } from "../_shared/frete.ts";

const LIMITE_ITENS = 20;
const LIMITE_QTD = 99;
const LIMITE_CORPO = 8000;

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cabecalhosCors(origin) });
  }

  if (origin && !origemPermitida(origin)) {
    return json(origin, 403, { erro: "origem" });
  }

  if (req.method !== "POST") {
    return json(origin, 405, { erro: "metodo" });
  }

  let bruto = "";
  try {
    bruto = await req.text();
  } catch (_err) {
    return json(origin, 400, { erro: "pedido_invalido" });
  }
  if (bruto.length > LIMITE_CORPO) {
    return json(origin, 400, { erro: "pedido_invalido" });
  }

  let corpo: unknown;
  try {
    corpo = JSON.parse(bruto);
  } catch (_err) {
    return json(origin, 400, { erro: "pedido_invalido" });
  }

  const pedido = lerPedido(corpo);
  if (!pedido) return json(origin, 400, { erro: "pedido_invalido" });

  const cotacao = await cotarItens(pedido.cep, pedido.itens);
  if (!cotacao.ok) {
    const status = cotacao.erro === "pedido_invalido" ? 400 : 503;
    return json(origin, status, { erro: cotacao.erro === "pedido_invalido" ? "pedido_invalido" : "cotacao_indisponivel" });
  }

  return json(origin, 200, { opcoes: cotacao.opcoes });
});

function lerPedido(corpo: unknown): { cep: string; itens: ItemPedido[] } | null {
  if (!corpo || typeof corpo !== "object") return null;
  const dados = corpo as Record<string, unknown>;
  const cep = String(dados.cep_destino ?? "").replace(/\D/g, "");
  if (!/^\d{8}$/.test(cep) || cep === "00000000") return null;
  if (!Array.isArray(dados.itens) || dados.itens.length === 0 || dados.itens.length > LIMITE_ITENS) {
    return null;
  }

  const mapa = new Map<string, number>();
  for (const bruto of dados.itens) {
    if (!bruto || typeof bruto !== "object") return null;
    const item = bruto as Record<string, unknown>;
    const id = item.produto_id;
    const qtd = item.qtd;
    if (typeof id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) return null;
    if (typeof qtd !== "number" || !Number.isInteger(qtd) || qtd < 1 || qtd > LIMITE_QTD) return null;
    mapa.set(id, (mapa.get(id) ?? 0) + qtd);
  }

  const itens: ItemPedido[] = [];
  let total = 0;
  for (const [produto_id, qtd] of mapa) {
    if (qtd > LIMITE_QTD) return null;
    total += qtd;
    itens.push({ produto_id, qtd });
  }
  if (total < 1 || total > LIMITE_QTD) return null;
  return { cep, itens };
}
