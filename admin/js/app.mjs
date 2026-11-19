import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config.mjs";
import {
  CHAVE_DEPOIS,
  CHAVE_SESSAO,
  ROTAS,
  caminhoDepois,
  emailEhAdmin,
  entrar,
  formatarData,
  formatarPreco,
  gravarSessao,
  lerSessao,
  limparSessao,
  listarPedidos,
  mensagemDePedidos,
  nivelStatus,
  normalizarCaminho,
  renovar,
  resumoPedidos,
  rotuloStatus,
  sair,
  sessaoPrecisaRenovar,
  tituloDaRota,
} from "./painel.mjs";

const config = { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY };
const app = document.querySelector("#app");

let sessao = null;
let caminhoAtual = "/";
let avisoEntrada = "";
let cargaPedidos = 0;
let controladorPedidos = null;

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [chave, valor] of Object.entries(attrs)) {
      if (valor == null || valor === false) continue;
      if (chave === "class") node.className = valor;
      else if (chave === "text") node.textContent = valor;
      else node.setAttribute(chave, valor);
    }
  }
  for (const filho of children || []) {
    if (filho == null || filho === false) continue;
    node.append(filho);
  }
  return node;
}

function caminhoAgora() {
  return normalizarCaminho(location.pathname);
}

function lembrarDepois(caminho) {
  try {
    sessionStorage.setItem(CHAVE_DEPOIS, caminhoDepois(caminho));
  } catch (_err) {
    // Sessão privada pode recusar sessionStorage. O destino volta a ser Início.
  }
}

function consumirDepois() {
  let valor = "/";
  try {
    valor = sessionStorage.getItem(CHAVE_DEPOIS) || "/";
    sessionStorage.removeItem(CHAVE_DEPOIS);
  } catch (_err) {
    valor = "/";
  }
  return caminhoDepois(valor);
}

function ir(caminho, { substituir = false } = {}) {
  const destino = normalizarCaminho(caminho);
  if (destino === caminhoAgora()) {
    pintar();
    return;
  }
  const metodo = substituir ? "replaceState" : "pushState";
  history[metodo]({}, "", destino);
  pintar();
}

function exigirEntrada() {
  const caminho = caminhoAgora();
  if (sessao || caminho === "/entrar" || !ROTAS[caminho]) return;
  lembrarDepois(caminho);
  history.replaceState({}, "", "/entrar");
}

async function garantirSessao() {
  sessao = lerSessao(localStorage);
  if (!sessao) return null;
  if (!emailEhAdmin(sessao.email) || sessaoPrecisaRenovar(sessao, Date.now())) {
    const renovada = await renovar(config, sessao, fetch, Date.now());
    if (!renovada.ok) {
      limparSessao(localStorage);
      sessao = null;
      return null;
    }
    sessao = renovada.sessao;
    gravarSessao(localStorage, sessao);
  }
  return sessao;
}

async function encerrar() {
  const token = sessao && sessao.access_token;
  sessao = null;
  limparSessao(localStorage);
  if (token) await sair(config, token, fetch);
  ir("/entrar", { substituir: true });
}

function focarTitulo() {
  const titulo = document.querySelector("#conteudo h1");
  if (!titulo) return;
  titulo.setAttribute("tabindex", "-1");
  titulo.focus({ preventScroll: true });
}

function marca(corte) {
  const img = el("img", {
    src: "/assets/logo-claro.svg",
    alt: "Foveō Ateliê",
    width: "1014",
    height: "586",
  });
  return el("span", { class: corte ? "marca-corte" : "marca-cheia" }, [img]);
}

function casca() {
  const links = [
    ["/", "Início"],
    ["/pedidos", "Pedidos"],
    ["/estoque", "Estoque"],
    ["/clientes", "Clientes"],
  ].map(([href, nome]) => {
    const a = el("a", { href, text: nome });
    if (href === caminhoAgora()) a.setAttribute("aria-current", "page");
    return a;
  });

  return el("div", { class: "casca" }, [
    el("div", { class: "rail" }, [
      el("div", { class: "topo" }, [
        el("a", { class: "marca", href: "/" }, [marca(true)]),
        el("button", { class: "sair sair-topo", type: "button", "data-sair": "1", text: "Sair" }),
      ]),
      el("nav", { class: "nav", "aria-label": "Seções" }, links),
      el("button", { class: "sair sair-rail", type: "button", "data-sair": "1", text: "Sair" }),
    ]),
    el("main", { id: "conteudo", tabindex: "-1" }),
  ]);
}

function titulo(texto) {
  return el("h1", { text: texto });
}

function paginaSimples(nome, texto) {
  return el("div", { class: "pagina" }, [
    titulo(nome),
    el("p", { class: "lede", text: texto }),
  ]);
}

