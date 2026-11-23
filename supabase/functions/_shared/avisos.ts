// Avisos para o chat do ateliê. O registro fica no banco (dedupe).
// O POST ao bot sai em segundo plano, com o mesmo cabeçalho do pedido pago.
// Falha aqui não pode derrubar pagamento, etiqueta nem webhook.

import { emSegundoPlano } from "./segundo-plano.ts";

export const ESTOQUE_MINIMO = 3;
export const SALDO_BAIXO_CENTAVOS = 5000;

export const TIPOS_AVISO = [
  "estoque_baixo",
  "saldo_baixo",
  "problema_entrega",
  "token_melhor_envio",
  "feedback_novo",
] as const;

export type TipoAviso = (typeof TIPOS_AVISO)[number];

export type SituacaoEntrega = "cancelada" | "nao_entregue" | "pausada" | "suspensa" | "devolucao";

export type ProblemaEntrega = { situacao: SituacaoEntrega; rotulo: string };

const ROTULO_ENTREGA: Record<SituacaoEntrega, string> = {
  cancelada: "cancelada",
  nao_entregue: "não entregue",
  pausada: "pausada",
  suspensa: "suspensa",
  devolucao: "devolução",
};

const EVENTOS_PROBLEMA: Record<string, SituacaoEntrega> = {
  "order.cancelled": "cancelada",
  "order.canceled": "cancelada",
  "order.undelivered": "nao_entregue",
  "order.paused": "pausada",
  "order.suspended": "suspensa",
  "order.returned": "devolucao",
  "order.returning": "devolucao",
};

const STATUS_PROBLEMA: Record<string, SituacaoEntrega> = {
  cancelled: "cancelada",
  canceled: "cancelada",
  undelivered: "nao_entregue",
  paused: "pausada",
  suspended: "suspensa",
  returned: "devolucao",
  returning: "devolucao",
};

const EVENTOS_OK = new Set([
  "order.created",
  "order.pending",
  "order.released",
  "order.generated",
  "order.received",
  "order.posted",
  "order.delivered",
]);

const FRASE_TOKEN: Record<string, string> = {
  sem_refresh: "Falta o refresh_token na tabela. O passo de seed ainda não rodou.",
  sem_credencial: "Faltam MELHOR_ENVIO_CLIENT_ID ou MELHOR_ENVIO_APP_SECRET.",
  recusado: "O Melhor Envio recusou a renovação.",
  sem_resposta: "O Melhor Envio não respondeu.",
  resposta_invalida: "A resposta veio sem o par de tokens.",
  banco: "Não consegui ler o token guardado.",
  reautorizar: "O par novo não ficou gravado. O refresh antigo já não vale. Precisa autorizar o aplicativo de novo.",
};

export type AcaoEstoque = "alertar" | "rearmar" | "nada";

export function deveAlertarEstoque(
  tipo: string,
  antes: number,
  depois: number,
  jaAvisado: boolean,
): AcaoEstoque {
  if (!Number.isInteger(antes) || !Number.isInteger(depois)) return "nada";
  if (antes === depois) return "nada";
  if (depois >= ESTOQUE_MINIMO) return jaAvisado ? "rearmar" : "nada";
  if (antes < ESTOQUE_MINIMO) return "nada";
  if (tipo !== "venda" && tipo !== "ajuste" && tipo !== "producao") return "nada";
  if (jaAvisado) return "nada";
  return "alertar";
}

export function chaveDiaSp(agora: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

export function saldoAbaixo(centavos: number): boolean {
  return Number.isInteger(centavos) && centavos >= 0 && centavos < SALDO_BAIXO_CENTAVOS;
}

export function chaveProblema(meId: string, situacao: SituacaoEntrega): string {
  return meId + ":" + situacao;
}

export function podeRegistrarAviso(
  ocupadas: { tipo: string; chave: string }[],
  tipo: string,
  chave: string,
): boolean {
  if (!TIPOS_AVISO.includes(tipo as TipoAviso)) return false;
  if (!chave || chave.length > 120) return false;
  return !ocupadas.some((item) => item.tipo === tipo && item.chave === chave);
}

export function formatarReais(centavos: number): string {
  const negativo = centavos < 0;
  const abs = Math.abs(Math.round(centavos));
  const reais = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, "0");
  const inteiro = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return (negativo ? "-" : "") + "R$ " + inteiro + "," + cents;
}

export function mensagemEstoque(nome: string, disponivel: number): string {
  const unidade = disponivel === 1 ? "vela" : "velas";
  return nome.trim() + " está com " + disponivel + " " + unidade + " no estoque.";
}

export function mensagemSaldo(centavos: number): string {
  return "O saldo do Melhor Envio está em " + formatarReais(centavos) + ", abaixo de R$ 50,00.";
}

