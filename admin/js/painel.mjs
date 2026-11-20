export const EMAIL_ADMIN = "contato@foveoatelie.com.br";
export const CHAVE_SESSAO = "foveo.admin.sessao";
export const CHAVE_DEPOIS = "foveo.admin.depois";
export const CHAVE_MOSTRAR_TESTES = "foveo.admin.mostrar_testes";
export const CHAVE_RAIL = "foveo.admin.rail";
export const RAIL_AUTO = "auto";
export const RAIL_ABERTO = "aberto";
export const RAIL_RECOLHIDO = "recolhido";

export const ROTAS = {
  "/": "inicio",
  "/entrar": "entrar",
  "/pedidos": "pedidos",
  "/estoque": "estoque",
  "/clientes": "clientes",
  "/avisos": "avisos",
};

export const ROTULOS_AVISO = {
  estoque_baixo: "Estoque baixo",
  saldo_baixo: "Saldo do frete",
  problema_entrega: "Problema na entrega",
  token_melhor_envio: "Token do Melhor Envio",
};

/** Status gravados no banco. `pendente` aparece como Aguardando pagamento. */
export const STATUS = {
  pendente: "Aguardando pagamento",
  pago: "Pago",
  etiqueta_gerada: "Etiqueta gerada",
  enviado: "Enviado",
  entregue: "Entregue",
  pronto_retirada: "Pronto para retirada",
  retirado: "Retirado",
  expirado: "Expirado",
  recusado: "Recusado",
  cancelado: "Cancelado",
  reembolsado: "Reembolsado",
};

export const STATUS_ENVIO = [
  "pendente",
  "pago",
  "etiqueta_gerada",
  "enviado",
  "entregue",
];

export const STATUS_RETIRADA = [
  "pendente",
  "pago",
  "pronto_retirada",
  "retirado",
];

export const STATUS_FORA = ["cancelado", "reembolsado", "expirado", "recusado"];

/** Pago e ainda não reembolsado nem cancelado. Etiqueta e retirada pronta contam: o dinheiro já entrou. */
export const STATUS_VENDA = [
  "pago",
  "etiqueta_gerada",
  "enviado",
  "entregue",
  "pronto_retirada",
  "retirado",
];

/** Pago, e o envio ou a retirada ainda não aconteceu. */
export const STATUS_AGUARDANDO_SAIDA = ["pago", "etiqueta_gerada", "pronto_retirada"];

export const METRICA_REAIS = "reais";
export const METRICA_PEDIDOS = "pedidos";
export const METRICA_VELAS = "velas";
export const LIMITE_DIAS_GRAFICO = 120;
export const ESTOQUE_BAIXO = 3;
export const COLECAO_PADRAO = "Coleção 2026";

const FUSO = "America/Sao_Paulo";
const DIAS_SEMANA = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const FOLGA_MS = 60_000;

export const SELECT_PEDIDOS = [
  "id",
  "codigo",
  "created_at",
  "cliente_nome",
  "cliente_email",
  "cliente_telefone",
  "cliente_cpf",
  "itens",
  "entrega_tipo",
  "endereco",
  "frete",
  "frete_centavos",
  "subtotal_centavos",
  "desconto_centavos",
  "total_centavos",
  "status",
  "teste",
  "forma_pagamento",
  "mp_taxa_centavos",
  "mp_liquido_centavos",
  "mp_liberacao_em",
  "notas_internas",
  "mp_order_id",
  "mp_payment_id",
  "pago_em",
  "me_order_id",
  "me_protocolo",
  "rastreio",
  "me_status",
  "me_preco_centavos",
  "etiqueta_em",
].join(",");

export function emailEhAdmin(email) {
  return String(email || "").trim().toLowerCase() === EMAIL_ADMIN;
}

export function normalizarCaminho(pathname) {
  const bruto = typeof pathname === "string" ? pathname : "/";
  if (bruto.length > 1 && bruto.endsWith("/")) return bruto.slice(0, -1);
  return bruto || "/";
}

export function caminhoDepois(valor) {
  const caminho = normalizarCaminho(typeof valor === "string" ? valor : "/");
  if (!ROTAS[caminho] || caminho === "/entrar") return "/";
  return caminho;
}

export function tituloDaRota(caminho) {
  const nomes = {
    "/": "Início",
    "/entrar": "Entrar",
    "/pedidos": "Pedidos",
    "/estoque": "Estoque",
    "/clientes": "Clientes",
    "/avisos": "Avisos",
  };
  const nome = nomes[normalizarCaminho(caminho)];
  return nome ? nome + " — Foveō Ateliê" : "Foveō Ateliê";
}

export function formatarPreco(centavos) {
  if (centavos == null || centavos === "") return "—";
  const n = typeof centavos === "number" ? centavos : Number(centavos);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(n / 100);
}

export function formatarData(valor) {
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return null;
  const texto = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(data);
  return { texto, iso: data.toISOString() };
}

export function formatarDataCurta(valor) {
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return null;
  const texto = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(data);
  return { texto, iso: data.toISOString() };
}

export function rotuloStatus(status) {
  if (typeof status !== "string") return "—";
  return STATUS[status.trim().toLowerCase()] || "—";
}

/** Origens gravadas no histórico → texto curto em português. */
const ORIGENS = {
  mercado_pago: "Mercado Pago",
  webhook: "Mercado Pago",
  checkout: "Checkout",
  admin: "Ajuste manual",
  manual: "Ajuste manual",
  sistema: "Sistema",
  reembolso: "Reembolso",
  mp_ja_reembolsado: "Mercado Pago (já reembolsado)",
  melhor_envio: "Melhor Envio",
};

export function rotuloOrigem(origem) {
  if (typeof origem !== "string") return "";
  const chave = origem.trim().toLowerCase();
  if (!chave) return "";
  if (ORIGENS[chave]) return ORIGENS[chave];
  return chave
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((parte) => parte.charAt(0).toUpperCase() + parte.slice(1))
    .join(" ");
}

export function nivelStatus(status) {
  const chave = typeof status === "string" ? status.trim().toLowerCase() : "";
  if (
    chave === "pago" ||
    chave === "etiqueta_gerada" ||
    chave === "enviado" ||
    chave === "entregue" ||
    chave === "pronto_retirada" ||
    chave === "retirado"
  ) {
    return "ok";
  }
  if (chave === "pendente") return "espera";
  if (
    chave === "expirado" ||
    chave === "recusado" ||
    chave === "cancelado" ||
    chave === "reembolsado"
  ) {
    return "para";
  }
  return "neutro";
}

