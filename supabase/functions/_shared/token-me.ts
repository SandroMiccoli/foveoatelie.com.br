// Token OAuth do Melhor Envio. Quem chama a API pede um access token aqui.
// A tabela private.melhor_envio_oauth guarda o par. Se estiver vazia, vale
// o secret MELHOR_ENVIO_TOKEN. expires_at nulo só renova depois de um 401.
// A renovação trava a linha para duas chamadas não girarem o refresh juntas.

import { registrarFalhaToken } from "./avisos.ts";

export const USER_AGENT_OAUTH = "Foveo Atelie (contato@foveoatelie.com.br)";
export const OAUTH_TOKEN_URL = "https://melhorenvio.com.br/oauth/token";
export const ANTECEDENCIA_MS = 7 * 24 * 60 * 60 * 1000;
const EXPIRA_PADRAO_S = 2592000;
const ESPERA_MS = 400;
const TENTATIVAS_ESPERA = 12;

export type FetchOauth = (input: string, init?: RequestInit) => Promise<Response>;

export type DepsToken = {
  fetch: FetchOauth;
  env: (nome: string) => string | undefined;
  agora: () => number;
  esperar: (ms: number) => Promise<void>;
  alertar?: (motivo: string) => Promise<void>;
};

export type EstadoToken = {
  vazio: boolean;
  accessToken: string;
  temRefresh: boolean;
  expiresAt: string | null;
  renovando: boolean;
};

export type DecisaoToken =
  | { tipo: "usar"; token: string }
  | { tipo: "ausente" }
  | { tipo: "esperar" }
  | { tipo: "sem_refresh"; token: string }
  | { tipo: "renovar" };

export function precisaRenovar(expiresAt: string | null, agora: number): boolean {
  if (!expiresAt) return false;
  const expira = Date.parse(expiresAt);
  if (!Number.isFinite(expira)) return false;
  return expira - agora <= ANTECEDENCIA_MS;
}

export function decidirRenovacao(
  estado: EstadoToken,
  segredo: string,
  forcar: boolean,
  agora: number,
): DecisaoToken {
  if (estado.renovando) return { tipo: "esperar" };
  const atual = estado.accessToken || segredo;
  const precisa = forcar || precisaRenovar(estado.expiresAt, agora);
  if (!precisa) return atual ? { tipo: "usar", token: atual } : { tipo: "ausente" };
  if (!estado.temRefresh) return { tipo: "sem_refresh", token: atual };
  return { tipo: "renovar" };
}

export function urlOauth(baseUrl: string | null): string {
  if (baseUrl === "https://sandbox.melhorenvio.com.br") return baseUrl + "/oauth/token";
  return OAUTH_TOKEN_URL;
}

function tokenLimpo(valor: unknown): string {
  if (typeof valor !== "string") return "";
  const texto = valor.trim();
  if (texto.length < 20 || texto.length > 4000) return "";
  if (/\s/.test(texto)) return "";
  return texto;
}

export function lerRespostaOauth(
  body: unknown,
  agora: number,
): { accessToken: string; refreshToken: string; expiresAt: string } | null {
  if (!body || typeof body !== "object") return null;
  const row = body as Record<string, unknown>;
  const accessToken = tokenLimpo(row.access_token);
  const refreshToken = tokenLimpo(row.refresh_token);
  if (!accessToken || !refreshToken) return null;
  const bruto = typeof row.expires_in === "number" ? row.expires_in : Number(row.expires_in);
  const expiresIn = Number.isFinite(bruto) && bruto >= 60 && bruto <= 60 * 60 * 24 * 60
    ? bruto
    : EXPIRA_PADRAO_S;
  return {
    accessToken,
    refreshToken,
    expiresAt: new Date(agora + expiresIn * 1000).toISOString(),
  };
}