export function mensagemToken(motivo: string): string {
  const frase = FRASE_TOKEN[motivo] || "A renovação não completou.";
  return "Não consegui renovar o token do Melhor Envio. " + frase;
}

export function problemaEntrega(evento: string, status: string): ProblemaEntrega | null {
  const ev = evento.trim().toLowerCase();
  if (EVENTOS_OK.has(ev)) return null;
  const st = status.trim().toLowerCase();
  const situacao = EVENTOS_PROBLEMA[ev] || STATUS_PROBLEMA[st] || null;
  if (!situacao) return null;
  return { situacao, rotulo: ROTULO_ENTREGA[situacao] };
}

function referenciaEntrega(codigo: string, protocolo: string): { comArtigo: string; objeto: string } | null {
  if (/^\d{9}$/.test(codigo)) {
    return { comArtigo: "do pedido #" + codigo, objeto: "o pedido #" + codigo };
  }
  const proto = protocolo.trim().slice(0, 40);
  if (proto) return { comArtigo: "da etiqueta " + proto, objeto: "a etiqueta " + proto };
  return null;
}

export function mensagemProblema(
  problema: ProblemaEntrega,
  codigo: string,
  protocolo: string,
): string {
  const ref = referenciaEntrega(codigo, protocolo);
  if (problema.situacao === "cancelada") {
    return ref
      ? "O Melhor Envio cancelou a etiqueta " + ref.comArtigo + "."
      : "O Melhor Envio cancelou uma etiqueta.";
  }
  if (problema.situacao === "nao_entregue") {
    return ref
      ? "O Melhor Envio não conseguiu entregar " + ref.objeto + "."
      : "O Melhor Envio não conseguiu entregar uma encomenda.";
  }
  if (problema.situacao === "pausada") {
    return ref
      ? "A entrega " + ref.comArtigo + " parou. Quem recebe precisa fazer alguma coisa."
      : "Uma entrega parou. Quem recebe precisa fazer alguma coisa.";
  }
  if (problema.situacao === "suspensa") {
    return ref
      ? "O Melhor Envio suspendeu a entrega " + ref.comArtigo + "."
      : "O Melhor Envio suspendeu uma entrega.";
  }
  return ref
    ? "O Melhor Envio registrou devolução " + ref.comArtigo + "."
    : "O Melhor Envio registrou uma devolução.";
}

export function corpoWebhookAviso(aviso: {
  tipo: string;
  mensagem: string;
  quando: string;
  detalhe: Record<string, string | number>;
}): Record<string, string | number> {
  const corpo: Record<string, string | number> = {
    tipo: aviso.tipo,
    mensagem: aviso.mensagem,
    quando: aviso.quando,
  };
  for (const [chave, valor] of Object.entries(aviso.detalhe)) {
    if (chave === "tipo" || chave === "mensagem" || chave === "quando") continue;
    if (typeof valor === "string" || typeof valor === "number") corpo[chave] = valor;
  }
  return corpo;
}

export function papelDoJwt(jwt: string): string {
  const parte = jwt.split(".")[1] ?? "";
  if (!parte) return "";
  try {
    const pad = parte.length % 4 === 0 ? "" : "=".repeat(4 - (parte.length % 4));
    const json = atob(parte.replace(/-/g, "+").replace(/_/g, "/") + pad);
    const data = JSON.parse(json);
    return data && typeof data.role === "string" ? data.role : "";
  } catch (_err) {
    return "";
  }
}

type Cred = { url: string; key: string };

function credenciais(): Cred | null {
  const url = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  const key = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  if (!url || !key) return null;
  return { url, key };
}

async function rpc(cred: Cred, nome: string, corpo: unknown): Promise<unknown | null> {
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
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    console.error("aviso: rpc", nome, err instanceof Error ? err.name : "erro");
    return null;
  }
  if (!res.ok) {
    console.error("aviso: rpc", nome, res.status);
    return null;
  }
  if (res.status === 204) return {};
  try {
    return await res.json();
  } catch (_err) {
    return {};
  }
}

export async function registrarAviso(entrada: {
  tipo: TipoAviso;
  chave: string;
  mensagem: string;
  detalhe?: Record<string, string | number>;
}): Promise<boolean> {
  const cred = credenciais();
  if (!cred) return false;
  const data = await rpc(cred, "registrar_aviso", {
    p_tipo: entrada.tipo,
    p_chave: entrada.chave,
    p_mensagem: entrada.mensagem,
    p_detalhe: entrada.detalhe ?? {},
  });
  const novo = Boolean(data && typeof data === "object" && (data as { novo?: unknown }).novo === true);
  if (novo) emSegundoPlano(despacharAvisosPendentes());
  return novo;
}