export function opcoesStatus(entregaTipo) {
  const fora = STATUS_FORA.slice();
  if (entregaTipo === "retirada") {
    return [...STATUS_RETIRADA, ...fora.filter((s) => !STATUS_RETIRADA.includes(s))];
  }
  return [...STATUS_ENVIO, ...fora.filter((s) => !STATUS_ENVIO.includes(s))];
}

function centavosOuNulo(valor) {
  if (typeof valor === "number" && Number.isFinite(valor)) return Math.round(valor);
  if (typeof valor === "string" && /^-?\d+$/.test(valor)) return Number(valor);
  return null;
}

function textoOuVazio(valor) {
  return typeof valor === "string" ? valor.trim() : "";
}

function normalizarItens(bruto) {
  if (!Array.isArray(bruto)) return [];
  return bruto.map((item) => {
    if (!item || typeof item !== "object") return null;
    const nome = textoOuVazio(item.nome) || textoOuVazio(item.produto_id) || "Vela";
    const qtd = centavosOuNulo(item.qtd);
    const preco = centavosOuNulo(item.preco_unitario_centavos);
    return {
      produto_id: textoOuVazio(item.produto_id),
      nome,
      qtd: qtd != null && qtd > 0 ? qtd : 0,
      preco_unitario_centavos: preco,
    };
  }).filter((item) => item && item.qtd > 0);
}

function normalizarEndereco(bruto) {
  if (!bruto || typeof bruto !== "object") return null;
  return {
    logradouro: textoOuVazio(bruto.logradouro),
    numero: textoOuVazio(bruto.numero),
    complemento: textoOuVazio(bruto.complemento),
    bairro: textoOuVazio(bruto.bairro),
    cidade: textoOuVazio(bruto.cidade),
    uf: textoOuVazio(bruto.uf).toUpperCase(),
    cep: textoOuVazio(bruto.cep),
  };
}

function normalizarFrete(bruto) {
  if (!bruto || typeof bruto !== "object") return null;
  return {
    id: textoOuVazio(bruto.id),
    transportadora: textoOuVazio(bruto.transportadora),
    servico: textoOuVazio(bruto.servico),
    preco_centavos: centavosOuNulo(bruto.preco_centavos),
    prazo_dias: centavosOuNulo(bruto.prazo_dias),
  };
}

export function normalizarPedido(row) {
  if (!row || typeof row !== "object") return null;
  const endereco = normalizarEndereco(row.endereco);
  const frete = normalizarFrete(row.frete);
  return {
    id: typeof row.id === "string" ? row.id : "",
    codigo: typeof row.codigo === "string" ? row.codigo : "",
    created_at: typeof row.created_at === "string" ? row.created_at : "",
    cliente_nome: textoOuVazio(row.cliente_nome),
    cliente_email: textoOuVazio(row.cliente_email).toLowerCase(),
    cliente_telefone: textoOuVazio(row.cliente_telefone),
    cliente_cpf: textoOuVazio(row.cliente_cpf),
    itens: normalizarItens(row.itens),
    entrega_tipo: row.entrega_tipo === "retirada" ? "retirada" : "envio",
    endereco,
    frete,
    frete_centavos: centavosOuNulo(row.frete_centavos),
    subtotal_centavos: centavosOuNulo(row.subtotal_centavos),
    desconto_centavos: centavosOuNulo(row.desconto_centavos),
    total_centavos: centavosOuNulo(row.total_centavos),
    status: typeof row.status === "string" ? row.status : "",
    teste: row.teste === true,
    forma_pagamento: textoOuVazio(row.forma_pagamento),
    mp_taxa_centavos: centavosOuNulo(row.mp_taxa_centavos),
    mp_liquido_centavos: centavosOuNulo(row.mp_liquido_centavos),
    mp_liberacao_em: typeof row.mp_liberacao_em === "string" ? row.mp_liberacao_em : "",
    notas_internas: typeof row.notas_internas === "string" ? row.notas_internas : "",
    mp_order_id: textoOuVazio(row.mp_order_id),
    mp_payment_id: textoOuVazio(row.mp_payment_id),
    pago_em: typeof row.pago_em === "string" ? row.pago_em : "",
    me_order_id: textoOuVazio(row.me_order_id),
    me_protocolo: textoOuVazio(row.me_protocolo),
    rastreio: textoOuVazio(row.rastreio).replace(/[^A-Za-z0-9]/g, ""),
    me_status: textoOuVazio(row.me_status).toLowerCase(),
    me_preco_centavos: centavosOuNulo(row.me_preco_centavos),
    etiqueta_em: typeof row.etiqueta_em === "string" ? row.etiqueta_em : "",
  };
}

export function normalizarHistorico(row) {
  if (!row || typeof row !== "object") return null;
  return {
    id: typeof row.id === "string" ? row.id : "",
    pedido_id: typeof row.pedido_id === "string" ? row.pedido_id : "",
    status: typeof row.status === "string" ? row.status : "",
    origem: typeof row.origem === "string" ? row.origem : "",
    created_at: typeof row.created_at === "string" ? row.created_at : "",
  };
}

export function resumoPedidos(linhas) {
  const n = linhas.length;
  const testes = linhas.filter((linha) => linha.teste).length;
  const pedidos = n === 1 ? "1 pedido" : n + " pedidos";
  if (!testes) return pedidos + ".";
  const marca = testes === 1 ? "1 de teste" : testes + " de teste";
  return pedidos + ", " + marca + ".";
}

export function formatarVelas(itens) {
  if (!Array.isArray(itens) || !itens.length) return "—";
  return itens.map((item) => {
    const nome = item.nome || "Vela";
    return item.qtd > 1 ? item.qtd + "× " + nome : nome;
  }).join(", ");
}

export function formatarCidadeUf(endereco) {
  if (!endereco) return "";
  const cidade = endereco.cidade || "";
  const uf = endereco.uf || "";
  if (cidade && uf) return cidade + "/" + uf;
  return cidade || uf || "";
}

export function rotuloEntrega(pedido) {
  if (!pedido) return "—";
  if (pedido.entrega_tipo === "retirada") return "Retirada";
  const lugar = formatarCidadeUf(pedido.endereco);
  return lugar ? "Envio · " + lugar : "Envio";
}

export function formatarEnderecoCompleto(endereco) {
  if (!endereco) return "";
  const linha1 = [endereco.logradouro, endereco.numero].filter(Boolean).join(", ");
  const partes = [
    linha1,
    endereco.complemento,
    endereco.bairro,
    formatarCidadeUf(endereco),
    endereco.cep ? formatarCep(endereco.cep) : "",
  ].filter(Boolean);
  return partes.join(" · ");
}

