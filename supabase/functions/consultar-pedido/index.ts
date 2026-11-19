// Leitura pública de um pedido. O UUID é a chave: quem tem o link vê o resumo,
// sem e-mail, telefone ou endereço. Deploy: README.md.

import { credenciaisSupabase } from "../_shared/frete.ts";
import { json, cabecalhosCors, origemPermitida } from "../_shared/http.ts";
import { dataPostagem, numeroCurto, primeiroNome } from "../_shared/pedido.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS = new Set(["pendente", "pago", "expirado", "recusado", "cancelado", "enviado", "entregue"]);

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cabecalhosCors(origin) });
  if (origin && !origemPermitida(origin)) return json(origin, 403, { erro: "origem" });
  if (req.method !== "POST") return json(origin, 405, { erro: "metodo" });

  const cred = credenciaisSupabase();
  if (!cred) return json(origin, 503, { erro: "consulta_indisponivel" });

  let bruto = "";
  try {
    bruto = await req.text();
  } catch (_err) {
    return json(origin, 400, { erro: "pedido_invalido" });
  }
  if (bruto.length > 1000) return json(origin, 400, { erro: "pedido_invalido" });

  let corpo: unknown;
  try {
    corpo = JSON.parse(bruto);
  } catch (_err) {
    return json(origin, 400, { erro: "pedido_invalido" });
  }
  const idBruto = corpo && typeof corpo === "object" ? (corpo as { pedido_id?: unknown }).pedido_id : "";
  const pedidoId = typeof idBruto === "string" ? idBruto.trim().toLowerCase() : "";
  if (!UUID.test(pedidoId)) return json(origin, 400, { erro: "pedido_invalido" });

  const row = await buscarPedido(cred, pedidoId);
  if (row === "ausente") return json(origin, 404, { erro: "nao_encontrado" });
  if (!row) return json(origin, 503, { erro: "consulta_indisponivel" });

  const statusBruto = typeof row.status === "string" ? row.status : "";
  const status = STATUS.has(statusBruto) ? statusBruto : "pendente";
  const nome = typeof row.cliente_nome === "string" ? row.cliente_nome : "";
  const entrega = row.entrega_tipo === "retirada" ? "retirada" : "envio";
  const quando = typeof row.pago_em === "string" && row.pago_em
    ? row.pago_em
    : typeof row.created_at === "string"
    ? row.created_at
    : "";

  return json(origin, 200, {
    numero: numeroCurto(pedidoId),
    status,
    primeiro_nome: primeiroNome(nome),
    entrega_tipo: entrega,
    itens: itensPublicos(row.itens),
    subtotal_centavos: centavos(row.subtotal_centavos),
    desconto_centavos: centavos(row.desconto_centavos),
    frete: fretePublico(row, entrega),
    total_centavos: centavos(row.total_centavos),
    data_postagem: quando ? dataPostagem(quando) : null,
  });
});

function fretePublico(row: Record<string, unknown>, entrega: "envio" | "retirada") {
  if (entrega === "retirada") {
    return { transportadora: "", servico: "Retirar em BH (combinar)", preco_centavos: 0 };
  }
  const frete = row.frete && typeof row.frete === "object" ? row.frete as Record<string, unknown> : {};
  const transportadora = texto(frete.transportadora, 40);
  const servico = texto(frete.servico, 40) || "Entrega";
  return { transportadora, servico, preco_centavos: centavos(row.frete_centavos) };
}

function itensPublicos(bruto: unknown): { nome: string; qtd: number; preco_unitario_centavos: number }[] {
  if (!Array.isArray(bruto)) return [];
  const itens = [];
  for (const item of bruto) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const nome = texto(row.nome, 80);
    const qtd = centavos(row.qtd);
    if (!nome || qtd < 1) continue;
    itens.push({ nome, qtd, preco_unitario_centavos: centavos(row.preco_unitario_centavos) });
  }
  return itens;
}

function centavos(valor: unknown): number {
  const n = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

function texto(valor: unknown, max: number): string {
  if (typeof valor !== "string") return "";
  return valor.replace(/[\u0000-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

async function buscarPedido(
  cred: { url: string; key: string },
  pedidoId: string,
): Promise<Record<string, unknown> | "ausente" | null> {
  const campos = [
    "status",
    "cliente_nome",
    "entrega_tipo",
    "itens",
    "subtotal_centavos",
    "desconto_centavos",
    "frete_centavos",
    "total_centavos",
    "frete",
    "pago_em",
    "created_at",
  ].join(",");
  let res: Response;
  try {
    res = await fetch(`${cred.url}/rest/v1/pedidos?id=eq.${pedidoId}&select=${campos}`, {
      headers: {
        apikey: cred.key,
        Authorization: `Bearer ${cred.key}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(12000),
    });
  } catch (err) {
    console.error("consultar-pedido: leitura", err instanceof Error ? err.name : "erro");
    return null;
  }
  if (res.status === 406) return "ausente";
  if (!res.ok) {
    console.error("consultar-pedido: leitura", res.status);
    return null;
  }
  try {
    const data = await res.json();
    if (Array.isArray(data)) {
      if (data.length !== 1) return "ausente";
      const row = data[0];
      return row && typeof row === "object" ? row as Record<string, unknown> : "ausente";
    }
    return "ausente";
  } catch (_err) {
    return null;
  }
}
