// Reembolso total de um pedido pelo painel do ateliê.
// O JWT do usuário logado precisa ser contato@foveoatelie.com.br.
// MERCADO_PAGO_ACCESS_TOKEN fica só no servidor.
//
// Fluxo: confere o admin, POST /v1/orders/{mp_order_id}/refund (corpo vazio).
// Se o Mercado Pago confirmar, chama admin_confirmar_reembolso (status + estoque).
// Se o Mercado Pago recusar, o status do pedido não muda.

import { jsonPainel, origemPainel } from "../_shared/painel.ts";

const EMAIL_ADMIN = "contato@foveoatelie.com.br";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const origin = origemPainel(req.headers.get("Origin"));
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cabecalhos(origin) });
  }
  if (req.method !== "POST") {
    return jsonPainel(origin, 405, { ok: false, erro: "metodo" });
  }

  const tokenMp = (Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN") ?? "").trim();
  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").trim();
  const anonKey = (Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "").trim();
  if (!tokenMp || !supabaseUrl || !anonKey) {
    console.error("reembolsar-pedido: credencial ausente");
    return jsonPainel(origin, 503, { ok: false, erro: "indisponivel" });
  }

  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!jwt) {
    return jsonPainel(origin, 401, { ok: false, erro: "sessao" });
  }

  const admin = await conferirAdmin(supabaseUrl, anonKey, jwt);
  if (admin === "rede") {
    return jsonPainel(origin, 503, { ok: false, erro: "indisponivel" });
  }
  if (!admin) {
    return jsonPainel(origin, 403, { ok: false, erro: "nao_autorizado" });
  }

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch (_err) {
    return jsonPainel(origin, 400, { ok: false, erro: "pedido_invalido" });
  }
  const pedidoId = corpo && typeof corpo === "object"
    ? String((corpo as { pedido_id?: unknown }).pedido_id ?? "").trim()
    : "";
  if (!UUID.test(pedidoId)) {
    return jsonPainel(origin, 400, { ok: false, erro: "pedido_invalido" });
  }

  const ped = await lerPedido(supabaseUrl, anonKey, jwt, pedidoId);
  if (ped === "rede") {
    return jsonPainel(origin, 503, { ok: false, erro: "indisponivel" });
  }
  if (!ped) {
    return jsonPainel(origin, 404, { ok: false, erro: "nao_encontrado" });
  }
  if (ped.status === "reembolsado") {
    return jsonPainel(origin, 200, { ok: true, status: "reembolsado", ja: true });
  }
  if (ped.status === "pendente" || ped.status === "expirado" || ped.status === "recusado") {
    return jsonPainel(origin, 409, {
      ok: false,
      erro: "sem_pagamento",
      mensagem: "Esse pedido ainda não tem pagamento para devolver.",
    });
  }
  if (ped.status === "cancelado") {
    return jsonPainel(origin, 409, {
      ok: false,
      erro: "cancelado",
      mensagem: "Pedido cancelado não recebe reembolso por aqui.",
    });
  }

  const orderId = ped.mp_order_id;
  if (!orderId) {
    return jsonPainel(origin, 409, {
      ok: false,
      erro: "sem_order",
      mensagem: "Não achei a order do Mercado Pago neste pedido.",
    });
  }

  const reembolso = await reembolsarOrder(tokenMp, orderId);
  if (!reembolso.ok) {
    return jsonPainel(origin, reembolso.http, {
      ok: false,
      erro: reembolso.erro,
      mensagem: reembolso.mensagem,
    });
  }

  const confirmado = await rpcConfirmar(supabaseUrl, anonKey, jwt, pedidoId);
  if (!confirmado) {
    console.error("reembolsar-pedido: MP ok, RPC falhou", pedidoId);
    return jsonPainel(origin, 500, {
      ok: false,
      erro: "rpc",
      mensagem: "O Mercado Pago devolveu o valor, mas o painel não gravou o status. Confira o pedido.",
    });
  }
  if (confirmado.ok !== true) {
    const erro = typeof confirmado.erro === "string" ? confirmado.erro : "rpc";
    return jsonPainel(origin, 500, {
      ok: false,
      erro,
      mensagem: "O Mercado Pago devolveu o valor, mas o painel não gravou o status. Confira o pedido.",
    });
  }

  return jsonPainel(origin, 200, { ok: true, status: "reembolsado" });
});

function cabecalhos(origin: string | null): Headers {
  const headers = new Headers({
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Max-Age": "86400",
  });
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

async function conferirAdmin(
  url: string,
  anonKey: string,
  jwt: string,
): Promise<true | false | "rede"> {
  let res: Response;
  try {
    res = await fetch(`${url}/auth/v1/user`, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${jwt}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });
  } catch (_err) {
    return "rede";
  }
  if (!res.ok) return false;
  try {
    const data = await res.json();
    const email = data && typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
    return email === EMAIL_ADMIN;
  } catch (_err) {
    return false;
  }
}