export function formatarCep(cep) {
  const digitos = String(cep || "").replace(/\D/g, "");
  if (digitos.length !== 8) return String(cep || "");
  return digitos.slice(0, 5) + "-" + digitos.slice(5);
}

export function formatarCpf(cpf) {
  const digitos = String(cpf || "").replace(/\D/g, "");
  if (digitos.length !== 11) return digitos || "—";
  return digitos.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

export function formatarTelefone(telefone) {
  const digitos = String(telefone || "").replace(/\D/g, "");
  if (!digitos) return "";
  let local = digitos;
  if (local.startsWith("55") && local.length >= 12) local = local.slice(2);
  if (local.length === 11) {
    return "(" + local.slice(0, 2) + ") " + local.slice(2, 7) + "-" + local.slice(7);
  }
  if (local.length === 10) {
    return "(" + local.slice(0, 2) + ") " + local.slice(2, 6) + "-" + local.slice(6);
  }
  return "";
}

export function telefoneParaWa(telefone) {
  const digitos = String(telefone || "").replace(/\D/g, "");
  if (!digitos) return "";
  if (digitos.startsWith("55") && digitos.length >= 12) return digitos;
  if (digitos.length >= 10 && digitos.length <= 11) return "55" + digitos;
  return "";
}

export function linkRastreio(transportadora, codigo) {
  const code = String(codigo || "").replace(/[^A-Za-z0-9]/g, "");
  if (code.length < 4 || code.length > 40) return "";
  const nome = String(transportadora || "").toLowerCase();
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

const ROTULO_ME = {
  pending: "No carrinho",
  pendente: "No carrinho",
  comprando: "Compra em andamento",
  precisa_conferir: "Precisa conferir",
  released: "Paga",
  generated: "Gerada",
  posted: "Postada",
  delivered: "Entregue",
  canceled: "Cancelada",
  cancelled: "Cancelada",
  undelivered: "Não entregue",
};

export function rotuloMeStatus(status) {
  const chave = typeof status === "string" ? status.trim().toLowerCase() : "";
  if (!chave) return "";
  return ROTULO_ME[chave] || chave;
}

export function precisaConferirEtiqueta(pedido) {
  if (!pedido || pedido.teste || pedido.entrega_tipo !== "envio") return false;
  const fase = typeof pedido.me_status === "string" ? pedido.me_status.trim().toLowerCase() : "";
  if (fase === "precisa_conferir") return true;
  return fase === "pendente" && Boolean(pedido.me_order_id) && pedido.status === "pago" && !pedido.rastreio;
}

export function podeGerarEtiqueta(pedido) {
  if (!pedido || pedido.teste || pedido.entrega_tipo !== "envio") return false;
  if (pedido.status !== "pago") return false;
  if (pedido.me_order_id && pedido.rastreio) return false;
  if (precisaConferirEtiqueta(pedido)) return false;
  const fase = typeof pedido.me_status === "string" ? pedido.me_status.trim().toLowerCase() : "";
  if (fase === "comprando") return false;
  return true;
}

export function podeImprimirEtiqueta(pedido) {
  if (!pedido || pedido.teste || !pedido.me_order_id) return false;
  if (precisaConferirEtiqueta(pedido)) return false;
  return ["pago", "etiqueta_gerada", "enviado", "entregue"].includes(pedido.status);
}

export function resumoEtiquetas(entrada) {
  const qtd = entrada && Number.isFinite(entrada.quantidade) ? entrada.quantidade : 0;
  const gerar = entrada && Number.isFinite(entrada.gerar) ? entrada.gerar : 0;
  const falta = entrada && Number.isFinite(entrada.falta_centavos) ? entrada.falta_centavos : 0;
  const total = entrada && Number.isFinite(entrada.total_centavos) ? entrada.total_centavos : 0;
  const saldo = entrada && Number.isFinite(entrada.saldo_centavos) ? entrada.saldo_centavos : 0;
  let frase = "Nenhum pedido pago de envio está sem etiqueta.";
  if (qtd === 1 && gerar === 0) frase = "1 pedido de envio, pago, sem etiqueta.";
  else if (qtd > 1 && gerar === 0) frase = qtd + " pedidos de envio, pagos, sem etiqueta.";
  else if (qtd === 0 && gerar === 1) frase = "1 etiqueta já foi paga. Falta gerar o rastreio.";
  else if (qtd === 0 && gerar > 1) frase = gerar + " etiquetas já foram pagas. Falta gerar o rastreio.";
  else if (qtd > 0 && gerar > 0) {
    frase = qtd + (qtd === 1 ? " pedido novo" : " pedidos novos") + " e " + gerar + " já " + (gerar === 1 ? "pago" : "pagos") + ".";
  }
  return {
    frase,
    custo: formatarPreco(total),
    saldo: formatarPreco(saldo),
    falta: falta > 0 ? formatarPreco(falta) : "",
    podeComprar: Boolean(entrada && entrada.pode_comprar) && falta === 0 && (qtd > 0 || gerar > 0),
  };
}

export function linkWhatsApp(telefone) {
  const wa = telefoneParaWa(telefone);
  return wa ? "https://wa.me/" + wa : "";
}

export function filtrosVazios() {
  return {
    status: "",
    de: "",
    ate: "",
    entrega: "todos",
    busca: "",
    mostrarTestes: true,
  };
}

export function lerMostrarTestes(storage) {
  try {
    const bruto = storage.getItem(CHAVE_MOSTRAR_TESTES);
    if (bruto == null) return true;
    return bruto !== "0";
  } catch (_err) {
    return true;
  }
}

export function gravarMostrarTestes(storage, valor) {
  try {
    storage.setItem(CHAVE_MOSTRAR_TESTES, valor ? "1" : "0");
  } catch (_err) {
    // Sessão privada pode recusar.
  }
}

export function lerRail(storage) {
  try {
    const bruto = storage.getItem(CHAVE_RAIL);
    if (bruto === RAIL_ABERTO || bruto === RAIL_RECOLHIDO) return bruto;
    return RAIL_AUTO;
  } catch (_err) {
    return RAIL_AUTO;
  }
}

export function gravarRail(storage, valor) {
  try {
    if (valor === RAIL_ABERTO || valor === RAIL_RECOLHIDO) {
      storage.setItem(CHAVE_RAIL, valor);
    } else {
      storage.setItem(CHAVE_RAIL, RAIL_AUTO);
    }
  } catch (_err) {
    // Sessão privada pode recusar.
  }
}

/** Ciclo: auto → aberto → recolhido → auto. */
export function proximoRail(atual) {
  if (atual === RAIL_ABERTO) return RAIL_RECOLHIDO;
  if (atual === RAIL_RECOLHIDO) return RAIL_AUTO;
  return RAIL_ABERTO;
}

export function rotuloRail(estado) {
  if (estado === RAIL_ABERTO) return "Menu fixado aberto";
  if (estado === RAIL_RECOLHIDO) return "Menu fixado recolhido";
  return "Fixar menu";
}

export function diaSp(valor) {
  const data = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(data.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(data);
}

function diaEmBrasilia(iso) {
  return diaSp(iso);
}

export function somarDias(iso, n) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const [ano, mes, dia] = iso.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia + n));
  const yy = data.getUTCFullYear();
  const mm = String(data.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(data.getUTCDate()).padStart(2, "0");
  return yy + "-" + mm + "-" + dd;
}

function indiceSemana(iso) {
  const [ano, mes, dia] = iso.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia, 15, 0, 0));
  const nome = new Intl.DateTimeFormat("en-US", {
    timeZone: FUSO,
    weekday: "short",
  }).format(data);
  const indice = DIAS_SEMANA.indexOf(nome);
  return indice < 0 ? 0 : indice;
}

