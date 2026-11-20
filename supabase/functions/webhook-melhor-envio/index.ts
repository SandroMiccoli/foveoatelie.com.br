// Webhook do Melhor Envio. Sem JWT: a chamada vem da plataforma.
// A assinatura é HMAC-SHA256 do corpo cru, no header X-ME-Signature,
// com o secret do aplicativo. Postagem vira Enviado, entrega vira Entregue.

import { problemaEntrega, registrarProblemaEntrega } from "../_shared/avisos.ts";
import type { EventoMe } from "../_shared/etiquetas.ts";
import { assinaturaMelhorEnvio, emailDoEvento, lerEventoMe } from "../_shared/etiquetas.ts";
import { enviarEmailCliente } from "../_shared/enviar-cliente.ts";
import { emSegundoPlano } from "../_shared/segundo-plano.ts";
import type { EventoEmail } from "../_shared/correio.ts";

Deno.serve(async (req) => {
  if (req.method === "GET" || req.method === "HEAD") return new Response(null, { status: 200 });
  if (req.method !== "POST") return new Response(null, { status: 405 });

  const secret = (Deno.env.get("MELHOR_ENVIO_APP_SECRET") ?? "").trim();
  let bruto = "";
  try {
    bruto = await req.text();
  } catch (_err) {
    return new Response(null, { status: 400 });
  }
  if (bruto.length > 100_000) return new Response(null, { status: 413 });

  if (!secret) {
    console.error("webhook-melhor-envio: MELHOR_ENVIO_APP_SECRET ausente");
    return new Response(null, { status: 401 });
  }
  const ok = await assinaturaMelhorEnvio(secret, bruto, req.headers.get("x-me-signature"));
  if (!ok) {
    console.error("webhook-melhor-envio: assinatura rejeitada");
    return new Response(null, { status: 401 });
  }

  let corpo: unknown;
  try {
    corpo = JSON.parse(bruto);
  } catch (_err) {
    return new Response(null, { status: 400 });
  }
  const evento = lerEventoMe(corpo);
  if (!evento) return new Response(null, { status: 200 });

  const credUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  const key = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  if (!credUrl || !key) {
    console.error("webhook-melhor-envio: supabase ausente");
    return new Response(null, { status: 500 });
  }

  let res: Response;
  try {
    res = await fetch(`${credUrl}/rest/v1/rpc/aplicar_evento_melhor_envio`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_me_order_id: evento.id,
        p_evento: evento.evento,
        p_rastreio: evento.rastreio || null,
        p_me_status: evento.status || null,
        p_protocolo: evento.protocolo || null,
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    console.error("webhook-melhor-envio: rpc", err instanceof Error ? err.name : "erro");
    return new Response(null, { status: 500 });
  }
  if (!res.ok) {
    console.error("webhook-melhor-envio: rpc", res.status);
    return new Response(null, { status: 500 });
  }

  let data: Record<string, unknown> | null = null;
  try {
    const parsed = await res.json();
    if (parsed && typeof parsed === "object") data = parsed as Record<string, unknown>;
  } catch (_err) {
    data = null;
  }
  const pedidoId = data && typeof data.pedido_id === "string" ? data.pedido_id : "";
  const email = data && typeof data.email === "string" ? data.email : emailDoEvento(evento.evento);
  if (pedidoId && (email === "enviado" || email === "entregue")) {
    const eventoEmail = email as EventoEmail;
    emSegundoPlano(enviarEmailCliente(pedidoId, eventoEmail).then((aviso) => {
      if (aviso === "falha") console.error("webhook-melhor-envio: e-mail", eventoEmail);
    }));
  }
  emSegundoPlano(avisarProblemaEntrega(credUrl, key, evento, pedidoId));
  return new Response(null, { status: 200 });
});

async function avisarProblemaEntrega(
  url: string,
  key: string,
  evento: EventoMe,
  pedidoId: string,
): Promise<void> {
  if (!problemaEntrega(evento.evento, evento.status)) return;
  let codigo = "";
  if (/^[0-9a-f-]{36}$/i.test(pedidoId)) {
    codigo = await lerCodigoPedido(url, key, pedidoId);
  }
  await registrarProblemaEntrega({
    meId: evento.id,
    evento: evento.evento,
    status: evento.status,
    codigo,
    protocolo: evento.protocolo,
    rastreio: evento.rastreio,
  });
}

async function lerCodigoPedido(url: string, key: string, pedidoId: string): Promise<string> {
  try {
    const res = await fetch(`${url}/rest/v1/pedidos?id=eq.${pedidoId}&select=codigo`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return "";
    const data = await res.json();
    const row = Array.isArray(data) ? data[0] : null;
    const codigo = row && typeof row.codigo === "string" ? row.codigo : "";
    return /^\d{9}$/.test(codigo) ? codigo : "";
  } catch (err) {
    console.error("webhook-melhor-envio: codigo", err instanceof Error ? err.name : "erro");
    return "";
  }
}