async function lerPedido(
  url: string,
  anonKey: string,
  jwt: string,
  pedidoId: string,
): Promise<{ status: string; mp_order_id: string | null } | null | "rede"> {
  let res: Response;
  try {
    res = await fetch(
      `${url}/rest/v1/pedidos?id=eq.${pedidoId}&select=status,mp_order_id`,
      {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${jwt}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10000),
      },
    );
  } catch (_err) {
    return "rede";
  }
  if (!res.ok) return "rede";
  try {
    const data = await res.json();
    const row = Array.isArray(data) ? data[0] : null;
    if (!row || typeof row !== "object") return null;
    const status = typeof row.status === "string" ? row.status : "";
    const order = typeof row.mp_order_id === "string" && row.mp_order_id.trim()
      ? row.mp_order_id.trim()
      : null;
    return { status, mp_order_id: order };
  } catch (_err) {
    return "rede";
  }
}

async function reembolsarOrder(
  token: string,
  orderId: string,
): Promise<
  | { ok: true }
  | { ok: false; http: number; erro: string; mensagem: string }
> {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(orderId)) {
    return {
      ok: false,
      http: 409,
      erro: "sem_order",
      mensagem: "A order do Mercado Pago neste pedido não parece válida.",
    };
  }
  const idem = crypto.randomUUID();
  let res: Response;
  try {
    // Corpo omitido = reembolso total (Orders API / Checkout Pro).
    res = await fetch(
      `https://api.mercadopago.com/v1/orders/${encodeURIComponent(orderId)}/refund`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "X-Idempotency-Key": idem,
        },
        signal: AbortSignal.timeout(20000),
      },
    );
  } catch (_err) {
    return {
      ok: false,
      http: 502,
      erro: "mp_rede",
      mensagem: "Não consegui falar com o Mercado Pago. Tente de novo.",
    };
  }

  let data: Record<string, unknown> | null = null;
  try {
    data = await res.json();
  } catch (_err) {
    data = null;
  }

  if (res.status === 201 || res.ok) {
    const status = data && typeof data.status === "string" ? data.status.toLowerCase() : "";
    if (!status || status === "refunded" || status === "processed" || status === "partially_refunded") {
      return { ok: true };
    }
    // 2xx com status inesperado: ainda trata como ok se veio 201.
    if (res.status === 201) return { ok: true };
  }

  const mensagem = mensagemMercadoPago(res.status, data);
  return {
    ok: false,
    http: res.status >= 400 && res.status < 500 ? 409 : 502,
    erro: "mp_recusou",
    mensagem,
  };
}

function mensagemMercadoPago(status: number, data: Record<string, unknown> | null): string {
  const errors = data && Array.isArray(data.errors) ? data.errors : null;
  const primeiro = errors && errors[0] && typeof errors[0] === "object"
    ? errors[0] as { code?: unknown; message?: unknown }
    : null;
  const codigo = primeiro && typeof primeiro.code === "string" ? primeiro.code : "";
  const msg = primeiro && typeof primeiro.message === "string" ? primeiro.message : "";
  const detail = data && typeof data.message === "string" ? data.message : "";

  if (codigo === "refund_amount_exceeds" || /already refunded/i.test(msg + detail)) {
    return "O Mercado Pago diz que esse pagamento já foi devolvido.";
  }
  if (/insufficient|saldo|balance/i.test(msg + detail)) {
    return "Sem saldo na conta do Mercado Pago para devolver esse valor.";
  }
  if (status === 404) {
    return "O Mercado Pago não achou essa order.";
  }
  if (msg.trim()) return "O Mercado Pago recusou: " + msg.trim().slice(0, 180);
  if (detail.trim()) return "O Mercado Pago recusou: " + detail.trim().slice(0, 180);
  return "O Mercado Pago recusou o reembolso.";
}

async function rpcConfirmar(
  url: string,
  anonKey: string,
  jwt: string,
  pedidoId: string,
): Promise<Record<string, unknown> | null> {
  let res: Response;
  try {
    res = await fetch(`${url}/rest/v1/rpc/admin_confirmar_reembolso`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${jwt}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_pedido_id: pedidoId }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (_err) {
    return null;
  }
  if (!res.ok) return null;
  try {
    const data = await res.json();
    return data && typeof data === "object" ? data as Record<string, unknown> : {};
  } catch (_err) {
    return {};
  }
}
