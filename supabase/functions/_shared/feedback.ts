// Leitura e resumo do formulário /feedback/. A função enviar-feedback
// confere de novo no banco. O texto do aviso fica aqui para o teste
// travar a frase que o chat do ateliê recebe.

export const VELAS_FEEDBACK = ["Acolher", "Despertar", "Permanecer", "Não lembro"] as const;
export const SHARES_FEEDBACK = ["Sim, com meu nome", "Sim, anônimo", "Não"] as const;
export const NOVIDADES_FEEDBACK = ["", "Sim", "Não"] as const;

export const LIMITE_TEXTO = 2000;
export const LIMITE_NOME = 120;
export const LIMITE_CONTATO = 160;
export const LIMITE_NOME_COMPLETO = 160;
export const LIMITE_EMAIL = 254;
export const LIMITE_WHATSAPP = 40;
export const LIMITE_MENSAGEM = 500;
export const LIMITE_LINHA = 80;

const CHAVES_BOT = ["bot", "bot-field", "website"];

export type FeedbackLimpo = {
  candles: string[];
  rating: number;
  sensacao: string;
  mudaria: string;
  depoimento: string;
  instagram_share: string;
  novidades: string;
  nome: string;
  contato: string;
  nome_completo: string;
  whatsapp: string;
  email: string;
  contato_novo: boolean;
};

export type LeituraFeedback =
  | { ok: true; feedback: FeedbackLimpo }
  | { ok: false; erro: "invalido" | "longo" };

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function lista(valor: unknown): string[] {
  if (Array.isArray(valor)) return valor.map((item) => texto(item)).filter(Boolean);
  if (typeof valor === "string" && valor.trim()) return [valor.trim()];
  return [];
}

// Vazio devolve "". Número brasileiro tolerante devolve 55 + DDD + assinante.
// Formato ruim devolve null. Aceita máscara, zero de operadora e +55.
export function normalizarWhatsapp(valor: string): string | null {
  const bruto = valor.trim();
  if (!bruto) return "";
  if (bruto.length > LIMITE_WHATSAPP) return null;
  let digitos = bruto.replace(/\D/g, "");
  if (digitos.startsWith("00")) digitos = digitos.slice(2);
  if (digitos.startsWith("0") && digitos.length >= 11 && digitos.length <= 14) {
    digitos = digitos.slice(1);
  }
  if (digitos.startsWith("55") && (digitos.length === 12 || digitos.length === 13)) {
    digitos = digitos.slice(2);
  }
  if (!/^[1-9][1-9]\d{8,9}$/.test(digitos)) return null;
  return "55" + digitos;
}

