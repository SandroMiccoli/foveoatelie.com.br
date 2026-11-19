// CORS das funções chamadas pelo navegador. A chave publishable não é JWT.

export const ORIGENS_FIXAS = new Set([
  "https://foveoatelie.com.br",
  "https://dev.foveoatelie.com.br",
  "https://dev--foveoatelie.netlify.app",
]);

export function origemPermitida(origin: string): boolean {
  if (ORIGENS_FIXAS.has(origin)) return true;
  return /^https:\/\/deploy-preview-[a-z0-9-]+--foveoatelie\.netlify\.app$/i.test(origin);
}

export function cabecalhosCors(origin: string | null): Headers {
  const headers = new Headers({
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Max-Age": "86400",
  });
  if (origin && origemPermitida(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

export function json(origin: string | null, status: number, corpo: unknown): Response {
  const headers = cabecalhosCors(origin);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(corpo), { status, headers });
}

export function origemDoPedido(origin: string | null): string {
  if (origin && origemPermitida(origin)) return origin.replace(/\/+$/, "");
  return "https://foveoatelie.com.br";
}