export function mesAtualSp(agora) {
  const dia = diaSp(agora instanceof Date ? agora : new Date(agora));
  const [ano, mes] = dia.split("-").map(Number);
  return { ano, mes };
}

export function periodoMes(ano, mes) {
  const mm = String(mes).padStart(2, "0");
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return {
    de: ano + "-" + mm + "-01",
    ate: ano + "-" + mm + "-" + String(ultimo).padStart(2, "0"),
  };
}

export function deslocarMes(ano, mes, delta) {
  const data = new Date(Date.UTC(ano, mes - 1 + delta, 1));
  return { ano: data.getUTCFullYear(), mes: data.getUTCMonth() + 1 };
}

export function podeAvancarMes(ano, mes, agora) {
  const atual = mesAtualSp(agora);
  if (ano > atual.ano) return false;
  if (ano === atual.ano && mes >= atual.mes) return false;
  return true;
}

export function semanaQueContem(diaIso) {
  const de = somarDias(diaIso, -indiceSemana(diaIso));
  return { de, ate: somarDias(de, 6) };
}

export function listarDias(de, ate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate)) return [];
  if (de > ate) return [];
  const dias = [];
  let cursor = de;
  while (cursor && cursor <= ate) {
    if (dias.length >= LIMITE_DIAS_GRAFICO) return [];
    dias.push(cursor);
    cursor = somarDias(cursor, 1);
  }
  return dias;
}

export function validarPeriodo(de, ate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(de || "") || !/^\d{4}-\d{2}-\d{2}$/.test(ate || "")) {
    return "Informe o começo e o fim do período.";
  }
  if (de > ate) return "A data inicial precisa ser antes da final.";
  const dias = listarDias(de, ate);
  if (!dias.length) return "Escolha no máximo " + LIMITE_DIAS_GRAFICO + " dias.";
  return "";
}

export function rotuloMes(ano, mes) {
  const data = new Date(Date.UTC(ano, mes - 1, 1, 15, 0, 0));
  const texto = new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO,
    month: "long",
    year: "numeric",
  }).format(data);
  return texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : "";
}

export function rotuloDia(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return "";
  const [ano, mes, dia] = iso.split("-");
  return dia + "/" + mes + (ano ? "/" + ano : "");
}

export function pedidoContaVenda(pedido) {
  if (!pedido || pedido.teste) return false;
  return STATUS_VENDA.includes(pedido.status);
}

function dataVenda(pedido) {
  if (pedido.pago_em && diaSp(pedido.pago_em)) return pedido.pago_em;
  return pedido.created_at;
}

function qtdVelasPedido(pedido) {
  return (pedido.itens || []).reduce((soma, item) => soma + (item.qtd || 0), 0);
}

export function resumoInicio(pedidos, agora) {
  const agoraData = agora instanceof Date ? agora : new Date(agora);
  const hoje = diaSp(agoraData);
  const atual = mesAtualSp(agoraData);
  const mes = periodoMes(atual.ano, atual.mes);
  const semana = semanaQueContem(hoje);
  const agoraMs = agoraData.getTime();
  const resumo = {
    aguardandoEnvio: 0,
    aguardandoPagamento: 0,
    vendasSemanaCentavos: 0,
    vendasMesCentavos: 0,
    aLiberarCentavos: 0,
    pagosSemLiquido: 0,
  };
  for (const pedido of pedidos || []) {
    if (!pedido || pedido.teste) continue;
    if (pedido.status === "pendente") resumo.aguardandoPagamento += 1;
    if (STATUS_AGUARDANDO_SAIDA.includes(pedido.status)) resumo.aguardandoEnvio += 1;
    if (!pedidoContaVenda(pedido)) continue;
    const dia = diaSp(dataVenda(pedido));
    const total = pedido.total_centavos || 0;
    if (dia >= semana.de && dia <= semana.ate) resumo.vendasSemanaCentavos += total;
    if (dia >= mes.de && dia <= mes.ate) resumo.vendasMesCentavos += total;
    if (!pedido.mp_liberacao_em) continue;
    const liberacao = new Date(pedido.mp_liberacao_em).getTime();
    if (Number.isNaN(liberacao) || liberacao <= agoraMs) continue;
    if (pedido.mp_liquido_centavos == null) resumo.pagosSemLiquido += 1;
    else resumo.aLiberarCentavos += pedido.mp_liquido_centavos;
  }
  return resumo;
}

export function serieVendas(pedidos, de, ate, metrica) {
  const dias = listarDias(de, ate);
  const valores = new Map(dias.map((dia) => [dia, 0]));
  const reais = new Map(dias.map((dia) => [dia, 0]));
  const modo = metrica === METRICA_PEDIDOS || metrica === METRICA_VELAS ? metrica : METRICA_REAIS;
  for (const pedido of pedidos || []) {
    if (!pedidoContaVenda(pedido)) continue;
    const dia = diaSp(dataVenda(pedido));
    if (!valores.has(dia)) continue;
    reais.set(dia, reais.get(dia) + (pedido.total_centavos || 0));
    let parcela = pedido.total_centavos || 0;
    if (modo === METRICA_PEDIDOS) parcela = 1;
    if (modo === METRICA_VELAS) parcela = qtdVelasPedido(pedido);
    valores.set(dia, valores.get(dia) + parcela);
  }
  let acumulado = 0;
  const pontos = dias.map((dia) => {
    const doDia = reais.get(dia);
    acumulado += doDia;
    return {
      dia,
      valor: valores.get(dia),
      reais: doDia,
      acumulado,
    };
  });
  return { de, ate, metrica: modo, pontos, totalReais: acumulado };
}