export function emailFeedbackValido(valor: string): boolean {
  const email = valor.trim();
  if (!email) return true;
  if (email.length > LIMITE_EMAIL) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

export function honeypotCheio(corpo: unknown): boolean {
  if (!corpo || typeof corpo !== "object") return false;
  const row = corpo as Record<string, unknown>;
  return CHAVES_BOT.some((chave) => texto(row[chave]) !== "");
}

function cortar(valor: string, limite: number, longo: { atual: boolean }): string {
  if (valor.length > limite) longo.atual = true;
  return valor;
}

export function lerFeedback(corpo: unknown): LeituraFeedback {
  if (!corpo || typeof corpo !== "object") return { ok: false, erro: "invalido" };
  const row = corpo as Record<string, unknown>;
  const bruto = lista(row.candles ?? row.velas);
  if (!bruto.length) return { ok: false, erro: "invalido" };
  for (const nome of bruto) {
    if (!VELAS_FEEDBACK.includes(nome as (typeof VELAS_FEEDBACK)[number])) {
      return { ok: false, erro: "invalido" };
    }
  }
  const candles = VELAS_FEEDBACK.filter((nome) => bruto.includes(nome));
  if (candles.length < 1 || candles.length > 4) return { ok: false, erro: "invalido" };

  const notaBruta = row.rating ?? row.nota;
  const notaTexto = typeof notaBruta === "number" ? String(notaBruta) : texto(notaBruta);
  if (!/^[1-5]$/.test(notaTexto)) return { ok: false, erro: "invalido" };

  const share = texto(row.instagram_share ?? row.compartilhar);
  if (!SHARES_FEEDBACK.includes(share as (typeof SHARES_FEEDBACK)[number])) {
    return { ok: false, erro: "invalido" };
  }

  const novidades = texto(row.novidades);
  if (!NOVIDADES_FEEDBACK.includes(novidades as (typeof NOVIDADES_FEEDBACK)[number])) {
    return { ok: false, erro: "invalido" };
  }

  const longo = { atual: false };
  const contatoNovo = "nome_completo" in row || "whatsapp" in row || "email" in row;
  let nomeCompleto = "";
  let whatsapp = "";
  let email = "";
  if (contatoNovo && novidades === "Sim") {
    nomeCompleto = texto(row.nome_completo);
    email = texto(row.email);
    const zapBruto = texto(row.whatsapp);
    if (
      nomeCompleto.length > LIMITE_NOME_COMPLETO
      || email.length > LIMITE_EMAIL
      || zapBruto.length > LIMITE_WHATSAPP
    ) {
      return { ok: false, erro: "longo" };
    }
    if (!emailFeedbackValido(email)) return { ok: false, erro: "invalido" };
    const zap = normalizarWhatsapp(zapBruto);
    if (zap === null) return { ok: false, erro: "invalido" };
    if (!zap && !email) return { ok: false, erro: "invalido" };
    whatsapp = zap;
  }
  const feedback: FeedbackLimpo = {
    candles,
    rating: Number(notaTexto),
    sensacao: cortar(texto(row.sensacao), LIMITE_TEXTO, longo),
    mudaria: cortar(texto(row.mudaria), LIMITE_TEXTO, longo),
    depoimento: cortar(texto(row.depoimento), LIMITE_TEXTO, longo),
    instagram_share: share,
    novidades,
    nome: cortar(texto(row.nome), LIMITE_NOME, longo),
    contato: cortar(texto(row.contato), LIMITE_CONTATO, longo),
    nome_completo: nomeCompleto,
    whatsapp,
    email,
    contato_novo: contatoNovo,
  };
  if (longo.atual) return { ok: false, erro: "longo" };
  return { ok: true, feedback };
}

export function camposDoFormulario(bruto: string): Record<string, unknown> {
  const params = new URLSearchParams(bruto);
  const velas = params.getAll("vela[]").concat(params.getAll("vela")).concat(params.getAll("candles"));
  const campos: Record<string, unknown> = {
    candles: velas,
    nota: params.get("nota") || params.get("rating") || "",
    sensacao: params.get("sensacao") || "",
    mudaria: params.get("mudaria") || "",
    depoimento: params.get("depoimento") || "",
    compartilhar: params.get("compartilhar") || params.get("instagram_share") || "",
    novidades: params.get("novidades") || "",
    nome: params.get("nome") || "",
    contato: params.get("contato") || "",
    bot: params.get("bot-field") || params.get("bot") || "",
  };
  if (params.has("nome_completo") || params.has("whatsapp") || params.has("email")) {
    campos.nome_completo = params.get("nome_completo") || "";
    campos.whatsapp = params.get("whatsapp") || "";
    campos.email = params.get("email") || "";
  }
  return campos;
}

export function primeiraLinha(valor: string, limite = LIMITE_LINHA): string {
  const linha = String(valor || "")
    .split(/\r?\n/)
    .map((parte) => parte.trim())
    .find(Boolean) || "";
  if (linha.length <= limite) return linha;
  if (limite < 2) return linha.slice(0, limite);
  return linha.slice(0, limite - 1).trimEnd() + "…";
}

export function mensagemFeedback(entrada: FeedbackLimpo): string {
  const partes = [
    "Nova resposta no feedback.",
    "Velas: " + entrada.candles.join(", ") + ".",
    "Nota " + entrada.rating + ".",
    "Compartilhar: " + entrada.instagram_share + ".",
  ];
  const extras: [string, string][] = [
    ["Na pele", entrada.sensacao],
    ["Mudaria", entrada.mudaria],
    ["Pra uma amiga", entrada.depoimento],
  ];
  for (const [rotulo, valor] of extras) {
    const linha = primeiraLinha(valor);
    if (linha) partes.push(rotulo + ": " + linha);
  }
  let msg = partes.join(" ");
  if (msg.length > LIMITE_MENSAGEM) msg = msg.slice(0, LIMITE_MENSAGEM - 1).trimEnd() + "…";
  return msg;
}

export function detalheFeedback(entrada: FeedbackLimpo): Record<string, string | number> {
  const detalhe: Record<string, string | number> = {
    velas: entrada.candles.join(", "),
    nota: entrada.rating,
    compartilhar: entrada.instagram_share,
  };
  const sensacao = primeiraLinha(entrada.sensacao, 140);
  const mudaria = primeiraLinha(entrada.mudaria, 140);
  const depoimento = primeiraLinha(entrada.depoimento, 140);
  if (sensacao) detalhe.sensacao = sensacao;
  if (mudaria) detalhe.mudaria = mudaria;
  if (depoimento) detalhe.depoimento = depoimento;
  return detalhe;
}

export function ipCliente(cabecalhos: Headers): string {
  const encaminhado = cabecalhos.get("x-forwarded-for") || "";
  const primeiro = encaminhado.split(",")[0]?.trim() || "";
  if (primeiro && primeiro.length <= 80) return primeiro;
  const real = (cabecalhos.get("x-real-ip") || "").trim();
  if (real && real.length <= 80) return real;
  return "";
}

export async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode("foveo-feedback:" + ip);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
