// Contas da etiqueta Melhor Envio que não chamam a rede.
// Carrinho e checkout gastam saldo: quem chama a API fica na Edge Function,
// e os testes passam um fetch falso. Remetente sai de secrets, nunca daqui.

import { montarPacotes, reaisParaCentavos, USER_AGENT } from "./frete.ts";
import { centavosParaReais } from "./pedido.ts";

export { USER_AGENT };

export const EVENTOS_EMAIL = [
  "pagamento_confirmado",
  "enviado",
  "entregue",
  "pronto_retirada",
] as const;

export type EventoEmail = (typeof EVENTOS_EMAIL)[number];

export type EnderecoEtiqueta = {
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
};

export type ItemEtiqueta = {
  nome: string;
  qtd: number;
  preco_unitario_centavos: number | null;
};

export type PedidoEtiqueta = {
  id: string;
  codigo: string;
  teste: boolean;
  status: string;
  entrega_tipo: string;
  cliente_nome: string;
  cliente_email: string;
  cliente_telefone: string;
  cliente_cpf: string;
  endereco: EnderecoEtiqueta | null;
  itens: ItemEtiqueta[];
  subtotal_centavos: number | null;
  frete_centavos: number | null;
  frete: { id: string; transportadora: string; servico: string } | null;
  me_order_id: string;
  me_status: string;
  rastreio: string;
};

export type Remetente = {
  name: string;
  email: string;
  phone: string;
  document: string;
  company_document: string;
  state_register: string;
  address: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state_abbr: string;
  postal_code: string;
  agency: number | null;
};

export type ClasseEtiqueta =
  | { tipo: "comprar"; custo_centavos: number; servico: number }
  | { tipo: "gerar"; me_order_id: string }
  | { tipo: "imprimir"; me_order_id: string }
  | { tipo: "conferir"; me_order_id: string }
  | { tipo: "fora"; motivo: string };

export type SituacaoCompra = "pago" | "nao_pago" | "incerto";
export type PlanoCompra = "seguir" | "remover" | "conferir";

const HOSTS_ME = new Set([
  "melhorenvio.com.br",
  "www.melhorenvio.com.br",
  "sandbox.melhorenvio.com.br",
]);

// Bucket da própria Melhor Envio (sa-east-1). Não vale qualquer host da AWS.
const HOSTS_S3 = new Set([
  "melhorenvio.s3.sa-east-1.amazonaws.com",
  "melhorenvio.s3-sa-east-1.amazonaws.com",
]);

const STATUS_PAGO_ME = new Set([
  "released",
  "generated",
  "posted",
  "delivered",
  "received",
  "undelivered",
]);
const STATUS_LIVRE_ME = new Set(["pending", "canceled", "cancelled"]);

export function soDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

export function telefoneMe(bruto: string): string | null {
  let d = soDigitos(bruto);
  if (d.startsWith("55") && d.length > 11) d = d.slice(2);
  if (d.length < 10 || d.length > 11) return null;
  return d;
}

export function idServico(freteId: string): number | null {
  if (!/^\d{1,6}$/.test(freteId.trim())) return null;
  const n = Number(freteId.trim());
  return Number.isInteger(n) && n >= 1 ? n : null;
}

