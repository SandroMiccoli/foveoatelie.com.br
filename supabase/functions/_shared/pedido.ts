// Contas e regras do Checkout Pro que não dependem da rede.
// A Orders API exige total_amount = soma de unit_price × quantity, em string.

export type ItemMp = { title: string; quantity: number; unit_price: string };

export type LinhaProduto = { nome: string; qtd: number };

const HOSTS_MP = [
  "mercadopago.com",
  "mercadopago.com.br",
  "mercadopago.com.ar",
  "mercadopago.cl",
  "mercadopago.com.mx",
  "mercadopago.com.co",
  "mercadopago.com.pe",
  "mercadopago.com.uy",
];

export function centavosParaReais(centavos: number): string {
  const negativo = centavos < 0;
  const abs = Math.abs(Math.trunc(centavos));
  const reais = Math.floor(abs / 100);
  const cents = abs % 100;
  return (negativo ? "-" : "") + String(reais) + "." + String(cents).padStart(2, "0");
}

export function reaisParaCentavos(valor: unknown): number | null {
  const texto = typeof valor === "number"
    ? (Number.isFinite(valor) ? String(valor) : "")
    : typeof valor === "string"
    ? valor.trim().replace(/\s/g, "").replace(",", ".")
    : "";
  if (!/^\d+(\.\d+)?$/.test(texto)) return null;
  const numero = Number(texto);
  if (!Number.isFinite(numero) || numero < 0) return null;
  return Math.round(numero * 100);
}

export function itensPagamento(
  linhas: LinhaProduto[],
  produtoCentavos: number,
  frete: { titulo: string; centavos: number } | null,
): ItemMp[] {
  const qtd = linhas.reduce((soma, linha) => soma + linha.qtd, 0);
  if (qtd < 1 || produtoCentavos < 0) return [];

  const base = Math.floor(produtoCentavos / qtd);
  let sobra = produtoCentavos - base * qtd;
  const items: ItemMp[] = [];

  for (const linha of linhas) {
    const porPreco = new Map<number, number>();
    for (let i = 0; i < linha.qtd; i++) {
      const extra = sobra > 0 ? 1 : 0;
      if (sobra > 0) sobra -= 1;
      const preco = base + extra;
      porPreco.set(preco, (porPreco.get(preco) ?? 0) + 1);
    }
    const titulo = ("Vela de massagem Foveō " + linha.nome).slice(0, 80);
    for (const [preco, quantity] of porPreco) {
      items.push({ title: titulo, quantity, unit_price: centavosParaReais(preco) });
    }
  }

  if (frete && frete.centavos > 0) {
    items.push({
      title: frete.titulo.slice(0, 80),
      quantity: 1,
      unit_price: centavosParaReais(frete.centavos),
    });
  }

  return items;
}

export function somaItensCentavos(items: ItemMp[]): number {
  let total = 0;
  for (const item of items) {
    const unit = reaisParaCentavos(item.unit_price);
    if (unit == null || !Number.isInteger(item.quantity) || item.quantity < 1) return -1;
    total += unit * item.quantity;
  }
  return total;
}

export type AcaoMp = "pago" | "recusado" | "expirado" | "cancelado" | "registrar";

export function acaoDaOrder(status: string, detail: string): AcaoMp {
  const st = status.trim().toLowerCase();
  const det = detail.trim().toLowerCase();
  if (st === "processed") return "pago";
  if (st === "failed") return "recusado";
  if (st === "canceled" || st === "cancelled") {
    return det === "expired" ? "expirado" : "cancelado";
  }
  return "registrar";
}

export function checkoutUrlConfiavel(url: string, orderId: string): boolean {
  if (!orderId || orderId.length > 64) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (_err) {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;
  if (parsed.port && parsed.port !== "443") return false;
  const host = parsed.hostname.toLowerCase();
  const hostOk = HOSTS_MP.some((sufixo) => host === sufixo || host.endsWith("." + sufixo));
  if (!hostOk) return false;
  return parsed.searchParams.get("order_id") === orderId || parsed.href.includes(orderId);
}

export function primeiroNome(nome: string): string {
  const parte = nome.trim().split(/\s+/).filter(Boolean)[0] ?? "";
  const chars = Array.from(parte.slice(0, 40).toLocaleLowerCase("pt-BR"));
  if (!chars.length) return "";
  chars[0] = chars[0].toLocaleUpperCase("pt-BR");
  return chars.join("");
}

export function numeroCurto(id: string): string {
  return id.replace(/[^0-9a-f]/gi, "").slice(0, 6).toUpperCase();
}

function dataCivil(instante: Date): { y: number; m: number; d: number } | null {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instante);
  const ler = (tipo: string) => Number(partes.find((parte) => parte.type === tipo)?.value);
  const y = ler("year");
  const m = ler("month");
  const d = ler("day");
  if (!y || !m || !d) return null;
  return { y, m, d };
}

