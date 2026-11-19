// Notificação da Orders API. A assinatura (x-signature) é conferida quando
// MERCADO_PAGO_WEBHOOK_SECRET existe. Sem o secret, a função segue e avisa.
// A order em si é aplicada em _shared/aplicar-order.ts. Deploy: README.md.

import { aplicarOrderMercadoPago } from "../_shared/aplicar-order.ts";
import { diagnosticarAssinatura } from "../_shared/pedido.ts";

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
  const dataId = dataIdQuery || dataCorpo || null;
  const orderId = (dataIdQuery || dataCorpo || (typeof corpo?.id === "string" ? corpo.id : "")).trim();

  const secret = (Deno.env.get("MERCADO_PAGO_WEBHOOK_SECRET") ?? "").trim();
  if (!secret) {
    console.warn("webhook-mercado-pago: MERCADO_PAGO_WEBHOOK_SECRET ausente, assinatura não verificada");
  } else {
    const diagnostico = await diagnosticarAssinatura({
      xSignature: req.headers.get("x-signature"),
      xRequestId: req.headers.get("x-request-id"),
      dataId,
      secret,
    });
    if (!diagnostico.ok) {
      console.error("webhook-mercado-pago: assinatura rejeitada", JSON.stringify({
        ts: diagnostico.ts,
        requestId: diagnostico.requestIdPresente,
        dataId: diagnostico.dataId,
        variantes: diagnostico.variantes,
        v1: diagnostico.v1Recebido8,
        calculados: diagnostico.calculados8,
        motivo: diagnostico.motivo,
      }));
      return new Response(null, { status: 401 });
    }
  }

  if (!orderId) return new Response(null, { status: 200 });

  const aplicado = await aplicarOrderMercadoPago(orderId, "webhook");
  if (aplicado.situacao === "ausente") return new Response(null, { status: 200 });
  if (aplicado.situacao === "falha") return new Response(null, { status: aplicado.http });
  return new Response(null, { status: 200 });
});