export function lerRemetente(env: Record<string, string | undefined>): Remetente | null {
  const ler = (chave: string) => (env[chave] ?? "").trim();
  const nome = ler("MELHOR_ENVIO_FROM_NAME");
  const email = ler("MELHOR_ENVIO_FROM_EMAIL").toLowerCase();
  const phone = telefoneMe(ler("MELHOR_ENVIO_FROM_PHONE"));
  const postal = soDigitos(ler("MELHOR_ENVIO_FROM_POSTAL_CODE"));
  const address = ler("MELHOR_ENVIO_FROM_ADDRESS");
  const number = ler("MELHOR_ENVIO_FROM_NUMBER");
  const district = ler("MELHOR_ENVIO_FROM_DISTRICT");
  const city = ler("MELHOR_ENVIO_FROM_CITY");
  const state = ler("MELHOR_ENVIO_FROM_STATE").toUpperCase();
  const document = soDigitos(ler("MELHOR_ENVIO_FROM_DOCUMENT"));
  const company = soDigitos(ler("MELHOR_ENVIO_FROM_COMPANY_DOCUMENT"));
  const cpfOk = document.length === 11;
  const cnpjOk = company.length === 14;
  if (!nome || nome.length > 80) return null;
  if (!email.includes("@") || email.length > 120 || /\s/.test(email)) return null;
  if (!phone || postal.length !== 8) return null;
  if (!address || !number || !district || !city) return null;
  if (!/^[A-Z]{2}$/.test(state)) return null;
  if (!cpfOk && !cnpjOk) return null;
  const agencyBruto = ler("MELHOR_ENVIO_AGENCY_ID");
  const agency = /^\d{1,8}$/.test(agencyBruto) ? Number(agencyBruto) : null;
  return {
    name: nome,
    email,
    phone,
    document: cnpjOk ? "" : document,
    company_document: cnpjOk ? company : "",
    state_register: "ISENTO",
    address,
    number,
    complement: ler("MELHOR_ENVIO_FROM_COMPLEMENT").slice(0, 80),
    district,
    city,
    state_abbr: state,
    postal_code: postal,
    agency: agency && agency > 0 ? agency : null,
  };
}

function cepOk(cep: string): string | null {
  const d = soDigitos(cep);
  return d.length === 8 ? d : null;
}

export function classificarPedido(pedido: PedidoEtiqueta): ClasseEtiqueta {
  if (pedido.teste) return { tipo: "fora", motivo: "teste" };
  if (pedido.entrega_tipo !== "envio") return { tipo: "fora", motivo: "retirada" };
  const fase = (pedido.me_status || "").trim().toLowerCase();
  if (fase === "precisa_conferir" || (pedido.me_order_id && fase === "pendente")) {
    return { tipo: "conferir", me_order_id: pedido.me_order_id };
  }
  if (!pedido.me_order_id && fase === "comprando") return { tipo: "fora", motivo: "em_compra" };
  const comEtiqueta = ["etiqueta_gerada", "enviado", "entregue"];
  if (pedido.me_order_id && comEtiqueta.includes(pedido.status)) {
    return { tipo: "imprimir", me_order_id: pedido.me_order_id };
  }
  if (pedido.status !== "pago") return { tipo: "fora", motivo: "status" };
  if (pedido.me_order_id && STATUS_LIVRE_ME.has(fase)) {
    return { tipo: "conferir", me_order_id: pedido.me_order_id };
  }
  if (pedido.me_order_id) return { tipo: "gerar", me_order_id: pedido.me_order_id };
  const servico = idServico(pedido.frete?.id ?? "");
  const custo = pedido.frete_centavos;
  if (!servico || custo == null || custo < 1) return { tipo: "fora", motivo: "sem_frete" };
  if (soDigitos(pedido.cliente_cpf).length !== 11) return { tipo: "fora", motivo: "sem_cpf" };
  if (!telefoneMe(pedido.cliente_telefone)) return { tipo: "fora", motivo: "sem_telefone" };
  if (!pedido.cliente_nome.trim() || !pedido.cliente_email.includes("@")) {
    return { tipo: "fora", motivo: "sem_destino" };
  }
  const end = pedido.endereco;
  if (!end || !end.logradouro || !end.numero || !end.bairro || !end.cidade) {
    return { tipo: "fora", motivo: "sem_endereco" };
  }
  if (!/^[A-Za-z]{2}$/.test(end.uf) || !cepOk(end.cep)) return { tipo: "fora", motivo: "sem_endereco" };
  if (!pedido.itens.some((item) => item.qtd > 0)) return { tipo: "fora", motivo: "sem_itens" };
  return { tipo: "comprar", custo_centavos: custo, servico };
}

export function fecharResumo(custos: number[], saldoCentavos: number): {
  quantidade: number;
  total_centavos: number;
  saldo_centavos: number;
  falta_centavos: number;
  pode_comprar: boolean;
} {
  const total = custos.reduce((soma, n) => soma + (Number.isFinite(n) ? n : 0), 0);
  const saldo = Number.isFinite(saldoCentavos) ? Math.round(saldoCentavos) : 0;
  const falta = Math.max(0, total - saldo);
  return {
    quantidade: custos.length,
    total_centavos: total,
    saldo_centavos: saldo,
    falta_centavos: falta,
    pode_comprar: custos.length > 0 && falta === 0 && custos.every((n) => n > 0),
  };
}

