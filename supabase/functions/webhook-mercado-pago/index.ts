// Notificação da Orders API. Busca a order de verdade e só então mexe no pedido.
// A assinatura (x-signature) é conferida quando MERCADO_PAGO_WEBHOOK_SECRET existe.
// Sem o secret, a função segue e registra um aviso. Deploy: README.md.

import { credenciaisSupabase } from "../_shared/frete.ts";
import { acaoDaOrder, assinaturaValida, reaisParaCentavos } from "../_shared/pedido.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "GET" || req.method === "HEAD") {
    return new Response(null, { status: 200 });
  }
  if (req.method !== "POST") return new Response(null, { status: 405 });

  const url = new URL(req.url);
  const dataIdQuery = url.searchParams.get("data.id");
  const tipoQuery = (url.searchParams.get("type") ?? "").toLowerCase();

  let corpo: Record<string, unknown> | null = null;
  try {
    const texto = await req.text();
    if (texto) {
      const parsed = JSON.parse(texto);
      if (parsed && typeof parsed === "object") corpo = parsed as Record<string, unknown>;
    }
  } catch (_err) {
    corpo = null;
  }

  const tipoCorpo = typeof corpo?.type === "string" ? corpo.type.toLowerCase() : "";
  const tipo = tipoQuery || tipoCorpo;
  if (tipo && tipo !== "order" && tipo !== "orders") {
    return new Response(null, { status: 200 });
  }

  const dataCorpo = corpo?.data && typeof corpo.data === "object"
    ? String((corpo.data as { id?: unknown }).id ?? "")
    : "";
  const orderId = (dataIdQuery || dataCorpo || (typeof corpo?.id === "string" ? corpo.id : "")).trim();

  const secret = (Deno.env.get("MERCADO_PAGO_WEBHOOK_SECRET") ?? "").trim();
  if (!secret) {
    console.warn("webhook-mercado-pago: MERCADO_PAGO_WEBHOOK_SECRET ausente, assinatura não verificada");
  } else {
    const ok = await assinaturaValida({
      xSignature: req.headers.get("x-signature"),
      xRequestId: req.headers.get("x-request-id"),
      dataId: dataIdQuery || dataCorpo || null,
      secret,
    });
    if (!ok) return new Response(null, { status: 401 });
  }

  if (!orderId) return new Response(null, { status: 200 });

  const token = (Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN") ?? "").trim();
  const cred = credenciaisSupabase();
  if (!token || !cred) {
    console.error("webhook-mercado-pago: credencial ausente");
    return new Response(null, { status: 500 });
  }

  const order = await buscarOrder(token, orderId);
  if (order === "ausente") return new Response(null, { status: 200 });
  if (!order) return new Response(null, { status: 502 });

  const referencia = typeof order.external_reference === "string" ? order.external_reference : "";
  const pedidoId = UUID.test(referencia) ? referencia.toLowerCase() : null;
  const moeda = typeof order.currency === "string" ? order.currency.toUpperCase() : "";
  if (moeda && moeda !== "BRL") {
    console.error("webhook-mercado-pago: moeda inesperada", moeda);
    return new Response(null, { status: 500 });
  }

  const status = typeof order.status === "string" ? order.status : "";
  const detail = typeof order.status_detail === "string" ? order.status_detail : "";
  const acao = acaoDaOrder(status, detail);
  const total = reaisParaCentavos(order.total_amount);
  const paymentId = idPagamento(order);

  const resultado = await rpc(cred, "aplicar_retorno_mp", {
    p_pedido_id: pedidoId,
    p_mp_order_id: typeof order.id === "string" ? order.id : orderId,
    p_mp_payment_id: paymentId,
    p_mp_status: status.slice(0, 40),
    p_mp_status_detail: detail.slice(0, 80),
    p_total_centavos: total,
    p_acao: acao,
  });

  if (!resultado) return new Response(null, { status: 500 });

  const erro = typeof resultado.erro === "string" ? resultado.erro : "";
  if (erro === "valor" || erro === "divergente") {
    console.error("webhook-mercado-pago:", erro, pedidoId ?? orderId);
    return new Response(null, { status: 500 });
  }
  if (erro === "sem_estoque") {
    console.error("webhook-mercado-pago: pago sem estoque", pedidoId ?? orderId);
  } else if (erro && erro !== "nao_encontrado") {
    console.error("webhook-mercado-pago:", erro, pedidoId ?? orderId);
    return new Response(null, { status: 500 });
  }

  await rpc(cred, "expirar_reservas", {});
  return new Response(null, { status: 200 });
});

async function buscarOrder(token: string, orderId: string): Promise<Record<string, unknown> | "ausente" | null> {
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
    console.error("webhook-mercado-pago: falha ao buscar a order", err instanceof Error ? err.message : err);
    return null;
  }
  if (res.status === 404) return "ausente";
  if (!res.ok) {
    console.error("webhook-mercado-pago: GET order", res.status);
    return null;
  }
  try {
    const data = await res.json();
    return data && typeof data === "object" ? data as Record<string, unknown> : null;
  } catch (_err) {
    return null;
  }
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
    console.error("webhook-mercado-pago: rpc", nome, err instanceof Error ? err.message : err);
    return null;
  }
  if (!res.ok) {
    console.error("webhook-mercado-pago: rpc", nome, res.status);
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