function somarDias(y: number, m: number, d: number, dias: number): { y: number; m: number; d: number } {
  const data = new Date(Date.UTC(y, m - 1, d + dias));
  return { y: data.getUTCFullYear(), m: data.getUTCMonth() + 1, d: data.getUTCDate() };
}

// Fecha na sexta à noite (America/Sao_Paulo). A postagem é a quarta da semana seguinte:
// sexta + 5 dias. Sábado e domingo entram na semana que começa na segunda.
export function dataPostagem(instante: string | Date): string | null {
  const data = instante instanceof Date ? instante : new Date(instante);
  if (Number.isNaN(data.getTime())) return null;
  const civil = dataCivil(data);
  if (!civil) return null;
  let { y, m, d } = civil;
  let dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (dow === 6) {
    ({ y, m, d } = somarDias(y, m, d, 2));
    dow = 1;
  } else if (dow === 0) {
    ({ y, m, d } = somarDias(y, m, d, 1));
    dow = 1;
  }
  const sexta = somarDias(y, m, d, 5 - dow);
  const quarta = somarDias(sexta.y, sexta.m, sexta.d, 5);
  const mm = String(quarta.m).padStart(2, "0");
  const dd = String(quarta.d).padStart(2, "0");
  return `${quarta.y}-${mm}-${dd}`;
}

export function partirNome(nome: string): { first_name: string; last_name?: string } {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length < 2) return { first_name: partes[0] ?? nome };
  return { first_name: partes.slice(0, -1).join(" "), last_name: partes[partes.length - 1] };
}

export function telefoneMp(digitos: string): { area_code: string; number: string } | null {
  let d = digitos.replace(/\D/g, "");
  if (d.startsWith("55") && d.length > 11) d = d.slice(2);
  if (d.length < 10 || d.length > 11) return null;
  return { area_code: d.slice(0, 2), number: d.slice(2) };
}

export function manifestos(dataId: string | undefined, requestId: string | undefined, ts: string): string[] {
  const ids: Array<string | undefined> = [];
  if (dataId) {
    ids.push(dataId);
    const lower = dataId.toLowerCase();
    if (lower !== dataId) ids.push(lower);
  } else {
    ids.push(undefined);
  }
  return ids.map((id) => montarManifesto(id, requestId, ts));
}

function montarManifesto(dataId: string | undefined, requestId: string | undefined, ts: string): string {
  const parts: string[] = [];
  if (dataId) parts.push(`id:${dataId}`);
  if (requestId) parts.push(`request-id:${requestId}`);
  parts.push(`ts:${ts}`);
  return parts.join(";") + ";";
}

function tempoDoTs(ts: string): number | null {
  if (!/^\d+$/.test(ts)) return null;
  const n = Number(ts);
  if (!Number.isFinite(n)) return null;
  return ts.length >= 13 ? n : n * 1000;
}

function igualTempoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(secret: string, mensagem: string): Promise<string> {
  const chave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bruto = await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(mensagem));
  return [...new Uint8Array(bruto)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function assinaturaValida(opts: {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string | null;
  secret: string;
  agoraMs?: number;
  toleranciaMs?: number;
}): Promise<boolean> {
  const header = (opts.xSignature ?? "").trim();
  if (!header || !opts.secret) return false;

  let ts = "";
  let v1 = "";
  for (const parte of header.split(",")) {
    const eq = parte.indexOf("=");
    if (eq < 0) continue;
    const k = parte.slice(0, eq).trim().toLowerCase();
    const v = parte.slice(eq + 1).trim();
    if (k === "ts") ts = v;
    else if (k === "v1") v1 = v;
  }
  if (!/^\d+$/.test(ts) || !/^[0-9a-f]+$/i.test(v1)) return false;

  const tolerancia = opts.toleranciaMs ?? 10 * 60 * 1000;
  const agora = opts.agoraMs ?? Date.now();
  const tsMs = tempoDoTs(ts);
  if (tsMs == null || Math.abs(agora - tsMs) > tolerancia) return false;

  const requestId = (opts.xRequestId ?? "").trim() || undefined;
  const dataId = (opts.dataId ?? "").trim() || undefined;
  for (const manifesto of manifestos(dataId, requestId, ts)) {
    const calculado = await hmacHex(opts.secret, manifesto);
    if (igualTempoConstante(calculado.toLowerCase(), v1.toLowerCase())) return true;
  }
  return false;
}
