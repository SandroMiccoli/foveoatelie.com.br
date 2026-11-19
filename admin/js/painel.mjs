export const EMAIL_ADMIN = "contato@foveoatelie.com.br";
export const CHAVE_SESSAO = "foveo.admin.sessao";
export const CHAVE_DEPOIS = "foveo.admin.depois";

export const ROTAS = {
  "/": "inicio",
  "/entrar": "entrar",
  "/pedidos": "pedidos",
  "/estoque": "estoque",
  "/clientes": "clientes",
};

const STATUS = {
  pendente: "Pendente",
  pago: "Pago",
  expirado: "Expirado",
  recusado: "Recusado",
  cancelado: "Cancelado",
  enviado: "Enviado",
  entregue: "Entregue",
};

const FOLGA_MS = 60_000;
const SELECT_PEDIDOS = "codigo,created_at,cliente_nome,total_centavos,status,teste";

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

export function rotuloStatus(status) {
  if (typeof status !== "string") return "—";
  return STATUS[status.trim().toLowerCase()] || "—";
}

export function nivelStatus(status) {
  const chave = typeof status === "string" ? status.trim().toLowerCase() : "";
  if (chave === "pago" || chave === "enviado" || chave === "entregue") return "ok";
  if (chave === "pendente") return "espera";
  if (chave === "expirado" || chave === "recusado" || chave === "cancelado") return "para";
  return "neutro";
}

export function normalizarPedido(row) {
  if (!row || typeof row !== "object") return null;
  let centavos = null;
  if (typeof row.total_centavos === "number" && Number.isFinite(row.total_centavos)) {
    centavos = Math.round(row.total_centavos);
  } else if (typeof row.total_centavos === "string" && /^\d+$/.test(row.total_centavos)) {
    centavos = Number(row.total_centavos);
  }
  return {
    codigo: typeof row.codigo === "string" ? row.codigo : "",
    created_at: typeof row.created_at === "string" ? row.created_at : "",
    cliente_nome: typeof row.cliente_nome === "string" ? row.cliente_nome.trim() : "",
    total_centavos: centavos,
    status: typeof row.status === "string" ? row.status : "",
    teste: row.teste === true,
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