export function situacaoCompraMe(status: string | null | undefined): SituacaoCompra {
  const chave = (status ?? "").trim().toLowerCase();
  if (STATUS_PAGO_ME.has(chave)) return "pago";
  if (STATUS_LIVRE_ME.has(chave)) return "nao_pago";
  return "incerto";
}

export function planoDepoisDoCheckout(situacao: SituacaoCompra): PlanoCompra {
  if (situacao === "pago") return "seguir";
  if (situacao === "nao_pago") return "remover";
  return "conferir";
}

export function podeSoltarDepoisDoDelete(
  deleteOk: boolean,
  depois: { situacao: SituacaoCompra; ausente: boolean },
): boolean {
  if (!deleteOk) return false;
  if (depois.ausente) return true;
  return depois.situacao === "nao_pago";
}

export async function tentarSoltarCarrinho(
  meId: string,
  apagar: (id: string) => Promise<boolean>,
  ler: (id: string) => Promise<{ situacao: SituacaoCompra; ausente: boolean }>,
): Promise<"soltar" | "conferir"> {
  let apagou = false;
  try {
    apagou = await apagar(meId);
  } catch (_err) {
    apagou = false;
  }
  let depois: { situacao: SituacaoCompra; ausente: boolean } = { situacao: "incerto", ausente: false };
  try {
    depois = await ler(meId);
  } catch (_err) {
    depois = { situacao: "incerto", ausente: false };
  }
  return podeSoltarDepoisDoDelete(apagou, depois) ? "soltar" : "conferir";
}

function ipUtil(bruto: string): string | null {
  const ip = bruto.trim().replace(/^\[|\]$/g, "");
  if (!ip || ip.length > 64 || ip.toLowerCase() === "unknown") return null;
  if (!/^[A-Za-z0-9.:_-]+$/.test(ip)) return null;
  return ip;
}

// O primeiro valor de x-forwarded-for é do cliente e pode ser forjado.
// cf-connecting-ip e x-real-ip vêm do proxy (Cloudflare / gateway do Supabase).
// Na cadeia, o último salto é o que o proxy acrescentou.
export function ipClienteRastreio(headers: { get(nome: string): string | null }): string {
  const cf = ipUtil(headers.get("cf-connecting-ip") ?? "");
  if (cf) return cf;
  const real = ipUtil(headers.get("x-real-ip") ?? "");
  if (real) return real;
  const cadeia = (headers.get("x-forwarded-for") ?? "").split(",");
  for (let i = cadeia.length - 1; i >= 0; i--) {
    const ip = ipUtil(cadeia[i] ?? "");
    if (ip) return ip;
  }
  return "sem-ip";
}

export function lerPedidoMe(body: unknown): {
  status: string;
  preco_centavos: number | null;
  rastreio: string;
  protocolo: string;
} | null {
  if (!body || typeof body !== "object") return null;
  const row = body as Record<string, unknown>;
  const status = typeof row.status === "string" ? row.status.trim().toLowerCase() : "";
  if (!status || status.length > 40) return null;
  const tracking = typeof row.tracking === "string" ? row.tracking : "";
  const protocolo = typeof row.protocol === "string" ? row.protocol.trim().slice(0, 40) : "";
  return {
    status,
    preco_centavos: reaisParaCentavos(row.price ?? row.custom_price),
    rastreio: tracking.replace(/[^A-Za-z0-9]/g, "").slice(0, 40),
    protocolo,
  };
}

export function precoCotado(body: unknown, servicoId: string): number | null {
  if (!Array.isArray(body)) return null;
  const id = servicoId.trim();
  if (!id) return null;
  for (const item of body) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (row.error) continue;
    if (String(row.id ?? "") !== id) continue;
    const preco = reaisParaCentavos(row.custom_price ?? row.price);
    if (preco != null && preco > 0) return preco;
  }
  return null;
}

export function saldoCentavos(body: unknown): number | null {
  if (!body || typeof body !== "object") return null;
  return reaisParaCentavos((body as { balance?: unknown }).balance);
}