export function descreverPonto(ponto, metrica) {
  if (!ponto) return "";
  const dia = rotuloDia(ponto.dia);
  if (metrica === METRICA_PEDIDOS) {
    const n = ponto.valor || 0;
    return dia + " · " + n + (n === 1 ? " pedido" : " pedidos");
  }
  if (metrica === METRICA_VELAS) {
    const n = ponto.valor || 0;
    return dia + " · " + n + (n === 1 ? " vela" : " velas");
  }
  return dia + " · " + formatarPreco(ponto.valor || 0);
}

export function juntarEstoque(produtos, linhas) {
  const porId = new Map();
  for (const linha of linhas || []) {
    if (linha && linha.produto_id) porId.set(linha.produto_id, linha);
  }
  return (produtos || []).map((produto) => {
    const estoque = porId.get(produto && produto.id) || {};
    const disponivel = centavosOuNulo(estoque.disponivel);
    const reservado = centavosOuNulo(estoque.reservado);
    const ordem = centavosOuNulo(produto && produto.ordem);
    return {
      id: produto && typeof produto.id === "string" ? produto.id : "",
      nome: textoOuVazio(produto && produto.nome) || (produto && produto.id) || "Vela",
      colecao: textoOuVazio(produto && produto.colecao) || COLECAO_PADRAO,
      ordem: ordem == null ? 0 : ordem,
      ativo: !produto || produto.ativo !== false,
      disponivel: disponivel == null ? 0 : disponivel,
      reservado: reservado == null ? 0 : reservado,
      temLinha: Boolean(estoque && estoque.produto_id),
    };
  }).filter((vela) => vela.id);
}

export function agruparEstoque(velas) {
  const ordenadas = (velas || []).slice().sort((a, b) => {
    const colecao = a.colecao.localeCompare(b.colecao, "pt-BR");
    if (colecao) return colecao;
    if (a.ordem !== b.ordem) return a.ordem - b.ordem;
    return a.nome.localeCompare(b.nome, "pt-BR");
  });
  const grupos = [];
  for (const vela of ordenadas) {
    const ultimo = grupos[grupos.length - 1];
    const item = { ...vela, baixo: vela.disponivel < ESTOQUE_BAIXO };
    if (!ultimo || ultimo.colecao !== vela.colecao) {
      grupos.push({ colecao: vela.colecao, itens: [item] });
    } else {
      ultimo.itens.push(item);
    }
  }
  return grupos;
}

export function rotuloDisponivel(n) {
  const qtd = Number(n) || 0;
  return qtd === 1 ? "1 disponível" : qtd + " disponíveis";
}

export function rotuloReservado(n) {
  const qtd = Number(n) || 0;
  if (qtd === 1) return "1 reservada";
  return qtd + " reservadas";
}

const TIPOS_MOVIMENTO = {
  producao: "Entrada de produção",
  ajuste: "Ajuste manual",
  venda: "Venda",
  devolucao: "Devolução",
  reserva: "Reserva",
  liberacao: "Liberação",
};

export function rotuloMovimento(tipo) {
  if (typeof tipo !== "string") return "—";
  return TIPOS_MOVIMENTO[tipo.trim().toLowerCase()] || "—";
}

export function normalizarMovimento(row) {
  if (!row || typeof row !== "object") return null;
  const quantidade = centavosOuNulo(row.quantidade);
  const saldo = centavosOuNulo(row.saldo_disponivel);
  if (quantidade == null || saldo == null) return null;
  return {
    id: typeof row.id === "string" ? row.id : "",
    produto_id: textoOuVazio(row.produto_id),
    tipo: textoOuVazio(row.tipo),
    quantidade,
    saldo_disponivel: saldo,
    saldo_reservado: centavosOuNulo(row.saldo_reservado),
    observacao: textoOuVazio(row.observacao),
    pedido_id: textoOuVazio(row.pedido_id),
    created_at: typeof row.created_at === "string" ? row.created_at : "",
  };
}

export function formatarQuantidadeMovimento(qtd) {
  if (typeof qtd !== "number" || !Number.isFinite(qtd)) return "—";
  if (qtd > 0) return "+" + qtd;
  return String(qtd);
}

export function validarEntrada(valor) {
  if (valor == null || String(valor).trim() === "") {
    return "Informe quantas velas entraram.";
  }
  if (!/^\d+$/.test(String(valor).trim())) {
    return "Informe uma quantidade inteira maior que zero.";
  }
  const n = Number(valor);
  if (n < 1 || n > 100000) return "Informe uma quantidade inteira maior que zero.";
  return "";
}

export function validarAjuste(valor) {
  if (valor == null || String(valor).trim() === "") {
    return "Informe o disponível correto.";
  }
  if (!/^\d+$/.test(String(valor).trim())) {
    return "O disponível correto é um inteiro a partir de zero.";
  }
  const n = Number(valor);
  if (n < 0 || n > 100000) return "O disponível correto é um inteiro a partir de zero.";
  return "";
}

export function validarMotivo(valor) {
  if (valor == null) return "";
  if (String(valor).trim().length > 400) return "O motivo passou de 400 caracteres.";
  return "";
}

function chaveCliente(pedido) {
  const cpf = String(pedido.cliente_cpf || "").replace(/\D/g, "");
  if (cpf.length === 11) return "cpf:" + cpf;
  const email = String(pedido.cliente_email || "").trim().toLowerCase();
  if (email) return "email:" + email;
  const tel = String(pedido.cliente_telefone || "").replace(/\D/g, "");
  if (tel) return "tel:" + tel;
  return "pedido:" + (pedido.id || "");
}