function paginaInicio() {
  const itens = [
    ["/pedidos", "Pedidos", "Código, data, cliente, total e status."],
    ["/estoque", "Estoque", "Acolher, Despertar e Permanecer."],
    ["/clientes", "Clientes", "Quem já comprou."],
  ].map(([href, nome, nota]) =>
    el("li", {}, [
      el("a", { href }, [
        el("span", { class: "atalho-nome", text: nome }),
        el("span", { class: "atalho-nota", text: nota }),
      ]),
    ]),
  );

  return el("div", { class: "pagina" }, [
    titulo("Início"),
    el("p", {
      class: "lede",
      text: "A lista de pedidos já abre. Estoque e clientes ficam para a próxima etapa.",
    }),
    el("ul", { class: "atalhos" }, itens),
  ]);
}

function pontoStatus(nivel) {
  return el("span", { class: "ponto", "data-nivel": nivel, "aria-hidden": "true" });
}

function seloTeste() {
  return el("span", { class: "selo", text: "teste" });
}

function vista(linha) {
  const data = formatarData(linha.created_at);
  return {
    codigo: linha.codigo || "—",
    teste: linha.teste,
    dataTexto: data ? data.texto : "—",
    dataIso: data ? data.iso : "",
    cliente: linha.cliente_nome || "—",
    total: formatarPreco(linha.total_centavos),
    status: rotuloStatus(linha.status),
    nivel: nivelStatus(linha.status),
  };
}

function celulaCodigo(item) {
  const partes = [document.createTextNode(item.codigo)];
  if (item.teste) partes.push(seloTeste());
  const td = el("td", { "data-campo": "codigo" });
  td.append(...partes);
  return td;
}

function tabela(linhas) {
  const cabecalho = el("tr", {}, [
    el("th", { scope: "col", text: "Código" }),
    el("th", { scope: "col", text: "Data" }),
    el("th", { scope: "col", text: "Cliente" }),
    el("th", { scope: "col", text: "Total" }),
    el("th", { scope: "col", text: "Status" }),
  ]);
  const corpo = linhas.map((linha) => {
    const item = vista(linha);
    const tempo = el("time", { text: item.dataTexto });
    if (item.dataIso) tempo.setAttribute("datetime", item.dataIso);
    const status = el("span", { class: "status" }, [
      pontoStatus(item.nivel),
      document.createTextNode(item.status),
    ]);
    return el("tr", {}, [
      celulaCodigo(item),
      el("td", { "data-campo": "data" }, [tempo]),
      el("td", { "data-campo": "cliente", text: item.cliente }),
      el("td", { "data-campo": "total", text: item.total }),
      el("td", { "data-campo": "status" }, [status]),
    ]);
  });

  return el("div", { class: "rolagem so-larga" }, [
    el("table", {}, [
      el("caption", { class: "sr-only", text: "Pedidos, do mais recente ao mais antigo." }),
      el("thead", {}, [cabecalho]),
      el("tbody", {}, corpo),
    ]),
  ]);
}

function pilha(linhas) {
  const itens = linhas.map((linha) => {
    const item = vista(linha);
    const tempo = el("time", { text: item.dataTexto });
    if (item.dataIso) tempo.setAttribute("datetime", item.dataIso);
    const codigo = el("h2", {}, [
      el("span", { class: "codigo", text: item.codigo }),
      item.teste ? seloTeste() : null,
    ]);
    return el("li", {}, [
      el("article", { class: "pedido" }, [
        codigo,
        el("dl", {}, [
          el("dt", { text: "Data" }),
          el("dd", {}, [tempo]),
          el("dt", { text: "Cliente" }),
          el("dd", { text: item.cliente }),
          el("dt", { text: "Total" }),
          el("dd", { text: item.total }),
          el("dt", { text: "Status" }),
          el("dd", {}, [
            el("span", { class: "status" }, [
              pontoStatus(item.nivel),
              document.createTextNode(item.status),
            ]),
          ]),
        ]),
      ]),
    ]);
  });
  return el("ol", { class: "pedidos-pilha so-estreita" }, itens);
}

function mioloPedidos(estado) {
  if (estado.tipo === "carregando") {
    return el("div", { class: "esqueleto", "aria-busy": "true" }, [
      el("p", { text: "Carregando os pedidos." }),
      el("span", { class: "barra" }),
      el("span", { class: "barra" }),
      el("span", { class: "barra" }),
      el("span", { class: "barra" }),
    ]);
  }
  if (estado.tipo === "erro") {
    return el("div", { class: "aviso" }, [
      el("p", { role: "alert", tabindex: "-1", text: estado.mensagem }),
      el("button", { type: "button", class: "botao", "data-recarregar": "1", text: "Tentar de novo" }),
    ]);
  }
  if (!estado.linhas.length) {
    return el("p", {
      class: "vazio",
      text: "Nenhum pedido ainda. Quando alguém comprar, o pedido aparece aqui.",
    });
  }
  return el("div", {}, [
    el("p", { class: "resumo", text: resumoPedidos(estado.linhas) }),
    tabela(estado.linhas),
    pilha(estado.linhas),
  ]);
}

