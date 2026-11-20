// Aviso manual: Sandro mudou o status no painel e a cliente recebe o e-mail
// uma vez. O webhook do Melhor Envio usa o mesmo envio.

import { conferirAdminPainel, jsonPainel, origemPainel } from "../_shared/painel.ts";
import { enviarEmailCliente } from "../_shared/enviar-cliente.ts";
import type { EventoEmail } from "../_shared/correio.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENTOS = new Set(["pagamento_confirmado", "enviado", "entregue", "pronto_retirada"]);

Deno.serve(async (req) => {
  const origin = origemPainel(req.headers.get("Origin"));
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cabecalhos(origin) });
  }
  if (req.method !== "POST") return jsonPainel(origin, 405, { ok: false, erro: "metodo" });

  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  const anonKey = (Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "").trim();
  if (!supabaseUrl || !anonKey) {
    return jsonPainel(origin, 503, { ok: false, erro: "indisponivel" });
  }

  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!jwt) return jsonPainel(origin, 401, { ok: false, erro: "sessao" });
  const admin = await conferirAdminPainel(supabaseUrl, anonKey, jwt);
  if (admin === "rede") return jsonPainel(origin, 503, { ok: false, erro: "indisponivel" });
  if (!admin) return jsonPainel(origin, 403, { ok: false, erro: "nao_autorizado" });

  let corpo: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object") throw new Error("corpo");
    corpo = parsed as Record<string, unknown>;
  } catch (_err) {
    return jsonPainel(origin, 400, { ok: false, erro: "pedido_invalido" });
  }

  const pedidoId = typeof corpo.pedido_id === "string" ? corpo.pedido_id.trim().toLowerCase() : "";
  const evento = typeof corpo.evento === "string" ? corpo.evento.trim() : "";
  if (!UUID.test(pedidoId) || !EVENTOS.has(evento)) {
    return jsonPainel(origin, 400, { ok: false, erro: "pedido_invalido" });
  }

  const resultado = await enviarEmailCliente(pedidoId, evento as EventoEmail);
  if (resultado === "falha") {
    return jsonPainel(origin, 502, {
      ok: false,
      erro: "email",
      mensagem: "Não consegui enviar o e-mail. O status do pedido não mudou por causa disso.",
    });
  }
  if (resultado === "pulado") {
    return jsonPainel(origin, 200, { ok: true, pulado: true });
  }
  return jsonPainel(origin, 200, { ok: true, ja: resultado === "ja" });
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