export function agruparClientes(pedidos) {
  const map = new Map();
  for (const pedido of pedidos || []) {
    if (!pedido || pedido.teste) continue;
    const chave = chaveCliente(pedido);
    let grupo = map.get(chave);
    if (!grupo) {
      grupo = { chave, pedidos: [] };
      map.set(chave, grupo);
    }
    grupo.pedidos.push(pedido);
  }
  const lista = [];
  for (const grupo of map.values()) {
    const ordenados = grupo.pedidos.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const comNome = ordenados.find((p) => p.cliente_nome);
    const comTel = ordenados.find((p) => p.cliente_telefone);
    const comEmail = ordenados.find((p) => p.cliente_email);
    const cpf = String((ordenados.find((p) => p.cliente_cpf) || {}).cliente_cpf || "").replace(/\D/g, "");
    const gastos = ordenados.filter((p) => pedidoContaVenda(p));
    const ultima = gastos.slice().sort((a, b) => String(dataVenda(b)).localeCompare(String(dataVenda(a))))[0];
    lista.push({
      chave: grupo.chave,
      cpf: cpf.length === 11 ? cpf : "",
      nome: comNome ? comNome.cliente_nome : "Sem nome",
      email: comEmail ? comEmail.cliente_email : "",
      telefone: comTel ? comTel.cliente_telefone : "",
      pedidos: ordenados,
      quantidade: ordenados.length,
      totalCentavos: gastos.reduce((soma, p) => soma + (p.total_centavos || 0), 0),
      ultimaCompra: ultima ? dataVenda(ultima) : "",
    });
  }
  lista.sort((a, b) => {
    if (a.ultimaCompra !== b.ultimaCompra) return (b.ultimaCompra || "").localeCompare(a.ultimaCompra || "");
    return a.nome.localeCompare(b.nome, "pt-BR");
  });
  return lista;
}

export function filtrarClientes(clientes, busca) {
  const texto = String(busca || "").trim().toLowerCase();
  if (!texto) return clientes || [];
  const digitos = texto.replace(/\D/g, "");
  return (clientes || []).filter((cliente) => {
    if (cliente.nome.toLowerCase().includes(texto)) return true;
    if (cliente.email.toLowerCase().includes(texto)) return true;
    if (digitos && cliente.cpf.includes(digitos)) return true;
    if (cliente.cpf && formatarCpf(cliente.cpf).includes(texto)) return true;
    return false;
  });
}

function textoBusca(pedido) {
  const codigo = pedido.codigo || "";
  const partes = [
    pedido.cliente_nome,
    pedido.cliente_email,
    pedido.cliente_cpf,
    codigo,
    codigo ? "#" + codigo : "",
  ];
  return partes.filter(Boolean).join(" ").toLowerCase();
}

