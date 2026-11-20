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

const AGUARDANDO_PAGAMENTO = new Set([
  "waiting_payment",
  "pending_challenge",
  "waiting_transfer",
  "waiting_capture",
]);

// Cartão recusado com a order ainda aberta (waiting_retry, ou o último
// pagamento rejected/failed). Não solta a reserva: o comprador pode tentar de novo.
export function retentativaDePagamento(status: string, detail: string, pagamentoStatus = ""): boolean {
  const st = status.trim().toLowerCase();
  const det = detail.trim().toLowerCase();
  const pg = pagamentoStatus.trim().toLowerCase();
  if (st === "processed" || st === "failed" || st === "canceled" || st === "cancelled" || st === "expired" || st === "refunded") {
    return false;
  }
  if (pg === "rejected" || pg === "failed" || pg === "declined") return true;
  if (det === "waiting_retry") return true;
  if (st === "action_required" && !AGUARDANDO_PAGAMENTO.has(det)) return true;
  return false;
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

// YYMMDDNNN no fuso de São Paulo. A sequência é do dia, não da loja inteira.
export function codigoPedido(instante: Date | string, sequencia: number): string {
  const data = instante instanceof Date ? instante : new Date(instante);
  if (Number.isNaN(data.getTime())) return "";
  if (!Number.isInteger(sequencia) || sequencia < 1 || sequencia > 999) return "";
  const civil = dataCivil(data);
  if (!civil) return "";
  const yy = String(civil.y % 100).padStart(2, "0");
  const mm = String(civil.m).padStart(2, "0");
  const dd = String(civil.d).padStart(2, "0");
  return `${yy}${mm}${dd}${String(sequencia).padStart(3, "0")}`;
}

function somarDias(y: number, m: number, d: number, dias: number): { y: number; m: number; d: number } {
  const data = new Date(Date.UTC(y, m - 1, d + dias));
  return { y: data.getUTCFullYear(), m: data.getUTCMonth() + 1, d: data.getUTCDate() };
}

function isoCivil(c: { y: number; m: number; d: number }): string {
  return `${c.y}-${String(c.m).padStart(2, "0")}-${String(c.d).padStart(2, "0")}`;
}

function diaMesCivil(c: { y: number; m: number; d: number }): string {
  return String(c.d).padStart(2, "0") + "/" + String(c.m).padStart(2, "0");
}

// Corte na segunda 23:59 (America/Sao_Paulo). Pago até segunda → quarta da mesma
// semana; de terça 00:00 a domingo 23:59 → quarta da semana seguinte.
// Ex.: dom 22/11 → 25/11; seg 23/11 → 25/11; ter 24/11 → 02/12.
function civilQuartaPostagem(instante: string | Date): { y: number; m: number; d: number } | null {
  const data = instante instanceof Date ? instante : new Date(instante);
  if (Number.isNaN(data.getTime())) return null;
  const civil = dataCivil(data);
  if (!civil) return null;
  const { y, m, d } = civil;
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=dom … 1=seg … 6=sáb
  // Segunda → +2; terça → +8; quarta → +7; …; domingo → +3.
  const dias = dow === 1 ? 2 : dow === 0 ? 3 : 10 - dow;
  return somarDias(y, m, d, dias);
}

/** YYYY-MM-DD da quarta de postagem (página do pedido / lote). */
export function dataPostagem(instante: string | Date): string | null {
  const quarta = civilQuartaPostagem(instante);
  return quarta ? isoCivil(quarta) : null;
}

/** dd/mm da quarta de postagem (e-mail de pagamento confirmado). */
export function proximaQuartaPostagem(instante: string | Date): string | null {
  const quarta = civilQuartaPostagem(instante);
  return quarta ? diaMesCivil(quarta) : null;
}

/** Quarta-feira do lote atual: hoje se for quarta em SP, senão a próxima. YYYY-MM-DD. */
export function quartaAlvoLote(agora: string | Date = new Date()): string | null {
  const data = agora instanceof Date ? agora : new Date(agora);
  if (Number.isNaN(data.getTime())) return null;
  const civil = dataCivil(data);
  if (!civil) return null;
  const dow = new Date(Date.UTC(civil.y, civil.m - 1, civil.d)).getUTCDay();
  const dias = dow === 3 ? 0 : (3 - dow + 7) % 7;
  return isoCivil(somarDias(civil.y, civil.m, civil.d, dias));
}

/** Pedido entra no lote se a postagem for até a quarta alvo (inclui atrasados). */
export function pedidoNoLoteQuarta(
  quando: string | Date,
  agora: string | Date = new Date(),
): boolean {
  const postagem = dataPostagem(quando);
  const alvo = quartaAlvoLote(agora);
  if (!postagem || !alvo) return false;
  return postagem <= alvo;
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

export type DiagnosticoAssinatura = {
  ok: boolean;
  ts: string;
  requestIdPresente: boolean;
  dataId: string;
  variantes: string[];
  v1Recebido8: string;
  calculados8: string[];
  motivo: "ok" | "sem_header" | "formato" | "janela" | "hmac";
};

function prefixo8(hex: string): string {
  return hex.toLowerCase().slice(0, 8);
}

export async function diagnosticarAssinatura(opts: {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string | null;
  secret: string;
  agoraMs?: number;
  toleranciaMs?: number;
}): Promise<DiagnosticoAssinatura> {
  const header = (opts.xSignature ?? "").trim();
  const requestIdBruto = (opts.xRequestId ?? "").trim();
  const dataId = (opts.dataId ?? "").trim();
  const base = {
    ts: "",
    requestIdPresente: requestIdBruto.length > 0,
    dataId,
    variantes: [] as string[],
    v1Recebido8: "",
    calculados8: [] as string[],
  };
  if (!header || !opts.secret) return { ...base, ok: false, motivo: "sem_header" };

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
  base.ts = ts;
  base.v1Recebido8 = prefixo8(v1);
  if (!/^\d+$/.test(ts) || !/^[0-9a-f]+$/i.test(v1)) {
    return { ...base, ok: false, motivo: "formato" };
  }

  const requestId = requestIdBruto || undefined;
  const variantes = manifestos(dataId || undefined, requestId, ts);
  base.variantes = variantes;
  const calculados: string[] = [];
  let bateu = false;
  for (const manifesto of variantes) {
    const calculado = await hmacHex(opts.secret, manifesto);
    calculados.push(prefixo8(calculado));
    if (igualTempoConstante(calculado.toLowerCase(), v1.toLowerCase())) bateu = true;
  }
  base.calculados8 = calculados;

  const tolerancia = opts.toleranciaMs ?? 10 * 60 * 1000;
  const agora = opts.agoraMs ?? Date.now();
  const tsMs = tempoDoTs(ts);
  if (tsMs == null || Math.abs(agora - tsMs) > tolerancia) {
    return { ...base, ok: false, motivo: "janela" };
  }
  return { ...base, ok: bateu, motivo: bateu ? "ok" : "hmac" };
}

export async function assinaturaValida(opts: {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string | null;
  secret: string;
  agoraMs?: number;
  toleranciaMs?: number;
}): Promise<boolean> {
  const diagnostico = await diagnosticarAssinatura(opts);
  return diagnostico.ok;
}