function produtosDoPedido(pedido: PedidoEtiqueta): { name: string; quantity: number; unitary_value: number }[] | null {
  const itens = pedido.itens.filter((item) => item.qtd > 0 && item.nome.trim());
  if (!itens.length) return null;
  const todosTemPreco = itens.every((item) => item.preco_unitario_centavos != null && item.preco_unitario_centavos >= 0);
  if (todosTemPreco) {
    return itens.map((item) => ({
      name: item.nome.trim().slice(0, 80),
      quantity: item.qtd,
      unitary_value: Number(centavosParaReais(item.preco_unitario_centavos ?? 0)),
    }));
  }
  const qtd = itens.reduce((soma, item) => soma + item.qtd, 0);
  const subtotal = pedido.subtotal_centavos;
  if (subtotal == null || subtotal < 0 || qtd < 1) return null;
  const base = Math.floor(subtotal / qtd);
  let sobra = subtotal - base * qtd;
  const linhas: { name: string; quantity: number; unitary_value: number }[] = [];
  for (const item of itens) {
    let soma = 0;
    for (let i = 0; i < item.qtd; i++) {
      const extra = sobra > 0 ? 1 : 0;
      if (sobra > 0) sobra -= 1;
      soma += base + extra;
    }
    const unit = Math.round(soma / item.qtd);
    linhas.push({
      name: item.nome.trim().slice(0, 80),
      quantity: item.qtd,
      unitary_value: Number(centavosParaReais(unit)),
    });
  }
  return linhas;
}

export function montarCarrinho(pedido: PedidoEtiqueta, remetente: Remetente): Record<string, unknown> | null {
  const classe = classificarPedido(pedido);
  if (classe.tipo !== "comprar") return null;
  const end = pedido.endereco;
  if (!end) return null;
  const produtos = produtosDoPedido(pedido);
  if (!produtos) return null;
  const qtd = pedido.itens.reduce((soma, item) => soma + item.qtd, 0);
  const declarado = pedido.subtotal_centavos ??
    pedido.itens.reduce((soma, item) => soma + (item.preco_unitario_centavos ?? 0) * item.qtd, 0);
  if (qtd < 1 || declarado < 0) return null;
  const volumes = montarPacotes(qtd, declarado).map((pacote) => ({
    height: pacote.height,
    width: pacote.width,
    length: pacote.length,
    weight: pacote.weight,
  }));
  const insurance = produtos.reduce((soma, item) => soma + item.unitary_value * item.quantity, 0);
  const phone = telefoneMe(pedido.cliente_telefone);
  const cep = cepOk(end.cep);
  if (!phone || !cep) return null;
  const corpo: Record<string, unknown> = {
    service: classe.servico,
    from: {
      name: remetente.name,
      email: remetente.email,
      phone: remetente.phone,
      document: remetente.document,
      company_document: remetente.company_document,
      state_register: remetente.state_register,
      address: remetente.address,
      complement: remetente.complement,
      number: remetente.number,
      district: remetente.district,
      city: remetente.city,
      state_abbr: remetente.state_abbr,
      postal_code: remetente.postal_code,
      country_id: "BR",
    },
    to: {
      name: pedido.cliente_nome.trim().slice(0, 80),
      email: pedido.cliente_email.trim().toLowerCase(),
      phone,
      document: soDigitos(pedido.cliente_cpf),
      state_register: "ISENTO",
      address: end.logradouro.slice(0, 80),
      complement: (end.complemento || "").slice(0, 80),
      number: end.numero.slice(0, 20),
      district: end.bairro.slice(0, 80),
      city: end.cidade.slice(0, 80),
      state_abbr: end.uf.toUpperCase(),
      postal_code: cep,
      country_id: "BR",
    },
    products: produtos,
    volumes,
    options: {
      platform: "Foveō Ateliê",
      reminder: ("Pedido " + pedido.codigo).slice(0, 80),
      insurance_value: Math.round(insurance * 100) / 100,
      receipt: false,
      own_hand: false,
      reverse: false,
      tags: [{ tag: pedido.codigo || pedido.id, url: null }],
    },
  };
  if (remetente.agency) corpo.agency = remetente.agency;
  return corpo;
}