export function filtrarPedidos(linhas, filtros) {
  const f = filtros || filtrosVazios();
  const busca = String(f.busca || "").trim().toLowerCase().replace(/^#/, "");
  return (linhas || []).filter((pedido) => {
    if (!f.mostrarTestes && pedido.teste) return false;
    if (f.status && pedido.status !== f.status) return false;
    if (f.entrega === "envio" && pedido.entrega_tipo !== "envio") return false;
    if (f.entrega === "retirada" && pedido.entrega_tipo !== "retirada") return false;
    if (f.de || f.ate) {
      const dia = diaEmBrasilia(pedido.created_at);
      if (!dia) return false;
      if (f.de && dia < f.de) return false;
      if (f.ate && dia > f.ate) return false;
    }
    if (busca && !textoBusca(pedido).includes(busca)) return false;
    return true;
  });
}

export function mensagemCancelar(pedido) {
  const codigo = pedido && pedido.codigo ? "#" + pedido.codigo : "este pedido";
  return "Cancelar " + codigo + "? O estoque das velas volta pra loja.";
}

export function mensagemReembolsar(pedido) {
  const total = formatarPreco(pedido && pedido.total_centavos);
  const forma = pedido && pedido.forma_pagamento
    ? " (" + pedido.forma_pagamento + ")"
    : "";
  return "Devolver " + total + " pro cliente pelo Mercado Pago" + forma + "? Não dá pra desfazer.";
}

export function mensagemJaReembolsado() {
  return "O Mercado Pago informa que esse pagamento já foi reembolsado. Deseja marcar o pedido como reembolsado mesmo assim?";
}

export function mensagemApagarTeste(pedido) {
  const codigo = pedido && pedido.codigo ? "#" + pedido.codigo : "este pedido";
  return "Apagar " + codigo + "? Só pedidos de teste somem, e não tem volta.";
}

export function mensagemDeEntrada(status, body) {
  const codigo = body && (body.error_code || body.code);
  if (status === 429 || codigo === "over_request_rate_limit") {
    return "Muitas tentativas. Espere um pouco e tente de novo.";
  }
  if (codigo === "invalid_credentials" || codigo === "invalid_grant") {
    return "E-mail ou senha não conferem.";
  }
  if (codigo === "email_not_confirmed") {
    return "Este e-mail ainda não foi confirmado.";
  }
  return "Não foi possível entrar. Tente de novo.";
}

export function mensagemDePedidos(status, body) {
  const codigo = body && body.code;
  if (status === 401 && codigo === "42501") {
    return "A leitura dos pedidos foi recusada. A migration do painel precisa estar aplicada.";
  }
  if (status === 401 || status === 403) {
    return "A sessão expirou. Entre de novo.";
  }
  return "Não foi possível carregar os pedidos.";
}

export function mensagemDeAcao(corpo, fallback) {
  if (corpo && typeof corpo.mensagem === "string" && corpo.mensagem.trim()) {
    return corpo.mensagem.trim();
  }
  const erro = corpo && typeof corpo.erro === "string" ? corpo.erro : "";
  if (erro === "nao_autorizado" || erro === "sessao") return "A sessão expirou. Entre de novo.";
  if (erro === "nao_encontrado") return "Não achei esse pedido.";
  if (erro === "produto_ausente") return "Não achei essa vela no estoque.";
  if (erro === "produto_invalido") return "Essa vela não serve para o ajuste.";
  if (erro === "quantidade_invalida") return "Informe uma quantidade inteira maior que zero.";
  if (erro === "ficaria_negativo") return "O disponível não pode ficar negativo.";
  if (erro === "motivo_longo") return "O motivo passou de 400 caracteres.";
  if (erro === "nao_teste") return "Pedido real não pode ser apagado.";
  if (erro === "use_reembolso") return "Reembolso passa pelo Mercado Pago, não pela troca de status.";
  if (erro === "status_invalido") return "Esse status não é aceito.";
  if (erro === "mp_recusou") return "O Mercado Pago recusou o reembolso.";
  if (erro === "ja_reembolsado") {
    return "O Mercado Pago informa que esse pagamento já foi reembolsado.";
  }
  if (erro === "sem_pagamento" || erro === "sem_order") {
    return corpo && corpo.mensagem ? corpo.mensagem : "Não dá para reembolsar este pedido.";
  }
  return fallback || "Não foi possível concluir.";
}

export function sessaoPrecisaRenovar(sessao, agoraMs) {
  if (!sessao || typeof sessao.expires_at !== "number") return true;
  return sessao.expires_at * 1000 <= agoraMs + FOLGA_MS;
}

export function montarSessao(corpo, agoraMs) {
  if (!corpo || typeof corpo !== "object") return null;
  const user = corpo.user && typeof corpo.user === "object" ? corpo.user : {};
  const email = typeof user.email === "string" ? user.email : "";
  if (typeof corpo.access_token !== "string" || typeof corpo.refresh_token !== "string") return null;
  if (!emailEhAdmin(email)) return null;
  const expiresAt = typeof corpo.expires_at === "number"
    ? corpo.expires_at
    : typeof corpo.expires_in === "number"
      ? Math.floor(agoraMs / 1000) + corpo.expires_in
      : 0;
  if (!expiresAt) return null;
  return {
    access_token: corpo.access_token,
    refresh_token: corpo.refresh_token,
    expires_at: expiresAt,
    email: email.trim().toLowerCase(),
  };
}

export function lerSessao(storage) {
  try {
    const bruto = storage.getItem(CHAVE_SESSAO);
    if (!bruto) return null;
    const dados = JSON.parse(bruto);
    const sessao = montarSessao(
      {
        access_token: dados.access_token,
        refresh_token: dados.refresh_token,
        expires_at: dados.expires_at,
        user: { email: dados.email },
      },
      0,
    );
    return sessao;
  } catch (_err) {
    return null;
  }
}

export function gravarSessao(storage, sessao) {
  storage.setItem(CHAVE_SESSAO, JSON.stringify(sessao));
}

export function limparSessao(storage) {
  storage.removeItem(CHAVE_SESSAO);
}

export function cabecalhos(config, token) {
  return {
    apikey: config.anonKey,
    Authorization: "Bearer " + (token || config.anonKey),
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

async function lerCorpo(res) {
  try {
    return await res.json();
  } catch (_err) {
    return null;
  }
}

export async function entrar(config, email, senha, fetchImpl, agoraMs) {
  let res;
  try {
    res = await fetchImpl(config.url + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: cabecalhos(config),
      body: JSON.stringify({ email: email.trim(), password: senha }),
    });
  } catch (_err) {
    return { ok: false, mensagem: "Não consegui falar com o servidor. Tente de novo." };
  }
  const corpo = await lerCorpo(res);
  if (!res.ok) return { ok: false, mensagem: mensagemDeEntrada(res.status, corpo) };
  const sessao = montarSessao(corpo, agoraMs);
  if (sessao) return { ok: true, sessao };
  const emailConta = corpo && corpo.user && typeof corpo.user.email === "string" ? corpo.user.email : "";
  const token = corpo && typeof corpo.access_token === "string" ? corpo.access_token : "";
  if (token) await sair(config, token, fetchImpl);
  if (emailConta && !emailEhAdmin(emailConta)) {
    return { ok: false, mensagem: "Esta conta não administra a loja." };
  }
  return { ok: false, mensagem: "Não foi possível entrar. Tente de novo." };
}

export async function renovar(config, sessao, fetchImpl, agoraMs) {
  let res;
  try {
    res = await fetchImpl(config.url + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: cabecalhos(config),
      body: JSON.stringify({ refresh_token: sessao.refresh_token }),
    });
  } catch (_err) {
    return { ok: false, rede: true };
  }
  const corpo = await lerCorpo(res);
  if (!res.ok) return { ok: false };
  const nova = montarSessao(corpo, agoraMs);
  if (!nova) return { ok: false };
  return { ok: true, sessao: nova };
}

export async function sair(config, accessToken, fetchImpl) {
  try {
    await fetchImpl(config.url + "/auth/v1/logout", {
      method: "POST",
      headers: cabecalhos(config, accessToken),
      body: JSON.stringify({ scope: "global" }),
    });
  } catch (_err) {
    // A sessão local sai mesmo se o servidor não responder.
  }
}

export async function listarPedidos(config, accessToken, fetchImpl, signal) {
  const query = new URLSearchParams({
    select: SELECT_PEDIDOS,
    order: "created_at.desc",
  });
  let res;
  try {
    res = await fetchImpl(config.url + "/rest/v1/pedidos?" + query.toString(), {
      headers: cabecalhos(config, accessToken),
      signal,
    });
  } catch (err) {
    if (err && err.name === "AbortError") return { ok: false, abortado: true };
    return { ok: false, rede: true };
  }
  const corpo = await lerCorpo(res);
  if (!res.ok) return { ok: false, status: res.status, body: corpo };
  if (!Array.isArray(corpo)) return { ok: false, status: res.status, body: corpo };
  const linhas = corpo.map(normalizarPedido).filter(Boolean);
  return { ok: true, linhas };
}

export async function listarHistorico(config, accessToken, pedidoId, fetchImpl, signal) {
  const query = new URLSearchParams({
    select: "id,pedido_id,status,origem,created_at",
    pedido_id: "eq." + pedidoId,
    order: "created_at.asc",
  });
  let res;
  try {
    res = await fetchImpl(config.url + "/rest/v1/pedido_status_historico?" + query.toString(), {
      headers: cabecalhos(config, accessToken),
      signal,
    });
  } catch (err) {
    if (err && err.name === "AbortError") return { ok: false, abortado: true };
    return { ok: false, rede: true };
  }
  const corpo = await lerCorpo(res);
  if (!res.ok) return { ok: false, status: res.status, body: corpo };
  if (!Array.isArray(corpo)) return { ok: false, status: res.status, body: corpo };
  return { ok: true, linhas: corpo.map(normalizarHistorico).filter(Boolean) };
}

async function chamarRpc(config, accessToken, nome, corpo, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(config.url + "/rest/v1/rpc/" + nome, {
      method: "POST",
      headers: cabecalhos(config, accessToken),
      body: JSON.stringify(corpo),
    });
  } catch (_err) {
    return { ok: false, rede: true };
  }
  const data = await lerCorpo(res);
  if (!res.ok) return { ok: false, status: res.status, body: data };
  if (data && data.ok === false) return { ok: false, status: res.status, body: data };
  return { ok: true, body: data };
}

export async function alterarStatusPedido(config, accessToken, pedidoId, status, fetchImpl) {
  return chamarRpc(config, accessToken, "admin_alterar_status_pedido", {
    p_pedido_id: pedidoId,
    p_status: status,
    p_origem: "admin",
  }, fetchImpl);
}

export async function salvarNotasPedido(config, accessToken, pedidoId, notas, fetchImpl) {
  return chamarRpc(config, accessToken, "admin_salvar_notas_pedido", {
    p_pedido_id: pedidoId,
    p_notas: notas,
  }, fetchImpl);
}

export async function apagarPedidoTeste(config, accessToken, pedidoId, fetchImpl) {
  return chamarRpc(config, accessToken, "admin_apagar_pedido_teste", {
    p_pedido_id: pedidoId,
  }, fetchImpl);
}

