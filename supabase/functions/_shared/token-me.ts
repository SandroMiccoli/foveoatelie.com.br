// Token OAuth do Melhor Envio. Quem chama a API pede um access token aqui.
// A tabela private.melhor_envio_oauth guarda o par do aplicativo.
// MELHOR_ENVIO_TOKEN é outro token, pessoal e de longa duração
// ("Permissões de acesso"): reserva quando a tabela está vazia e quando
// a renovação forçada não responde. expires_at nulo não gira no checkout.
// A manutenção diária trata nulo como "renovar nesta rodada".
// A renovação trava a linha para duas chamadas não girarem o refresh juntas.

import { registrarFalhaToken } from "./avisos.ts";

export const USER_AGENT_OAUTH = "Foveo Atelie (contato@foveoatelie.com.br)";
export const OAUTH_TOKEN_URL = "https://melhorenvio.com.br/oauth/token";
export const ANTECEDENCIA_MS = 7 * 24 * 60 * 60 * 1000;
const EXPIRA_PADRAO_S = 2592000;
const ESPERA_MS = 400;
const TENTATIVAS_ESPERA = 12;
const TENTATIVAS_GRAVAR = 3;
const ESPERA_GRAVAR_MS = 400;
const TIMEOUT_CHAMADA_MS = 20000;

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
  agendado = false,
): DecisaoToken {
  if (estado.renovando) return { tipo: "esperar" };
  const atual = estado.accessToken || segredo;
  const semData = agendado && !estado.vazio && !estado.expiresAt;
  const precisa = forcar || semData || precisaRenovar(estado.expiresAt, agora);
  if (!precisa) return atual ? { tipo: "usar", token: atual } : { tipo: "ausente" };
  if (!estado.temRefresh) return { tipo: "sem_refresh", token: atual };
  return { tipo: "renovar" };
}

export function reservaDepoisDo401(
  segredo: string,
  tokenUsado: string,
  tokenRenovado: string | null,
): string | null {
  if (tokenRenovado) return null;
  const reserva = segredo.trim();
  if (!reserva || reserva === tokenUsado) return null;
  return reserva;
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

type GravarResultado = "ok" | "conflito" | "falha";

async function gravar(
  deps: DepsToken,
  novo: { accessToken: string; refreshToken: string; expiresAt: string },
  refreshUsado: string,
): Promise<GravarResultado> {
  const data = await rpcToken(deps, "gravar_oauth_melhor_envio", {
    p_access_token: novo.accessToken,
    p_refresh_token: novo.refreshToken,
    p_expires_at: novo.expiresAt,
    p_refresh_usado: refreshUsado,
  });
  if (data === "falha") return "falha";
  if (!data || typeof data !== "object") return "falha";
  const row = data as { ok?: unknown; erro?: unknown };
  if (row.ok === true) return "ok";
  if (row.erro === "conflito") return "conflito";
  return "falha";
}

async function parJaGravado(
  deps: DepsToken,
  accessToken: string,
): Promise<boolean> {
  const estado = await lerEstado(deps);
  return estado !== "falha" && estado.accessToken === accessToken;
}

async function persistirPar(
  deps: DepsToken,
  novo: { accessToken: string; refreshToken: string; expiresAt: string },
  refreshUsado: string,
): Promise<boolean> {
  for (let i = 0; i < TENTATIVAS_GRAVAR; i++) {
    if (i > 0) await deps.esperar(ESPERA_GRAVAR_MS * i);
    const resultado = await gravar(deps, novo, refreshUsado);
    if (resultado === "ok") return true;
    if (resultado === "conflito") return await parJaGravado(deps, novo.accessToken);
    console.error("token me: gravar", i + 1);
  }
  return await parJaGravado(deps, novo.accessToken);
}

function tokenAtual(estado: EstadoToken, segredo: string): string {
  return estado.accessToken || segredo;
}

export async function resolverToken(
  deps: DepsToken,
  opcoes?: { forcar?: boolean; agendado?: boolean },
  tentativa = 0,
): Promise<string | null> {
  const forcar = opcoes?.forcar === true;
  const agendado = opcoes?.agendado === true;
  const segredo = (deps.env("MELHOR_ENVIO_TOKEN") ?? "").trim();
  const estado = await lerEstado(deps);
  if (estado === "falha") {
    if (!forcar && segredo) return segredo;
    await alertar(deps, "banco");
    return forcar ? null : (segredo || null);
  }

  const decisao = decidirRenovacao(estado, segredo, forcar, deps.agora(), agendado);
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

  const forcarSql = forcar || (agendado && !estado.expiresAt);
  const cru = await rpcToken(deps, "reivindicar_oauth_melhor_envio", { p_forcar: forcarSql });
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
  const gravou = await persistirPar(deps, novo, claim.refreshToken);
  if (!gravou) {
    console.error("token me: par novo nao gravado");
    await alertar(deps, "reautorizar");
    return novo.accessToken;
  }
  return novo.accessToken;
}

let cache: { token: string; expira: number } | null = null;

export async function tokenMelhorEnvio(opcoes?: { forcar?: boolean; agendado?: boolean }): Promise<string | null> {
  const forcar = opcoes?.forcar === true;
  const agendado = opcoes?.agendado === true;
  if (!forcar && !agendado && cache && cache.expira > Date.now()) return cache.token;
  let token: string | null = null;
  try {
    token = await resolverToken(depsPadrao(), { forcar, agendado });
  } catch (err) {
    console.error("token me", err instanceof Error ? err.name : "erro");
    token = null;
  }
  if (token) cache = { token, expira: Date.now() + 60_000 };
  else if (forcar) cache = null;
  return token;
}

export function opcoesDaTentativa(init: RequestInit, timeoutMs = TIMEOUT_CHAMADA_MS): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("User-Agent", USER_AGENT_OAUTH);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const { signal: _sinal, ...resto } = init;
  return {
    ...resto,
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  };
}

async function executar(url: string, token: string, init: RequestInit): Promise<Response> {
  const opcoes = opcoesDaTentativa(init);
  const headers = new Headers(opcoes.headers);
  headers.set("Authorization", "Bearer " + token);
  return await fetch(url, { ...opcoes, headers });
}

export async function chamarMelhorEnvio(url: string, init: RequestInit = {}): Promise<Response | null> {
  const token = await tokenMelhorEnvio();
  if (!token) return null;
  const primeira = await executar(url, token, init);
  if (primeira.status !== 401) return primeira;
  const novo = await tokenMelhorEnvio({ forcar: true });
  if (novo && novo !== token) {
    await primeira.body?.cancel().catch(() => {});
    return await executar(url, novo, init);
  }
  const reserva = reservaDepoisDo401(Deno.env.get("MELHOR_ENVIO_TOKEN") ?? "", token, novo);
  if (!reserva) return primeira;
  await primeira.body?.cancel().catch(() => {});
  return await executar(url, reserva, init);
}