export function lerCarrinho(body: unknown): { id: string; protocolo: string; preco_centavos: number | null; rastreio: string } | null {
  if (!body || typeof body !== "object") return null;
  const row = body as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) return null;
  const protocolo = typeof row.protocol === "string" ? row.protocol.trim().slice(0, 40) : "";
  const preco = reaisParaCentavos(row.price ?? row.custom_price);
  const bruto = typeof row.tracking === "string" ? row.tracking : "";
  return { id, protocolo, preco_centavos: preco, rastreio: bruto.replace(/[^A-Za-z0-9]/g, "").slice(0, 40) };
}

export function lerRastreioGerado(body: unknown, ids: string[]): Map<string, string> {
  const mapa = new Map<string, string>();
  if (!body || typeof body !== "object") return mapa;
  const row = body as Record<string, unknown>;
  for (const id of ids) {
    const item = row[id];
    let bruto = "";
    if (typeof item === "string") bruto = item;
    else if (item && typeof item === "object") {
      const tracking = (item as { tracking?: unknown }).tracking;
      if (typeof tracking === "string") bruto = tracking;
    }
    const code = bruto.replace(/[^A-Za-z0-9]/g, "").slice(0, 40);
    if (code.length >= 4) mapa.set(id, code);
  }
  return mapa;
}

export type PlanoImpressao =
  | { metodo: "POST"; caminho: "/api/v2/me/shipment/print"; corpo: { mode: "public"; orders: string[] }; fallback: null }
  | { metodo: "GET"; caminho: string; fallback: "print" };

export function planoImpressao(formato: string, ids: string[]): PlanoImpressao | null {
  const limpos = ids.map((id) => id.trim()).filter((id) => /^[A-Za-z0-9-]{8,64}$/.test(id));
  if (!limpos.length || limpos.length > 40) return null;
  if (formato === "a4") {
    return {
      metodo: "POST",
      caminho: "/api/v2/me/shipment/print",
      corpo: { mode: "public", orders: limpos },
      fallback: null,
    };
  }
  if (formato === "termica") {
    return {
      metodo: "GET",
      caminho: "/api/v2/me/imprimir/pdf/" + limpos.join(","),
      fallback: "print",
    };
  }
  return null;
}

export function planoFolha(ids: string[]): PlanoImpressao | null {
  return planoImpressao("a4", ids);
}

export function urlMelhorEnvioConfiavel(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch (_err) {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  const host = parsed.hostname.toLowerCase();
  if (HOSTS_ME.has(host) || host.endsWith(".melhorenvio.com.br")) return parsed.toString();
  if (HOSTS_S3.has(host)) return parsed.toString();
  return null;
}

export function lerUrlImpressao(body: unknown): string | null {
  if (typeof body === "string") {
    const texto = body.trim().replace(/^"|"$/g, "");
    return urlMelhorEnvioConfiavel(texto);
  }
  if (body && typeof body === "object" && typeof (body as { url?: unknown }).url === "string") {
    return urlMelhorEnvioConfiavel((body as { url: string }).url);
  }
  return null;
}

export type EventoMe = {
  evento: string;
  id: string;
  status: string;
  rastreio: string;
  protocolo: string;
};

export function lerEventoMe(corpo: unknown): EventoMe | null {
  if (!corpo || typeof corpo !== "object") return null;
  const row = corpo as Record<string, unknown>;
  const evento = typeof row.event === "string" ? row.event.trim().toLowerCase() : "";
  const data = row.data && typeof row.data === "object" ? row.data as Record<string, unknown> : null;
  if (!evento || !data) return null;
  const id = typeof data.id === "string" ? data.id.trim() : "";
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) return null;
  const tracking = typeof data.tracking === "string" ? data.tracking : "";
  const selfTracking = typeof data.self_tracking === "string" ? data.self_tracking : "";
  const protocolo = typeof data.protocol === "string" ? data.protocol.trim().slice(0, 40) : "";
  const status = typeof data.status === "string" ? data.status.trim().toLowerCase().slice(0, 40) : "";
  return {
    evento,
    id,
    status,
    protocolo,
    rastreio: (tracking || selfTracking).replace(/[^A-Za-z0-9]/g, "").slice(0, 40),
  };
}