export async function confirmarReembolso(config, accessToken, pedidoId, origem, fetchImpl) {
  const corpo = { p_pedido_id: pedidoId };
  if (origem) corpo.p_origem = origem;
  return chamarRpc(config, accessToken, "admin_confirmar_reembolso", corpo, fetchImpl);
}

async function lerTabela(config, accessToken, caminho, fetchImpl, signal) {
  let res;
  try {
    res = await fetchImpl(config.url + caminho, {
      headers: cabecalhos(config, accessToken),
      signal,
    });
  } catch (err) {
    if (err && err.name === "AbortError") return { ok: false, abortado: true };
    return { ok: false, rede: true };
  }
  const corpo = await lerCorpo(res);
  if (!res.ok) return { ok: false, status: res.status, body: corpo };
  if (!Array.isArray(corpo)) return { ok: false, status: res.status, body: corpo };
  return { ok: true, linhas: corpo };
}

export function mensagemDeLeitura(status, body, recurso) {
  const codigo = body && body.code;
  if (status === 401 && codigo === "42501") {
    return "A leitura " + recurso + " foi recusada. A migration do painel precisa estar aplicada.";
  }
  if (status === 401 || status === 403) return "A sessão expirou. Entre de novo.";
  return "Não foi possível carregar " + recurso + ".";
}

export async function listarProdutos(config, accessToken, fetchImpl, signal) {
  return lerTabela(
    config,
    accessToken,
    "/rest/v1/produtos?select=id,nome,colecao,ordem,ativo&order=ordem.asc",
    fetchImpl,
    signal,
  );
}

export async function listarLinhasEstoque(config, accessToken, fetchImpl, signal) {
  return lerTabela(
    config,
    accessToken,
    "/rest/v1/estoque?select=produto_id,disponivel,reservado,updated_at",
    fetchImpl,
    signal,
  );
}

export async function listarMovimentos(config, accessToken, produtoId, fetchImpl, signal) {
  const query = new URLSearchParams({
    select: "id,produto_id,tipo,quantidade,saldo_disponivel,saldo_reservado,observacao,pedido_id,created_at",
    produto_id: "eq." + produtoId,
    order: "created_at.desc",
  });
  const resposta = await lerTabela(
    config,
    accessToken,
    "/rest/v1/estoque_movimentos?" + query.toString(),
    fetchImpl,
    signal,
  );
  if (!resposta.ok) return resposta;
  return { ok: true, linhas: resposta.linhas.map(normalizarMovimento).filter(Boolean) };
}

export async function entradaProducao(config, accessToken, produtoId, quantidade, observacao, fetchImpl) {
  return chamarRpc(config, accessToken, "admin_entrada_producao", {
    p_produto_id: produtoId,
    p_quantidade: quantidade,
    p_observacao: observacao || "",
  }, fetchImpl);
}

export async function ajusteEstoque(config, accessToken, produtoId, disponivel, observacao, fetchImpl) {
  return chamarRpc(config, accessToken, "admin_ajuste_estoque", {
    p_produto_id: produtoId,
    p_disponivel: disponivel,
    p_observacao: observacao || "",
  }, fetchImpl);
}

export async function chamarEtiquetas(config, accessToken, corpo, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(config.url + "/functions/v1/etiquetas-melhor-envio", {
      method: "POST",
      headers: cabecalhos(config, accessToken),
      body: JSON.stringify(corpo),
    });
  } catch (_err) {
    return { ok: false, rede: true };
  }
  const data = await lerCorpo(res);
  if (!res.ok || (data && data.ok === false)) {
    return { ok: false, status: res.status, body: data };
  }
  return { ok: true, body: data };
}

export async function notificarCliente(config, accessToken, pedidoId, evento, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(config.url + "/functions/v1/notificar-cliente", {
      method: "POST",
      headers: cabecalhos(config, accessToken),
      body: JSON.stringify({ pedido_id: pedidoId, evento }),
    });
  } catch (_err) {
    return { ok: false, rede: true };
  }
  const data = await lerCorpo(res);
  if (!res.ok || (data && data.ok === false)) {
    return { ok: false, status: res.status, body: data };
  }
  return { ok: true, body: data };
}

export function rotuloTipoAviso(tipo) {
  return ROTULOS_AVISO[tipo] || "Aviso";
}

export function normalizarAviso(row) {
  if (!row || typeof row !== "object") return null;
  const id = typeof row.id === "string" ? row.id.trim().toLowerCase() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return null;
  if (!ROTULOS_AVISO[row.tipo]) return null;
  const mensagem = typeof row.mensagem === "string" ? row.mensagem.trim() : "";
  if (!mensagem || mensagem.length > 500) return null;
  const created = typeof row.created_at === "string" ? row.created_at : "";
  if (!created || Number.isNaN(new Date(created).getTime())) return null;
  return {
    id,
    tipo: row.tipo,
    mensagem,
    resolvido: row.resolvido === true,
    created_at: created,
  };
}

export async function listarAvisos(config, accessToken, fetchImpl, signal) {
  const resposta = await lerTabela(
    config,
    accessToken,
    "/rest/v1/avisos?select=id,tipo,mensagem,resolvido,created_at&order=resolvido.asc,created_at.desc&limit=80",
    fetchImpl,
    signal,
  );
  if (!resposta.ok) return resposta;
  return { ok: true, linhas: resposta.linhas.map(normalizarAviso).filter(Boolean) };
}

export async function resolverAviso(config, accessToken, avisoId, resolvido, fetchImpl) {
  return chamarRpc(config, accessToken, "admin_resolver_aviso", {
    p_id: avisoId,
    p_resolvido: resolvido,
  }, fetchImpl);
}

export async function dispararAvisos(config, accessToken, fetchImpl) {
  try {
    await fetchImpl(config.url + "/functions/v1/despachar-avisos", {
      method: "POST",
      headers: cabecalhos(config, accessToken),
      body: "{}",
    });
  } catch (_err) {
    // A linha continua pendente. A manutenção diária tenta de novo.
  }
}

export async function reembolsarPedido(config, accessToken, pedidoId, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(config.url + "/functions/v1/reembolsar-pedido", {
      method: "POST",
      headers: cabecalhos(config, accessToken),
      body: JSON.stringify({ pedido_id: pedidoId }),
    });
  } catch (_err) {
    return { ok: false, rede: true };
  }
  const data = await lerCorpo(res);
  if (data && data.ja_reembolsado === true) {
    return { ok: false, ja_reembolsado: true, status: res.status, body: data };
  }
  if (!res.ok || (data && data.ok === false)) {
    return { ok: false, status: res.status, body: data };
  }
  return { ok: true, body: data };
}
