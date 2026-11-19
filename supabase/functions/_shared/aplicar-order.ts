// Aplica o que o Mercado Pago diz de uma order no pedido local.
// O webhook e a consulta usam o mesmo caminho: GET /v1/orders com o token nosso,
// depois a RPC que baixa estoque ou solta a reserva. O aviso ao ateliê só sai
// na transição para pago.

import { credenciaisSupabase } from "./frete.ts";
import { acaoDaOrder, reaisParaCentavos, retentativaDePagamento } from "./pedido.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ResultadoAplicar =
  | { situacao: "ausente" }
  | { situacao: "falha"; http: 500 | 502; motivo: string }
  | { situacao: "aplicado"; pedidoId: string | null; status: string; ja: boolean; erro: string; retentativa: boolean };

export async function aplicarOrderMercadoPago(orderId: string, origem = "webhook"): Promise<ResultadoAplicar> {
  const token = (Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN") ?? "").trim();
  const cred = credenciaisSupabase();
  if (!token || !cred) {
    console.error(origem + ": credencial ausente");
    return { situacao: "falha", http: 500, motivo: "credencial" };
  }

  const order = await buscarOrder(token, orderId, origem);
  if (order === "ausente") return { situacao: "ausente" };
  if (!order) return { situacao: "falha", http: 502, motivo: "order" };

  const referencia = typeof order.external_reference === "string" ? order.external_reference : "";
  const pedidoId = UUID.test(referencia) ? referencia.toLowerCase() : null;
  const moeda = typeof order.currency === "string" ? order.currency.toUpperCase() : "";
  if (moeda && moeda !== "BRL") {
    console.error(origem + ": moeda inesperada", moeda);
    return { situacao: "falha", http: 500, motivo: "moeda" };
  }

  const statusMp = typeof order.status === "string" ? order.status : "";
  const detail = typeof order.status_detail === "string" ? order.status_detail : "";
  const pagamentoStatus = statusUltimoPagamento(order);
  const retentativa = retentativaDePagamento(statusMp, detail, pagamentoStatus);
  const detailSalvo = retentativa && detail.trim().toLowerCase() !== "waiting_retry"
    ? "waiting_retry"
    : detail;
  const resultado = await rpc(cred, "aplicar_retorno_mp", {
    p_pedido_id: pedidoId,
    p_mp_order_id: typeof order.id === "string" ? order.id : orderId,
    p_mp_payment_id: idPagamento(order),
    p_mp_status: statusMp.slice(0, 40),
    p_mp_status_detail: detailSalvo.slice(0, 80),
    p_total_centavos: reaisParaCentavos(order.total_amount),
    p_acao: acaoDaOrder(statusMp, detail),
  }, origem);

  if (!resultado) return { situacao: "falha", http: 500, motivo: "rpc" };

  const erro = typeof resultado.erro === "string" ? resultado.erro : "";
  if (erro === "valor" || erro === "divergente") {
    console.error(origem + ":", erro, pedidoId ?? orderId);
    return { situacao: "falha", http: 500, motivo: erro };
  }
  if (erro === "sem_estoque") {
    console.error(origem + ": pago sem estoque", pedidoId ?? orderId);
  } else if (erro && erro !== "nao_encontrado") {
    console.error(origem + ":", erro, pedidoId ?? orderId);
    return { situacao: "falha", http: 500, motivo: erro };
  }

  const status = typeof resultado.status === "string" ? resultado.status : "";
  const ja = resultado.ja === true;
  if (resultado.ok === true && status === "pago" && !ja && pedidoId) {
    await avisarDono(cred, pedidoId, origem);
  }

  await rpc(cred, "expirar_reservas", {}, origem);
  return { situacao: "aplicado", pedidoId, status, ja, erro, retentativa };
}

async function avisarDono(
  cred: { url: string; key: string },
  pedidoId: string,
  origem: string,
): Promise<void> {
  const url = (Deno.env.get("GROKBOT_PEDIDO_WEBHOOK_URL") ?? "").trim();
  const key = (Deno.env.get("GROKBOT_PEDIDO_WEBHOOK_KEY") ?? "").trim();
  if (!url || !key) return;
  if (!url.startsWith("https://")) {
    console.error(origem + ": aviso ao ateliê sem URL https");
    return;
  }
  const codigo = await lerCodigo(cred, pedidoId, origem);
  const corpo: Record<string, string> = { evento: "pedido_pago", pedido_id: pedidoId };
  if (codigo) corpo.codigo = codigo;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        "X-Automation-Key": key,
      },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) console.error(origem + ": aviso ao ateliê", res.status);
  } catch (err) {
    const nome = err instanceof Error ? err.name : "erro";
    console.error(origem + ": aviso ao ateliê sem resposta", nome);
  }
}