type AvisoPendente = {
  id: string;
  tipo: string;
  mensagem: string;
  detalhe: Record<string, string | number>;
  created_at: string;
};

function lerPendente(item: unknown): AvisoPendente | null {
  if (!item || typeof item !== "object") return null;
  const row = item as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id : "";
  const tipo = typeof row.tipo === "string" ? row.tipo : "";
  const mensagem = typeof row.mensagem === "string" ? row.mensagem.trim() : "";
  const created = typeof row.created_at === "string" ? row.created_at : "";
  if (!id || !tipo || !mensagem || !created) return null;
  const detalheBruto = row.detalhe && typeof row.detalhe === "object" ? row.detalhe as Record<string, unknown> : {};
  const detalhe: Record<string, string | number> = {};
  for (const [chave, valor] of Object.entries(detalheBruto)) {
    if (typeof valor === "string" || typeof valor === "number") detalhe[chave] = valor;
  }
  return { id, tipo, mensagem, detalhe, created_at: created };
}

async function postarAviso(aviso: AvisoPendente): Promise<boolean> {
  const url = (Deno.env.get("GROKBOT_AVISOS_WEBHOOK_URL") ?? "").trim();
  const key = (Deno.env.get("GROKBOT_AVISOS_WEBHOOK_KEY") ?? "").trim();
  if (!url || !key || !url.startsWith("https://")) return false;
  const corpo = corpoWebhookAviso({
    tipo: aviso.tipo,
    mensagem: aviso.mensagem,
    quando: aviso.created_at,
    detalhe: aviso.detalhe,
  });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        "X-Automation-Key": key,
      },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error("aviso: webhook", res.status);
      return false;
    }
    return true;
  } catch (err) {
    console.error("aviso: webhook sem resposta", err instanceof Error ? err.name : "erro");
    return false;
  }
}

export async function despacharAvisosPendentes(): Promise<number> {
  const cred = credenciais();
  if (!cred) return 0;
  const data = await rpc(cred, "reivindicar_avisos_pendentes", { p_limite: 8 });
  const lista = Array.isArray(data) ? data : [];
  const pendentes = lista.map(lerPendente).filter((item): item is AvisoPendente => item != null);
  if (!pendentes.length) return 0;

  const url = (Deno.env.get("GROKBOT_AVISOS_WEBHOOK_URL") ?? "").trim();
  const key = (Deno.env.get("GROKBOT_AVISOS_WEBHOOK_KEY") ?? "").trim();
  if (!url || !key || !url.startsWith("https://")) {
    console.error("aviso: webhook de avisos ausente");
    for (const aviso of pendentes) {
      await rpc(cred, "soltar_aviso", { p_id: aviso.id });
    }
    return 0;
  }

  let enviados = 0;
  for (const aviso of pendentes) {
    const ok = await postarAviso(aviso);
    if (ok) {
      const marcou = await rpc(cred, "marcar_aviso_enviado", { p_id: aviso.id });
      if (marcou != null) enviados += 1;
    } else {
      await rpc(cred, "soltar_aviso", { p_id: aviso.id });
    }
  }
  return enviados;
}

export async function registrarProblemaEntrega(entrada: {
  meId: string;
  evento: string;
  status: string;
  codigo: string;
  protocolo: string;
  rastreio: string;
}): Promise<void> {
  const problema = problemaEntrega(entrada.evento, entrada.status);
  if (!problema) return;
  const codigo = /^\d{9}$/.test(entrada.codigo) ? entrada.codigo : "";
  const detalhe: Record<string, string | number> = { situacao: problema.rotulo };
  if (codigo) detalhe.pedido = "#" + codigo;
  if (entrada.protocolo.trim()) detalhe.protocolo = entrada.protocolo.trim().slice(0, 40);
  if (entrada.rastreio.trim()) detalhe.rastreio = entrada.rastreio.trim().slice(0, 40);
  await registrarAviso({
    tipo: "problema_entrega",
    chave: chaveProblema(entrada.meId, problema.situacao),
    mensagem: mensagemProblema(problema, codigo, entrada.protocolo),
    detalhe,
  });
}

export async function registrarSaldoBaixo(centavos: number, agora = new Date()): Promise<void> {
  if (!saldoAbaixo(centavos)) return;
  await registrarAviso({
    tipo: "saldo_baixo",
    chave: chaveDiaSp(agora),
    mensagem: mensagemSaldo(centavos),
    detalhe: { saldo: formatarReais(centavos) },
  });
}

export async function registrarFalhaToken(motivo: string, agora = new Date()): Promise<void> {
  await registrarAviso({
    tipo: "token_melhor_envio",
    chave: chaveDiaSp(agora),
    mensagem: mensagemToken(motivo),
    detalhe: { motivo: FRASE_TOKEN[motivo] || mensagemToken(motivo) },
  });
}