export function emailDoEvento(evento: string): "enviado" | "entregue" | null {
  if (evento === "order.posted") return "enviado";
  if (evento === "order.delivered") return "entregue";
  return null;
}

function bytesIguais(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function assinaturaMelhorEnvio(
  secret: string,
  corpo: string,
  header: string | null,
): Promise<boolean> {
  const chave = secret.trim();
  if (!chave || !header) return false;
  const recebido = header.trim().replace(/^sha256=/i, "");
  if (!recebido || recebido.length > 200) return false;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(chave),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(corpo)),
  );
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  const b64 = btoa(String.fromCharCode(...mac));
  const candidatos = [b64, hex];
  const alvo = new TextEncoder().encode(recebido);
  for (const candidato of candidatos) {
    const bytes = new TextEncoder().encode(candidato);
    if (bytesIguais(bytes, alvo)) return true;
  }
  return false;
}

export function linkRastreio(transportadora: string, codigo: string): string | null {
  const code = codigo.replace(/[^A-Za-z0-9]/g, "");
  if (code.length < 4 || code.length > 40) return null;
  const nome = transportadora.toLowerCase();
  if (nome.includes("correio")) {
    return "https://rastreamento.correios.com.br/app/index.php?objetos=" + code;
  }
  if (nome.includes("jadlog")) return "https://www.jadlog.com.br/tracking?cte=" + code;
  if (nome.includes("azul")) {
    return "https://www.azulcargoexpress.com.br/Rastreio/Rastreio/Rastrear?codigo=" + code;
  }
  if (nome.includes("loggi")) return "https://www.loggi.com/rastreador/" + code;
  if (nome.includes("latam")) return "https://www.latamcargo.com/en/track-shipment?trackingNumber=" + code;
  if (nome.includes("j&t") || nome.includes("jet")) {
    return "https://www.jtexpress.com.br/trajectoryQuery?waybillNo=" + code;
  }
  return "https://www.melhorrastreio.com.br/rastreio/" + code;
}

export function credencialRastreio(
  codigo: string,
  email: string,
  cpf: string,
): { codigo: string; email: string; cpf: string } | null {
  const cod = codigo.trim();
  if (!/^\d{9}$/.test(cod)) return null;
  const mail = email.trim().toLowerCase();
  const doc = soDigitos(cpf);
  const temEmail = mail.includes("@") && mail.length <= 120 && !/\s/.test(mail) && mail.includes(".");
  const temCpf = doc.length === 11;
  if (!temEmail && !temCpf) return null;
  return { codigo: cod, email: temEmail ? mail : "", cpf: temCpf ? doc : "" };
}

export function combinaRastreio(
  credencial: { email: string; cpf: string },
  emailPedido: string,
  cpfPedido: string,
): boolean {
  const mailOk = credencial.email !== "" &&
    credencial.email === emailPedido.trim().toLowerCase();
  const cpfOk = credencial.cpf !== "" && credencial.cpf === soDigitos(cpfPedido);
  if (credencial.email && credencial.cpf) return mailOk && cpfOk;
  return mailOk || cpfOk;
}

const STATUS_PUBLICOS = new Set([
  "pendente",
  "pago",
  "etiqueta_gerada",
  "enviado",
  "entregue",
  "pronto_retirada",
  "retirado",
  "expirado",
  "recusado",
  "cancelado",
  "reembolsado",
]);

export function statusPublico(status: string): string {
  const chave = status.trim().toLowerCase();
  return STATUS_PUBLICOS.has(chave) ? chave : "pendente";
}

export type PassoRastreio = { status: string; em: string };

export function linhaDoTempo(linhas: { status: string; created_at: string }[]): PassoRastreio[] {
  const saida: PassoRastreio[] = [];
  for (const linha of linhas) {
    const status = typeof linha.status === "string" ? linha.status.trim().toLowerCase() : "";
    if (!STATUS_PUBLICOS.has(status)) continue;
    const em = typeof linha.created_at === "string" ? linha.created_at : "";
    if (saida.length && saida[saida.length - 1].status === status) continue;
    saida.push({ status, em });
  }
  return saida;
}