async function lerCodigo(
  cred: { url: string; key: string },
  pedidoId: string,
  origem: string,
): Promise<string> {
  try {
    const res = await fetch(`${cred.url}/rest/v1/pedidos?id=eq.${pedidoId}&select=codigo`, {
      headers: {
        apikey: cred.key,
        Authorization: `Bearer ${cred.key}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return "";
    const data = await res.json();
    const row = Array.isArray(data) ? data[0] : null;
    const codigo = row && typeof row.codigo === "string" ? row.codigo : "";
    return /^[0-9]{9}$/.test(codigo) ? codigo : "";
  } catch (err) {
    console.error(origem + ": codigo do pedido", err instanceof Error ? err.name : "erro");
    return "";
  }
}

async function buscarOrder(
  token: string,
  orderId: string,
  origem: string,
): Promise<Record<string, unknown> | "ausente" | null> {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(orderId)) return "ausente";
  let res: Response;
  try {
    res = await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(orderId)}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(12000),
    });
  } catch (err) {
    console.error(origem + ": falha ao buscar a order", err instanceof Error ? err.name : "erro");
    return null;
  }
  if (res.status === 404) return "ausente";
  if (!res.ok) {
    console.error(origem + ": GET order", res.status);
    return null;
  }
  try {
    const data = await res.json();
    return data && typeof data === "object" ? data as Record<string, unknown> : null;
  } catch (_err) {
    return null;
  }
}

function statusUltimoPagamento(order: Record<string, unknown>): string {
  const tx = order.transactions;
  if (!tx || typeof tx !== "object") return "";
  const payments = (tx as { payments?: unknown }).payments;
  if (!Array.isArray(payments)) return "";
  for (let i = payments.length - 1; i >= 0; i--) {
    const item = payments[i];
    if (!item || typeof item !== "object") continue;
    const st = (item as { status?: unknown }).status;
    if (typeof st === "string" && st.trim()) return st.trim().toLowerCase();
  }
  return "";
}

function idPagamento(order: Record<string, unknown>): string | null {
  const tx = order.transactions;
  if (!tx || typeof tx !== "object") return null;
  const payments = (tx as { payments?: unknown }).payments;
  if (!Array.isArray(payments) || payments.length < 1) return null;
  const preferido = payments.find((item) => {
    if (!item || typeof item !== "object") return false;
    const st = String((item as { status?: unknown }).status ?? "");
    return st === "processed" || st === "accredited" || st === "approved";
  }) ?? payments[0];
  if (!preferido || typeof preferido !== "object") return null;
  const row = preferido as { id?: unknown; reference?: { id?: unknown } };
  const id = row.id ?? row.reference?.id;
  if (typeof id === "string" && id.trim()) return id.trim().slice(0, 80);
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  return null;
}

async function rpc(
  cred: { url: string; key: string },
  nome: string,
  corpo: unknown,
  origem: string,
): Promise<Record<string, unknown> | null> {
  let res: Response;
  try {
    res = await fetch(`${cred.url}/rest/v1/rpc/${nome}`, {
      method: "POST",
      headers: {
        apikey: cred.key,
        Authorization: `Bearer ${cred.key}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    console.error(origem + ": rpc", nome, err instanceof Error ? err.name : "erro");
    return null;
  }
  if (!res.ok) {
    console.error(origem + ": rpc", nome, res.status);
    return null;
  }
  if (res.status === 204) return {};
  try {
    const data = await res.json();
    if (typeof data === "number") return { n: data };
    return data && typeof data === "object" ? data as Record<string, unknown> : {};
  } catch (_err) {
    return {};
  }
}
