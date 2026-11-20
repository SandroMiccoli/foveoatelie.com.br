// CORS e respostas JSON do painel (admin.foveoatelie.com.br).

const ORIGENS = new Set([
  "https://admin.foveoatelie.com.br",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
]);

export function origemPainel(origin: string | null): string | null {
  if (!origin) return null;
  if (ORIGENS.has(origin)) return origin;
  if (/^https:\/\/deploy-preview-[a-z0-9-]+--foveoatelie\.netlify\.app$/i.test(origin)) {
    return origin;
  }
  return null;
}

export const EMAIL_ADMIN = "contato@foveoatelie.com.br";

export async function conferirAdminPainel(
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

export function jsonPainel(origin: string | null, status: number, corpo: unknown): Response {
  const headers = new Headers({
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Max-Age": "86400",
    "Content-Type": "application/json",
  });
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  return new Response(JSON.stringify(corpo), { status, headers });
}
