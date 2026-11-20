// Envia avisos pendentes ao chat do ateliê. O painel chama com o JWT do
// admin depois de mexer no estoque. O cron e o pg_net chamam com a service
// role. verify_jwt tem de ficar true: papelDoJwt só lê o papel, não confere
// a assinatura. O POST ao bot tem timeout e não muda pedido nem estoque.

import { despacharAvisosPendentes, papelDoJwt } from "../_shared/avisos.ts";
import { conferirAdminPainel, jsonPainel, origemPainel } from "../_shared/painel.ts";

Deno.serve(async (req) => {
  const origin = origemPainel(req.headers.get("Origin"));
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cabecalhos(origin) });
  }
  if (req.method !== "POST") return jsonPainel(origin, 405, { ok: false, erro: "metodo" });

  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!jwt) return jsonPainel(origin, 401, { ok: false, erro: "sessao" });

  if (papelDoJwt(jwt) !== "service_role") {
    const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
    const anonKey = (Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "").trim();
    if (!supabaseUrl || !anonKey) return jsonPainel(origin, 503, { ok: false, erro: "indisponivel" });
    const admin = await conferirAdminPainel(supabaseUrl, anonKey, jwt);
    if (admin === "rede") return jsonPainel(origin, 503, { ok: false, erro: "indisponivel" });
    if (!admin) return jsonPainel(origin, 403, { ok: false, erro: "nao_autorizado" });
  }

  const enviados = await despacharAvisosPendentes();
  return jsonPainel(origin, 200, { ok: true, enviados });
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