function paginaPedidos(estado) {
  return el("div", { class: "pagina" }, [
    titulo("Pedidos"),
    el("div", { id: "regiao-pedidos" }, [mioloPedidos(estado)]),
  ]);
}

function telaEntrar(mensagem) {
  const alerta = mensagem
    ? el("p", { class: "alerta", role: "alert", tabindex: "-1", text: mensagem })
    : null;
  const form = el("form", { id: "form-entrar", method: "post", action: "/entrar", novalidate: "novalidate" }, [
    el("div", { class: "campo" }, [
      el("label", { for: "email", text: "E-mail" }),
      el("input", {
        id: "email",
        name: "email",
        type: "email",
        autocomplete: "username",
        autocapitalize: "none",
        spellcheck: "false",
        inputmode: "email",
        required: "required",
      }),
    ]),
    el("div", { class: "campo" }, [
      el("div", { class: "campo-topo" }, [
        el("label", { for: "senha", text: "Senha" }),
        el("button", {
          type: "button",
          class: "mostrar",
          "data-mostrar-senha": "1",
          "aria-pressed": "false",
          text: "Mostrar",
        }),
      ]),
      el("input", {
        id: "senha",
        name: "senha",
        type: "password",
        autocomplete: "current-password",
        required: "required",
      }),
    ]),
    alerta,
    el("button", { class: "botao", type: "submit", text: "Entrar" }),
  ]);

  return el("main", { id: "conteudo", class: "entrar", tabindex: "-1" }, [
    el("a", { class: "marca marca-entrada", href: "/entrar", "aria-label": "Foveō Ateliê" }, [marca(false)]),
    titulo("Entrar"),
    el("p", { class: "lede", text: "Use a conta do ateliê." }),
    form,
  ]);
}

function telaSumida() {
  return el("main", { id: "conteudo", class: "pagina pagina-sola", tabindex: "-1" }, [
    titulo("Página não encontrada"),
    el("p", { class: "lede", text: "Esse endereço não faz parte do painel." }),
    el("a", { class: "botao botao-link", href: "/", text: "Ir para o início" }),
  ]);
}

