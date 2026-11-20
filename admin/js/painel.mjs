export const EMAIL_ADMIN = "contato@foveoatelie.com.br";
export const CHAVE_SESSAO = "foveo.admin.sessao";
export const CHAVE_DEPOIS = "foveo.admin.depois";
export const CHAVE_MOSTRAR_TESTES = "foveo.admin.mostrar_testes";

export const ROTAS = {
  "/": "inicio",
  "/entrar": "entrar",
  "/pedidos": "pedidos",
  "/estoque": "estoque",
  "/clientes": "clientes",
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

export function telefoneParaWa(telefone) {
  const digitos = String(telefone || "").replace(/\D/g, "");
  if (!digitos) return "";
  if (digitos.startsWith("55") && digitos.length >= 12) return digitos;
  if (digitos.length >= 10 && digitos.length <= 11) return "55" + digitos;
  return "";
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

function diaEmBrasilia(iso) {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(data);
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
  if (erro === "nao_teste") return "Pedido real não pode ser apagado.";
  if (erro === "use_reembolso") return "Reembolso passa pelo Mercado Pago, não pela troca de status.";
  if (erro === "status_invalido") return "Esse status não é aceito.";
  if (erro === "mp_recusou") return "O Mercado Pago recusou o reembolso.";
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
  if (!res.ok || (data && data.ok === false)) {
    return { ok: false, status: res.status, body: data };
  }
  return { ok: true, body: data };
}