function depsPadrao(): DepsToken {
  return {
    fetch: (input, init) => fetch(input, init),
    env: (nome) => Deno.env.get(nome),
    agora: () => Date.now(),
    esperar: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

function baseOauth(env: DepsToken["env"]): string {
  const bruta = (env("MELHOR_ENVIO_BASE_URL") ?? "").trim().replace(/\/+$/, "");
  return urlOauth(bruta || null);
}

function estadoDe(data: unknown): EstadoToken | "falha" {
  if (!data || typeof data !== "object") return "falha";
  const row = data as Record<string, unknown>;
  if (row.vazio === true) {
    return {
      vazio: true,
      accessToken: "",
      temRefresh: false,
      expiresAt: null,
      renovando: false,
    };
  }
  const expires = typeof row.expires_at === "string" && row.expires_at ? row.expires_at : null;
  return {
    vazio: false,
    accessToken: typeof row.access_token === "string" ? row.access_token.trim() : "",
    temRefresh: row.tem_refresh === true || (typeof row.refresh_token === "string" && row.refresh_token.trim().length >= 20),
    expiresAt: expires,
    renovando: row.renovando === true,
  };
}

async function rpcToken(deps: DepsToken, nome: string, corpo: unknown): Promise<unknown | "falha"> {
  const url = (deps.env("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  const key = (deps.env("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  if (!url || !key) return "falha";
  let res: Response;
  try {
    res = await deps.fetch(`${url}/rest/v1/rpc/${nome}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    console.error("token me: rpc", nome, err instanceof Error ? err.name : "erro");
    return "falha";
  }
  if (!res.ok) {
    console.error("token me: rpc", nome, res.status);
    return "falha";
  }
  try {
    return await res.json();
  } catch (_err) {
    return "falha";
  }
}

async function lerEstado(deps: DepsToken): Promise<EstadoToken | "falha"> {
  const data = await rpcToken(deps, "ler_oauth_melhor_envio", {});
  if (data === "falha") return "falha";
  return estadoDe(data);
}

async function alertar(deps: DepsToken, motivo: string): Promise<void> {
  try {
    if (deps.alertar) await deps.alertar(motivo);
    else await registrarFalhaToken(motivo);
  } catch (err) {
    console.error("token me: aviso", err instanceof Error ? err.name : "erro");
  }
}

async function pollAteSoltar(deps: DepsToken): Promise<void> {
  for (let i = 0; i < TENTATIVAS_ESPERA; i++) {
    await deps.esperar(ESPERA_MS);
    const estado = await lerEstado(deps);
    if (estado !== "falha" && !estado.renovando) return;
  }
}

type Claim =
  | { tipo: "falha" }
  | { tipo: "vazio" }
  | { tipo: "renovando" }
  | { tipo: "livre"; accessToken: string }
  | { tipo: "sem_refresh"; accessToken: string }
  | { tipo: "reivindicou"; refreshToken: string; accessToken: string };

function claimDe(data: unknown): Claim {
  if (!data || typeof data !== "object") return { tipo: "falha" };
  const row = data as Record<string, unknown>;
  if (row.vazio === true) return { tipo: "vazio" };
  if (row.renovando === true) return { tipo: "renovando" };
  const accessToken = typeof row.access_token === "string" ? row.access_token.trim() : "";
  if (row.sem_refresh === true) return { tipo: "sem_refresh", accessToken };
  if (row.reivindicou === true) {
    const refreshToken = tokenLimpo(row.refresh_token);
    if (!refreshToken) return { tipo: "sem_refresh", accessToken };
    return { tipo: "reivindicou", refreshToken, accessToken };
  }
  return { tipo: "livre", accessToken };
}

async function postRefresh(
  deps: DepsToken,
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string; expiresAt: string } | { motivo: string }> {
  const clientId = (deps.env("MELHOR_ENVIO_CLIENT_ID") ?? "").trim();
  const clientSecret = (deps.env("MELHOR_ENVIO_APP_SECRET") ?? "").trim();
  if (!clientId || !clientSecret) return { motivo: "sem_credencial" };
  const corpo = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
  let res: Response;
  try {
    res = await deps.fetch(baseOauth(deps.env), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT_OAUTH,
      },
      body: corpo.toString(),
      signal: AbortSignal.timeout(12000),
    });
  } catch (err) {
    console.error("token me: oauth", err instanceof Error ? err.name : "erro");
    return { motivo: "sem_resposta" };
  }
  if (!res.ok) {
    console.error("token me: oauth", res.status);
    return { motivo: "recusado" };
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch (_err) {
    return { motivo: "resposta_invalida" };
  }
  const lido = lerRespostaOauth(data, deps.agora());
  if (!lido) return { motivo: "resposta_invalida" };
  return lido;
}

async function soltar(deps: DepsToken, refreshUsado: string): Promise<void> {
  await rpcToken(deps, "soltar_oauth_melhor_envio", { p_refresh_usado: refreshUsado });
}

async function gravar(
  deps: DepsToken,
  novo: { accessToken: string; refreshToken: string; expiresAt: string },
  refreshUsado: string,
): Promise<boolean> {
  const data = await rpcToken(deps, "gravar_oauth_melhor_envio", {
    p_access_token: novo.accessToken,
    p_refresh_token: novo.refreshToken,
    p_expires_at: novo.expiresAt,
    p_refresh_usado: refreshUsado,
  });
  return Boolean(data && data !== "falha" && typeof data === "object" && (data as { ok?: unknown }).ok === true);
}

function tokenAtual(estado: EstadoToken, segredo: string): string {
  return estado.accessToken || segredo;
}

export async function resolverToken(
  deps: DepsToken,
  opcoes?: { forcar?: boolean },
  tentativa = 0,
): Promise<string | null> {
  const forcar = opcoes?.forcar === true;
  const segredo = (deps.env("MELHOR_ENVIO_TOKEN") ?? "").trim();
  const estado = await lerEstado(deps);
  if (estado === "falha") {
    if (!forcar && segredo) return segredo;
    await alertar(deps, "banco");
    return forcar ? null : (segredo || null);
  }

  const decisao = decidirRenovacao(estado, segredo, forcar, deps.agora());
  if (decisao.tipo === "usar") return decisao.token;
  if (decisao.tipo === "ausente") return null;
  if (decisao.tipo === "esperar") {
    if (tentativa > 0) {
      const atual = tokenAtual(estado, segredo);
      return forcar ? null : (atual || null);
    }
    await pollAteSoltar(deps);
    return resolverToken(deps, opcoes, tentativa + 1);
  }
  if (decisao.tipo === "sem_refresh") {
    await alertar(deps, "sem_refresh");
    return forcar ? null : (decisao.token || null);
  }

  const clientId = (deps.env("MELHOR_ENVIO_CLIENT_ID") ?? "").trim();
  const clientSecret = (deps.env("MELHOR_ENVIO_APP_SECRET") ?? "").trim();
  if (!clientId || !clientSecret) {
    await alertar(deps, "sem_credencial");
    return forcar ? null : (tokenAtual(estado, segredo) || null);
  }

  const cru = await rpcToken(deps, "reivindicar_oauth_melhor_envio", { p_forcar: forcar });
  const claim = cru === "falha" ? { tipo: "falha" as const } : claimDe(cru);
  if (claim.tipo === "falha") {
    await alertar(deps, "banco");
    return forcar ? null : (tokenAtual(estado, segredo) || null);
  }
  if (claim.tipo === "renovando") {
    if (tentativa > 0) return forcar ? null : (tokenAtual(estado, segredo) || null);
    await pollAteSoltar(deps);
    return resolverToken(deps, opcoes, tentativa + 1);
  }
  if (claim.tipo === "vazio" || claim.tipo === "sem_refresh") {
    await alertar(deps, "sem_refresh");
    const access = claim.tipo === "sem_refresh" ? claim.accessToken : "";
    return forcar ? null : (access || segredo || null);
  }
  if (claim.tipo === "livre") {
    return claim.accessToken || segredo || null;
  }

  const novo = await postRefresh(deps, claim.refreshToken);
  if ("motivo" in novo) {
    await soltar(deps, claim.refreshToken);
    await alertar(deps, novo.motivo);
    if (forcar) return null;
    return claim.accessToken || segredo || null;
  }
  const gravou = await gravar(deps, novo, claim.refreshToken);
  if (!gravou) {
    await soltar(deps, claim.refreshToken);
    const deNovo = await lerEstado(deps);
    if (deNovo !== "falha" && deNovo.accessToken) return deNovo.accessToken;
    return novo.accessToken;
  }
  return novo.accessToken;
}

let cache: { token: string; expira: number } | null = null;

export async function tokenMelhorEnvio(opcoes?: { forcar?: boolean }): Promise<string | null> {
  const forcar = opcoes?.forcar === true;
  if (!forcar && cache && cache.expira > Date.now()) return cache.token;
  let token: string | null = null;
  try {
    token = await resolverToken(depsPadrao(), { forcar });
  } catch (err) {
    console.error("token me", err instanceof Error ? err.name : "erro");
    token = null;
  }
  if (token) cache = { token, expira: Date.now() + 60_000 };
  else if (forcar) cache = null;
  return token;
}

async function executar(url: string, token: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("Authorization", "Bearer " + token);
  headers.set("User-Agent", USER_AGENT_OAUTH);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return await fetch(url, { ...init, headers });
}

export async function chamarMelhorEnvio(url: string, init: RequestInit = {}): Promise<Response | null> {
  const token = await tokenMelhorEnvio();
  if (!token) return null;
  const primeira = await executar(url, token, init);
  if (primeira.status !== 401) return primeira;
  const novo = await tokenMelhorEnvio({ forcar: true });
  if (!novo || novo === token) return primeira;
  await primeira.body?.cancel().catch(() => {});
  return await executar(url, novo, init);
}