function pintarConteudo(node, focar) {
  const temCasca = document.querySelector(".casca");
  if (!temCasca) app.replaceChildren(casca());
  document.querySelectorAll(".nav a").forEach((a) => {
    const href = a.getAttribute("href");
    if (href === caminhoAgora()) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  document.getElementById("conteudo").replaceChildren(node);
  if (focar) focarTitulo();
}

function pintar() {
  const caminho = caminhoAgora();
  const mudou = caminho !== caminhoAtual;
  caminhoAtual = caminho;
  document.title = ROTAS[caminho] ? tituloDaRota(caminho) : "Página não encontrada — Foveō Ateliê";

  if (!ROTAS[caminho]) {
    app.replaceChildren(telaSumida());
    if (mudou) focarTitulo();
    return;
  }

  if (!sessao) {
    const mensagem = avisoEntrada;
    avisoEntrada = "";
    app.replaceChildren(telaEntrar(mensagem));
    const alerta = document.querySelector("[role=alert]");
    if (alerta) alerta.focus();
    else if (mudou) {
      const email = document.getElementById("email");
      if (email) email.focus();
    }
    return;
  }

  if (caminho === "/entrar") {
    ir("/", { substituir: true });
    return;
  }

  if (caminho === "/pedidos") {
    const regiao = document.getElementById("regiao-pedidos");
    if (!regiao || mudou) {
      pintarConteudo(paginaPedidos({ tipo: "carregando" }), true);
      carregarPedidos();
    }
    return;
  }

  const paginas = {
    "/": paginaInicio(),
    "/estoque": paginaSimples(
      "Estoque",
      "Acolher, Despertar e Permanecer. A quantidade entra numa etapa seguinte.",
    ),
    "/clientes": paginaSimples(
      "Clientes",
      "Quem já comprou, a partir dos pedidos. A lista entra numa etapa seguinte.",
    ),
  };
  pintarConteudo(paginas[caminho], mudou);
}

async function carregarPedidos() {
  const id = ++cargaPedidos;
  if (controladorPedidos) controladorPedidos.abort();
  controladorPedidos = new AbortController();
  const sinal = controladorPedidos.signal;

  let resposta = await listarPedidos(config, sessao.access_token, fetch, sinal);
  if (id !== cargaPedidos || caminhoAgora() !== "/pedidos") return;

  const codigo = resposta.body && resposta.body.code;
  if (!resposta.ok && !resposta.abortado && !resposta.rede && resposta.status === 401 && codigo !== "42501") {
    const renovada = await renovar(config, sessao, fetch, Date.now());
    if (id !== cargaPedidos || caminhoAgora() !== "/pedidos") return;
    if (!renovada.ok) {
      sessao = null;
      limparSessao(localStorage);
      lembrarDepois("/pedidos");
      avisoEntrada = "A sessão expirou. Entre de novo.";
      ir("/entrar", { substituir: true });
      return;
    }
    sessao = renovada.sessao;
    gravarSessao(localStorage, sessao);
    resposta = await listarPedidos(config, sessao.access_token, fetch, sinal);
    if (id !== cargaPedidos || caminhoAgora() !== "/pedidos") return;
  }

  const regiao = document.getElementById("regiao-pedidos");
  if (!regiao) return;
  if (resposta.abortado) return;
  if (!resposta.ok) {
    const mensagem = resposta.rede
      ? "Não consegui falar com o servidor. Tente de novo."
      : mensagemDePedidos(resposta.status, resposta.body);
    regiao.replaceChildren(mioloPedidos({ tipo: "erro", mensagem }));
    const alerta = regiao.querySelector("[role=alert]");
    if (alerta) alerta.focus();
    return;
  }
  regiao.replaceChildren(mioloPedidos({ tipo: "pronto", linhas: resposta.linhas }));
}

function mensagemFormulario(email, senha) {
  if (!email && !senha) return "Preencha o e-mail e a senha.";
  if (!email) return "Preencha o e-mail.";
  if (!senha) return "Preencha a senha.";
  if (!email.includes("@") || email.startsWith("@") || email.endsWith("@")) {
    return "Esse e-mail não parece válido.";
  }
  return "";
}

async function enviarEntrada(form) {
  const botao = form.querySelector("[type=submit]");
  const email = form.email.value.trim();
  const senha = form.senha.value;
  const local = mensagemFormulario(email, senha);
  if (local) {
    mostrarAlerta(form, local);
    return;
  }
  botao.disabled = true;
  botao.textContent = "Entrando…";
  const resultado = await entrar(config, email, senha, fetch, Date.now());
  if (!resultado.ok) {
    botao.disabled = false;
    botao.textContent = "Entrar";
    mostrarAlerta(form, resultado.mensagem);
    return;
  }
  sessao = resultado.sessao;
  gravarSessao(localStorage, sessao);
  ir(consumirDepois(), { substituir: true });
}

function mostrarAlerta(form, mensagem) {
  let alerta = form.querySelector(".alerta");
  if (!alerta) {
    alerta = el("p", { class: "alerta", role: "alert", tabindex: "-1" });
    form.querySelector("[type=submit]").before(alerta);
  }
  alerta.textContent = mensagem;
  alerta.focus();
}

app.addEventListener("click", (event) => {
  const sairBotao = event.target.closest("[data-sair]");
  if (sairBotao) {
    event.preventDefault();
    encerrar();
    return;
  }
  const recarregar = event.target.closest("[data-recarregar]");
  if (recarregar) {
    const regiao = document.getElementById("regiao-pedidos");
    if (regiao) regiao.replaceChildren(mioloPedidos({ tipo: "carregando" }));
    carregarPedidos();
    return;
  }
  const mostrar = event.target.closest("[data-mostrar-senha]");
  if (mostrar) {
    const campo = document.getElementById("senha");
    const visivel = campo.getAttribute("type") === "text";
    campo.setAttribute("type", visivel ? "password" : "text");
    mostrar.textContent = visivel ? "Mostrar" : "Ocultar";
    mostrar.setAttribute("aria-pressed", visivel ? "false" : "true");
    return;
  }
  const link = event.target.closest("a[href]");
  if (!link) return;
  const url = new URL(link.href, location.origin);
  if (url.origin !== location.origin) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
  const caminho = normalizarCaminho(url.pathname);
  if (!ROTAS[caminho]) return;
  if (caminho === caminhoAgora()) return;
  event.preventDefault();
  if (!sessao && caminho !== "/entrar") lembrarDepois(caminho);
  ir((sessao || caminho === "/entrar") ? caminho : "/entrar");
});

app.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || form.id !== "form-entrar") return;
  event.preventDefault();
  enviarEntrada(form);
});

window.addEventListener("popstate", () => {
  exigirEntrada();
  pintar();
});

window.addEventListener("storage", (event) => {
  if (event.key !== CHAVE_SESSAO) return;
  sessao = lerSessao(localStorage);
  if (!sessao && caminhoAgora() !== "/entrar") {
    ir("/entrar", { substituir: true });
    return;
  }
  pintar();
});

garantirSessao().then(() => {
  exigirEntrada();
  pintar();
});
