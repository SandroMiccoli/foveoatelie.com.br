import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config.mjs";
import {
  CHAVE_DEPOIS,
  CHAVE_SESSAO,
  RAIL_ABERTO,
  RAIL_AUTO,
  RAIL_RECOLHIDO,
  ROTAS,
  STATUS,
  alterarStatusPedido,
  apagarPedidoTeste,
  caminhoDepois,
  emailEhAdmin,
  entrar,
  filtrarPedidos,
  filtrosVazios,
  formatarCpf,
  formatarData,
  formatarEnderecoCompleto,
  formatarPreco,
  formatarVelas,
  gravarMostrarTestes,
  gravarRail,
  gravarSessao,
  lerMostrarTestes,
  lerRail,
  lerSessao,
  limparSessao,
  linkWhatsApp,
  listarHistorico,
  listarPedidos,
  mensagemApagarTeste,
  mensagemCancelar,
  mensagemDeAcao,
  mensagemDePedidos,
  mensagemReembolsar,
  nivelStatus,
  normalizarCaminho,
  opcoesStatus,
  proximoRail,
  reembolsarPedido,
  renovar,
  resumoPedidos,
  rotuloEntrega,
  rotuloRail,
  rotuloStatus,
  sair,
  salvarNotasPedido,
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
let pedidosBrutos = [];
let filtros = filtrosVazios();
let pedidoAbertoId = "";
let historicoAberto = [];
let avisoPedido = "";
let confirmacao = null;
let notasRascunho = "";
let railEstado = RAIL_AUTO;
let railHoverTimer = 0;
const RAIL_HOVER_MS = 300;

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [chave, valor] of Object.entries(attrs)) {
      if (valor == null || valor === false) continue;
      if (chave === "class") node.className = valor;
      else if (chave === "text") node.textContent = valor;
      else if (chave === "html") node.innerHTML = valor;
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

function svgEl(tag, attrs, children) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  if (attrs) {
    for (const [chave, valor] of Object.entries(attrs)) {
      if (valor == null || valor === false) continue;
      node.setAttribute(chave, valor);
    }
  }
  for (const filho of children || []) {
    if (filho == null || filho === false) continue;
    node.append(filho);
  }
  return node;
}

function iconeSvg(paths, viewBox = "0 0 24 24") {
  return svgEl("svg", {
    class: "nav-icone",
    viewBox,
    width: "20",
    height: "20",
    "aria-hidden": "true",
    focusable: "false",
  }, paths.map((d) => svgEl("path", {
    d,
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.5",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  })));
}

const ICONES = {
  inicio: ["M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z"],
  pedidos: ["M7 4h10a1 1 0 0 1 1 1v15l-3.5-2-3.5 2-3.5-2L4 20V5a1 1 0 0 1 1-1z", "M8 9h8", "M8 13h6"],
  estoque: ["M3.5 8.5 12 4l8.5 4.5v7L12 20l-8.5-4.5z", "M12 12v8", "M3.5 8.5 12 12l8.5-3.5"],
  clientes: ["M12 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z", "M5 20a7 7 0 0 1 14 0"],
  sair: ["M10 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h4", "M14 12H8", "M14 12l3-3", "M14 12l3 3"],
  fixar: ["M12 3v7", "M8.5 7.5h7", "M9 10.5 12 21l3-10.5"],
};

function iconeWhatsApp() {
  return svgEl("svg", {
    class: "wa-icone",
    viewBox: "0 0 24 24",
    width: "18",
    height: "18",
    "aria-hidden": "true",
    focusable: "false",
  }, [
    svgEl("path", {
      d: "M12 3.5a8 8 0 0 0-6.9 12.1L4.5 20l4.5-.9A8 8 0 1 0 12 3.5z",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.5",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    }),
    svgEl("path", {
      d: "M9.4 9.6c.3-.3.7-.3.9 0l.8 1.1c.2.3.1.7-.1.9l-.4.4a6.5 6.5 0 0 0 2.5 2.5l.4-.4c.2-.2.6-.3.9-.1l1.1.8c.3.2.3.6 0 .9l-.6.6c-.3.3-.7.4-1.1.3A8.4 8.4 0 0 1 8.5 11c-.1-.4 0-.8.3-1.1z",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.5",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    }),
  ]);
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

function marcaSelo() {
  return svgEl("svg", {
    class: "marca-selo-svg",
    viewBox: "0 0 28 32",
    width: "28",
    height: "32",
    "aria-hidden": "true",
    focusable: "false",
  }, [
    svgEl("text", {
      x: "14",
      y: "24",
      "text-anchor": "middle",
      fill: "currentColor",
      "font-family": "EB Garamond, Georgia, serif",
      "font-size": "22",
      "font-style": "italic",
    }, [document.createTextNode("F")]),
    svgEl("rect", {
      x: "8",
      y: "4",
      width: "12",
      height: "2",
      rx: "1",
      fill: "#c87431",
    }),
  ]);
}

function aplicarClasseRail(cascaNode) {
  if (!cascaNode) return;
  cascaNode.classList.remove("rail-aberta", "rail-recolhida", "rail-hover");
  if (railEstado === RAIL_ABERTO) cascaNode.classList.add("rail-aberta");
  else if (railEstado === RAIL_RECOLHIDO) cascaNode.classList.add("rail-recolhida");
  cascaNode.dataset.rail = railEstado;
  const botao = cascaNode.querySelector("[data-rail-fixar]");
  if (botao) {
    botao.setAttribute("aria-pressed", railEstado === RAIL_AUTO ? "false" : "true");
    botao.setAttribute("aria-label", rotuloRail(railEstado));
    botao.setAttribute("title", rotuloRail(railEstado));
  }
}

function ligarHoverRail(cascaNode) {
  const rail = cascaNode.querySelector(".rail");
  if (!rail || rail.dataset.hoverPronto) return;
  rail.dataset.hoverPronto = "1";
  rail.addEventListener("mouseenter", () => {
    if (railEstado !== RAIL_AUTO) return;
    window.clearTimeout(railHoverTimer);
    railHoverTimer = window.setTimeout(() => {
      cascaNode.classList.add("rail-hover");
    }, RAIL_HOVER_MS);
  });
  rail.addEventListener("mouseleave", () => {
    window.clearTimeout(railHoverTimer);
    cascaNode.classList.remove("rail-hover");
  });
  rail.addEventListener("focusin", () => {
    if (railEstado !== RAIL_AUTO) return;
    window.clearTimeout(railHoverTimer);
    cascaNode.classList.add("rail-hover");
  });
  rail.addEventListener("focusout", (event) => {
    if (rail.contains(event.relatedTarget)) return;
    window.clearTimeout(railHoverTimer);
    cascaNode.classList.remove("rail-hover");
  });
}

function casca() {
  const itens = [
    ["/", "Início", "inicio"],
    ["/pedidos", "Pedidos", "pedidos"],
    ["/estoque", "Estoque", "estoque"],
    ["/clientes", "Clientes", "clientes"],
  ].map(([href, nome, chave]) => {
    const a = el("a", {
      href,
      "aria-label": nome,
      title: nome,
    }, [
      iconeSvg(ICONES[chave]),
      el("span", { class: "nav-rotulo", text: nome }),
    ]);
    if (href === caminhoAgora()) a.setAttribute("aria-current", "page");
    return a;
  });

  const fixar = el("button", {
    type: "button",
    class: "rail-fixar",
    "data-rail-fixar": "1",
    "aria-pressed": "false",
    "aria-label": rotuloRail(RAIL_AUTO),
    title: rotuloRail(RAIL_AUTO),
  }, [
    iconeSvg(ICONES.fixar),
    el("span", { class: "nav-rotulo", text: "Fixar" }),
  ]);

  const sairRail = el("button", {
    class: "sair sair-rail",
    type: "button",
    "data-sair": "1",
    "aria-label": "Sair",
    title: "Sair",
  }, [
    iconeSvg(ICONES.sair),
    el("span", { class: "nav-rotulo", text: "Sair" }),
  ]);

  const node = el("div", { class: "casca", "data-rail": railEstado }, [
    el("div", { class: "rail" }, [
      el("div", { class: "topo" }, [
        el("a", { class: "marca marca-larga", href: "/", "aria-label": "Foveō Ateliê" }, [marca(true)]),
        el("a", { class: "marca marca-selo", href: "/", "aria-label": "Foveō Ateliê", title: "Foveō Ateliê" }, [marcaSelo()]),
        el("button", { class: "sair sair-topo", type: "button", "data-sair": "1", text: "Sair" }),
      ]),
      el("nav", { class: "nav", "aria-label": "Seções" }, itens),
      el("div", { class: "rail-rodape" }, [sairRail, fixar]),
    ]),
    el("main", { id: "conteudo", tabindex: "-1" }),
  ]);
  aplicarClasseRail(node);
  ligarHoverRail(node);
  return node;
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
    ["/pedidos", "Pedidos", "Lista, detalhe, status e notas."],
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
      text: "Pedidos abrem com filtro, detalhe e troca de status. Estoque e clientes ficam para a próxima etapa.",
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
  const wa = linkWhatsApp(linha.cliente_telefone);
  return {
    id: linha.id,
    codigo: linha.codigo ? "#" + linha.codigo : "—",
    teste: linha.teste,
    dataTexto: data ? data.texto : "—",
    dataIso: data ? data.iso : "",
    cliente: linha.cliente_nome || "—",
    velas: formatarVelas(linha.itens),
    entrega: rotuloEntrega(linha),
    total: formatarPreco(linha.total_centavos),
    status: rotuloStatus(linha.status),
    nivel: nivelStatus(linha.status),
    wa,
  };
}

function botaoWa(wa) {
  if (!wa) return null;
  const a = el("a", {
    class: "wa",
    href: wa,
    target: "_blank",
    rel: "noopener noreferrer",
    "aria-label": "Abrir WhatsApp da cliente",
    title: "WhatsApp",
  });
  a.append(iconeWhatsApp());
  return a;
}

function celulaCodigo(item) {
  const partes = [document.createTextNode(item.codigo)];
  if (item.teste) partes.push(seloTeste());
  const td = el("td", { "data-campo": "codigo" });
  td.append(...partes);
  return td;
}

function filtrosPedidos() {
  const statusOpts = [
    el("option", { value: "", text: "Todos os status" }),
    ...Object.entries(STATUS).map(([valor, nome]) =>
      el("option", { value: valor, text: nome, selected: filtros.status === valor ? "selected" : null }),
    ),
  ];
  return el("form", { class: "filtros", id: "filtros-pedidos" }, [
    el("div", { class: "filtro" }, [
      el("label", { for: "filtro-status", text: "Status" }),
      el("select", { id: "filtro-status", name: "status" }, statusOpts),
    ]),
    el("div", { class: "filtro" }, [
      el("label", { for: "filtro-de", text: "De" }),
      el("input", { id: "filtro-de", name: "de", type: "date", value: filtros.de || "" }),
    ]),
    el("div", { class: "filtro" }, [
      el("label", { for: "filtro-ate", text: "Até" }),
      el("input", { id: "filtro-ate", name: "ate", type: "date", value: filtros.ate || "" }),
    ]),
    el("div", { class: "filtro" }, [
      el("label", { for: "filtro-entrega", text: "Entrega" }),
      el("select", { id: "filtro-entrega", name: "entrega" }, [
        el("option", { value: "todos", text: "Todas", selected: filtros.entrega === "todos" ? "selected" : null }),
        el("option", { value: "envio", text: "Envio", selected: filtros.entrega === "envio" ? "selected" : null }),
        el("option", {
          value: "retirada",
          text: "Retirada",
          selected: filtros.entrega === "retirada" ? "selected" : null,
        }),
      ]),
    ]),
    el("div", { class: "filtro filtro-busca" }, [
      el("label", { for: "filtro-busca", text: "Busca" }),
      el("input", {
        id: "filtro-busca",
        name: "busca",
        type: "search",
        placeholder: "Nome, código, e-mail ou CPF",
        value: filtros.busca || "",
        autocomplete: "off",
      }),
    ]),
    el("div", { class: "filtro filtro-toggle" }, [
      el("button", {
        type: "button",
        class: "toggle",
        "data-toggle-testes": "1",
        "aria-pressed": filtros.mostrarTestes ? "true" : "false",
        text: filtros.mostrarTestes ? "Esconder testes" : "Mostrar testes",
      }),
    ]),
  ]);
}

function tabela(linhas) {
  const cabecalho = el("tr", {}, [
    el("th", { scope: "col", text: "Código" }),
    el("th", { scope: "col", text: "Data" }),
    el("th", { scope: "col", text: "Cliente" }),
    el("th", { scope: "col", text: "Velas" }),
    el("th", { scope: "col", text: "Entrega" }),
    el("th", { scope: "col", text: "Total" }),
    el("th", { scope: "col", text: "Status" }),
    el("th", { scope: "col", class: "th-contato", "aria-label": "Contato" }, [
      el("span", { class: "sr-only", text: "Contato" }),
    ]),
  ]);
  const corpo = linhas.map((linha) => {
    const item = vista(linha);
    const tempo = el("time", { text: item.dataTexto });
    if (item.dataIso) tempo.setAttribute("datetime", item.dataIso);
    const status = el("span", { class: "status" }, [
      pontoStatus(item.nivel),
      document.createTextNode(item.status),
    ]);
    const aberta = pedidoAbertoId === item.id;
    return el("tr", {
      class: aberta ? "pedido-linha aberta" : "pedido-linha",
      "data-pedido": item.id,
      tabindex: "0",
      role: "button",
      "aria-pressed": aberta ? "true" : "false",
    }, [
      celulaCodigo(item),
      el("td", { "data-campo": "data" }, [tempo]),
      el("td", { "data-campo": "cliente", text: item.cliente }),
      el("td", { "data-campo": "velas", text: item.velas }),
      el("td", { "data-campo": "entrega", text: item.entrega }),
      el("td", { "data-campo": "total", text: item.total }),
      el("td", { "data-campo": "status" }, [status]),
      el("td", { "data-campo": "contato" }, [botaoWa(item.wa)]),
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
    const aberta = pedidoAbertoId === item.id;
    return el("li", {}, [
      el("article", {
        class: aberta ? "pedido aberta" : "pedido",
        "data-pedido": item.id,
        tabindex: "0",
        role: "button",
        "aria-pressed": aberta ? "true" : "false",
      }, [
        codigo,
        el("dl", {}, [
          el("dt", { text: "Data" }),
          el("dd", {}, [tempo]),
          el("dt", { text: "Cliente" }),
          el("dd", { text: item.cliente }),
          el("dt", { text: "Velas" }),
          el("dd", { text: item.velas }),
          el("dt", { text: "Entrega" }),
          el("dd", { text: item.entrega }),
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
        item.wa
          ? el("p", { class: "pedido-wa" }, [botaoWa(item.wa)])
          : null,
      ]),
    ]);
  });
  return el("ol", { class: "pedidos-pilha so-estreita" }, itens);
}

function campoDetalhe(rotulo, valorNode) {
  return el("div", { class: "detalhe-campo" }, [
    el("span", { class: "detalhe-rotulo", text: rotulo }),
    el("div", { class: "detalhe-valor" }, [valorNode]),
  ]);
}

function tracoOu(texto) {
  return el("span", { text: texto || "—" });
}

function painelDetalhe(pedido) {
  if (!pedido) return null;
  const wa = linkWhatsApp(pedido.cliente_telefone);
  const data = formatarData(pedido.created_at);
  const liberacao = pedido.mp_liberacao_em ? formatarData(pedido.mp_liberacao_em) : null;
  const frete = pedido.frete || {};
  const opcoes = opcoesStatus(pedido.entrega_tipo).map((valor) =>
    el("option", {
      value: valor,
      text: rotuloStatus(valor),
      selected: pedido.status === valor ? "selected" : null,
    }),
  );

  const historicoItens = historicoAberto.length
    ? historicoAberto.map((h) => {
      const quando = formatarData(h.created_at);
      return el("li", {}, [
        el("span", { class: "hist-status", text: rotuloStatus(h.status) }),
        el("time", { text: quando ? quando.texto : "—" }),
        el("span", { class: "hist-origem", text: h.origem || "" }),
      ]);
    })
    : [el("li", { class: "hist-vazio", text: "Sem histórico ainda." })];

  const aviso = avisoPedido
    ? el("p", { class: "alerta", role: "alert", text: avisoPedido })
    : null;

  const confirmBox = confirmacao && confirmacao.pedidoId === pedido.id
    ? el("div", { class: "confirmacao", role: "alertdialog", "aria-labelledby": "confirm-titulo" }, [
      el("p", { id: "confirm-titulo", text: confirmacao.texto }),
      el("div", { class: "confirmacao-acoes" }, [
        el("button", {
          type: "button",
          class: "botao botao-perigoso",
          "data-confirmar-sim": confirmacao.tipo,
          text: confirmacao.simLabel || "Confirmar",
        }),
        el("button", {
          type: "button",
          class: "botao-texto",
          "data-confirmar-nao": "1",
          text: "Voltar",
        }),
      ]),
    ])
    : null;

  return el("aside", {
    class: "detalhe",
    id: "painel-detalhe",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "detalhe-titulo",
  }, [
    el("div", { class: "detalhe-topo" }, [
      el("h2", { id: "detalhe-titulo" }, [
        el("span", { class: "codigo", text: pedido.codigo ? "#" + pedido.codigo : "Pedido" }),
        pedido.teste ? seloTeste() : null,
      ]),
      el("button", {
        type: "button",
        class: "fechar",
        "data-fechar-detalhe": "1",
        "aria-label": "Fechar detalhe",
        text: "Fechar",
      }),
    ]),
    el("p", { class: "detalhe-meta", text: data ? data.texto : "—" }),
    aviso,
    confirmBox,
    el("div", { class: "detalhe-lista" }, [
      campoDetalhe("Cliente", tracoOu(pedido.cliente_nome)),
      campoDetalhe(
        "WhatsApp",
        wa
          ? el("a", { href: wa, target: "_blank", rel: "noopener noreferrer", text: pedido.cliente_telefone || "Abrir" })
          : tracoOu(""),
      ),
      campoDetalhe("E-mail", tracoOu(pedido.cliente_email)),
      campoDetalhe("CPF", tracoOu(pedido.cliente_cpf ? formatarCpf(pedido.cliente_cpf) : "")),
      campoDetalhe(
        "Entrega",
        pedido.entrega_tipo === "retirada"
          ? tracoOu("Retirada em BH")
          : tracoOu(formatarEnderecoCompleto(pedido.endereco)),
      ),
      pedido.entrega_tipo === "envio"
        ? campoDetalhe(
          "Transportadora",
          tracoOu(
            [frete.transportadora, frete.servico].filter(Boolean).join(" · ")
              || "",
          ),
        )
        : null,
      campoDetalhe("Velas", tracoOu(formatarVelas(pedido.itens))),
      campoDetalhe("Subtotal", tracoOu(formatarPreco(pedido.subtotal_centavos))),
      campoDetalhe("Desconto do combo", tracoOu(formatarPreco(pedido.desconto_centavos))),
      campoDetalhe("Frete", tracoOu(formatarPreco(pedido.frete_centavos))),
      campoDetalhe("Total", tracoOu(formatarPreco(pedido.total_centavos))),
      campoDetalhe("Pagamento", tracoOu(pedido.forma_pagamento)),
      campoDetalhe("Taxa Mercado Pago", tracoOu(formatarPreco(pedido.mp_taxa_centavos))),
      campoDetalhe("Líquido recebido", tracoOu(formatarPreco(pedido.mp_liquido_centavos))),
      campoDetalhe("Liberação", tracoOu(liberacao ? liberacao.texto : "")),
    ].filter(Boolean)),
    el("div", { class: "detalhe-bloco" }, [
      el("label", { for: "status-pedido", text: "Status" }),
      el("select", { id: "status-pedido", "data-status-pedido": pedido.id }, opcoes),
    ]),
    el("div", { class: "detalhe-bloco" }, [
      el("h3", { text: "Histórico" }),
      el("ol", { class: "historico" }, historicoItens),
    ]),
    el("div", { class: "detalhe-bloco" }, [
      el("label", { for: "notas-pedido", text: "Notas internas" }),
      el("textarea", {
        id: "notas-pedido",
        rows: "4",
        maxlength: "4000",
        text: notasRascunho,
      }),
      el("button", {
        type: "button",
        class: "botao botao-secundario",
        "data-salvar-notas": pedido.id,
        text: "Salvar notas",
      }),
    ]),
    pedido.teste
      ? el("div", { class: "detalhe-bloco" }, [
        el("button", {
          type: "button",
          class: "botao-texto botao-perigoso-texto",
          "data-apagar-teste": pedido.id,
          text: "Apagar pedido",
        }),
      ])
      : null,
  ]);
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

  const filtradas = filtrarPedidos(estado.linhas, filtros);
  const pedidoAberto = estado.linhas.find((p) => p.id === pedidoAbertoId) || null;
  const lista = filtradas.length
    ? el("div", { class: "lista-pedidos" }, [
      el("p", { class: "resumo", text: resumoPedidos(filtradas) }),
      tabela(filtradas),
      pilha(filtradas),
    ])
    : el("p", {
      class: "vazio",
      text: estado.linhas.length
        ? "Nenhum pedido com esses filtros."
        : "Nenhum pedido ainda. Quando alguém comprar, o pedido aparece aqui.",
    });

  return el("div", { class: pedidoAberto ? "pedidos-com-detalhe" : "pedidos-so-lista" }, [
    filtrosPedidos(),
    el("div", { class: "pedidos-miolo" }, [
      lista,
      pedidoAberto
        ? el("div", { class: "detalhe-camada", "data-fechar-fundo": "1" }, [painelDetalhe(pedidoAberto)])
        : null,
    ]),
  ]);
}

function paginaPedidos(estado) {
  return el("div", { class: "pagina pagina-pedidos" }, [
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
    el("h1", { class: "sr-only", text: "Entrar" }),
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
  let cascaNode = document.querySelector(".casca");
  if (!cascaNode) {
    app.replaceChildren(casca());
    cascaNode = document.querySelector(".casca");
  } else {
    ligarHoverRail(cascaNode);
    aplicarClasseRail(cascaNode);
  }
  document.querySelectorAll(".nav a").forEach((a) => {
    const href = a.getAttribute("href");
    if (href === caminhoAgora()) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  document.getElementById("conteudo").replaceChildren(node);
  if (focar) focarTitulo();
}

function pintarRegiaoPedidos() {
  const regiao = document.getElementById("regiao-pedidos");
  if (!regiao) return;
  regiao.replaceChildren(mioloPedidos({ tipo: "pronto", linhas: pedidosBrutos }));
  if (pedidoAbertoId) {
    const fechar = document.querySelector("[data-fechar-detalhe]");
    if (fechar) fechar.focus();
  }
}

function fecharDetalhe() {
  pedidoAbertoId = "";
  historicoAberto = [];
  avisoPedido = "";
  confirmacao = null;
  notasRascunho = "";
  document.body.classList.remove("detalhe-aberto");
  pintarRegiaoPedidos();
}

async function abrirPedido(id) {
  if (!id) return;
  if (pedidoAbertoId === id) {
    fecharDetalhe();
    return;
  }
  const pedido = pedidosBrutos.find((p) => p.id === id);
  if (!pedido) return;
  pedidoAbertoId = id;
  avisoPedido = "";
  confirmacao = null;
  notasRascunho = pedido.notas_internas || "";
  historicoAberto = [];
  document.body.classList.add("detalhe-aberto");
  pintarRegiaoPedidos();

  const hist = await listarHistorico(config, sessao.access_token, id, fetch);
  if (pedidoAbertoId !== id) return;
  if (hist.ok) historicoAberto = hist.linhas;
  pintarRegiaoPedidos();
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
    filtros.mostrarTestes = lerMostrarTestes(localStorage);
    const regiao = document.getElementById("regiao-pedidos");
    if (!regiao || mudou) {
      fecharDetalhe();
      pintarConteudo(paginaPedidos({ tipo: "carregando" }), true);
      carregarPedidos();
    }
    return;
  }

  fecharDetalhe();
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
  pedidosBrutos = resposta.linhas;
  if (pedidoAbertoId && !pedidosBrutos.some((p) => p.id === pedidoAbertoId)) {
    fecharDetalhe();
  }
  pintarRegiaoPedidos();
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

function lerFiltrosDoForm(form) {
  const dados = new FormData(form);
  filtros = {
    ...filtros,
    status: String(dados.get("status") || ""),
    de: String(dados.get("de") || ""),
    ate: String(dados.get("ate") || ""),
    entrega: String(dados.get("entrega") || "todos"),
    busca: String(dados.get("busca") || ""),
  };
  pintarRegiaoPedidos();
}

async function pedirMudancaStatus(pedidoId, novoStatus) {
  const pedido = pedidosBrutos.find((p) => p.id === pedidoId);
  if (!pedido || !novoStatus || novoStatus === pedido.status) {
    pintarRegiaoPedidos();
    return;
  }

  if (novoStatus === "reembolsado") {
    confirmacao = {
      tipo: "reembolsar",
      pedidoId,
      texto: mensagemReembolsar(pedido),
      simLabel: "Devolver",
      status: novoStatus,
    };
    pintarRegiaoPedidos();
    return;
  }

  if (novoStatus === "cancelado") {
    confirmacao = {
      tipo: "cancelar",
      pedidoId,
      texto: mensagemCancelar(pedido),
      simLabel: "Cancelar pedido",
      status: novoStatus,
    };
    pintarRegiaoPedidos();
    return;
  }

  await aplicarStatus(pedidoId, novoStatus);
}

async function aplicarStatus(pedidoId, novoStatus) {
  avisoPedido = "";
  const resultado = await alterarStatusPedido(config, sessao.access_token, pedidoId, novoStatus, fetch);
  if (!resultado.ok) {
    avisoPedido = mensagemDeAcao(resultado.body, "Não foi possível mudar o status.");
    confirmacao = null;
    pintarRegiaoPedidos();
    return;
  }
  const pedido = pedidosBrutos.find((p) => p.id === pedidoId);
  if (pedido) pedido.status = novoStatus;
  confirmacao = null;
  const hist = await listarHistorico(config, sessao.access_token, pedidoId, fetch);
  if (hist.ok) historicoAberto = hist.linhas;
  pintarRegiaoPedidos();
}

async function aplicarReembolso(pedidoId) {
  avisoPedido = "";
  confirmacao = null;
  pintarRegiaoPedidos();
  const resultado = await reembolsarPedido(config, sessao.access_token, pedidoId, fetch);
  if (!resultado.ok) {
    avisoPedido = resultado.rede
      ? "Não consegui falar com o servidor. Tente de novo."
      : mensagemDeAcao(resultado.body, "O reembolso não foi concluído.");
    pintarRegiaoPedidos();
    return;
  }
  const pedido = pedidosBrutos.find((p) => p.id === pedidoId);
  if (pedido) pedido.status = "reembolsado";
  const hist = await listarHistorico(config, sessao.access_token, pedidoId, fetch);
  if (hist.ok) historicoAberto = hist.linhas;
  pintarRegiaoPedidos();
}

async function aplicarApagar(pedidoId) {
  avisoPedido = "";
  const resultado = await apagarPedidoTeste(config, sessao.access_token, pedidoId, fetch);
  if (!resultado.ok) {
    avisoPedido = mensagemDeAcao(resultado.body, "Não foi possível apagar o pedido.");
    confirmacao = null;
    pintarRegiaoPedidos();
    return;
  }
  pedidosBrutos = pedidosBrutos.filter((p) => p.id !== pedidoId);
  fecharDetalhe();
}

async function aplicarNotas(pedidoId) {
  const campo = document.getElementById("notas-pedido");
  const notas = campo ? campo.value : notasRascunho;
  notasRascunho = notas;
  avisoPedido = "";
  const resultado = await salvarNotasPedido(config, sessao.access_token, pedidoId, notas, fetch);
  if (!resultado.ok) {
    avisoPedido = mensagemDeAcao(resultado.body, "Não foi possível salvar as notas.");
    pintarRegiaoPedidos();
    return;
  }
  const pedido = pedidosBrutos.find((p) => p.id === pedidoId);
  if (pedido) pedido.notas_internas = notas;
  avisoPedido = "";
  pintarRegiaoPedidos();
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
  const toggleTestes = event.target.closest("[data-toggle-testes]");
  if (toggleTestes) {
    filtros.mostrarTestes = !filtros.mostrarTestes;
    gravarMostrarTestes(localStorage, filtros.mostrarTestes);
    pintarRegiaoPedidos();
    return;
  }
  const fixarRail = event.target.closest("[data-rail-fixar]");
  if (fixarRail) {
    event.preventDefault();
    railEstado = proximoRail(railEstado);
    gravarRail(localStorage, railEstado);
    const cascaNode = document.querySelector(".casca");
    if (cascaNode) {
      cascaNode.classList.remove("rail-hover");
      aplicarClasseRail(cascaNode);
    }
    return;
  }
  const fechar = event.target.closest("[data-fechar-detalhe]");
  if (fechar) {
    fecharDetalhe();
    return;
  }
  const fundo = event.target.closest("[data-fechar-fundo]");
  if (fundo && event.target === fundo) {
    fecharDetalhe();
    return;
  }
  const nao = event.target.closest("[data-confirmar-nao]");
  if (nao) {
    confirmacao = null;
    pintarRegiaoPedidos();
    return;
  }
  const sim = event.target.closest("[data-confirmar-sim]");
  if (sim) {
    const tipo = sim.getAttribute("data-confirmar-sim");
    const pedidoId = confirmacao && confirmacao.pedidoId;
    if (!pedidoId) return;
    if (tipo === "cancelar") {
      aplicarStatus(pedidoId, "cancelado");
      return;
    }
    if (tipo === "reembolsar") {
      aplicarReembolso(pedidoId);
      return;
    }
    if (tipo === "apagar") {
      aplicarApagar(pedidoId);
      return;
    }
  }
  const salvarNotas = event.target.closest("[data-salvar-notas]");
  if (salvarNotas) {
    aplicarNotas(salvarNotas.getAttribute("data-salvar-notas"));
    return;
  }
  const apagar = event.target.closest("[data-apagar-teste]");
  if (apagar) {
    const pedidoId = apagar.getAttribute("data-apagar-teste");
    const pedido = pedidosBrutos.find((p) => p.id === pedidoId);
    confirmacao = {
      tipo: "apagar",
      pedidoId,
      texto: mensagemApagarTeste(pedido),
      simLabel: "Apagar",
    };
    pintarRegiaoPedidos();
    return;
  }
  const wa = event.target.closest("a.wa, .detalhe a[href^='https://wa.me']");
  if (wa) {
    event.stopPropagation();
    return;
  }
  const linha = event.target.closest("[data-pedido]");
  if (linha && !event.target.closest(".detalhe")) {
    event.preventDefault();
    abrirPedido(linha.getAttribute("data-pedido"));
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

app.addEventListener("change", (event) => {
  const statusSel = event.target.closest("[data-status-pedido]");
  if (statusSel) {
    pedirMudancaStatus(statusSel.getAttribute("data-status-pedido"), statusSel.value);
    return;
  }
  const form = event.target.closest("#filtros-pedidos");
  if (form) lerFiltrosDoForm(form);
});

app.addEventListener("input", (event) => {
  if (event.target && event.target.id === "notas-pedido") {
    notasRascunho = event.target.value;
    return;
  }
  const form = event.target.closest("#filtros-pedidos");
  if (form && event.target.name === "busca") {
    lerFiltrosDoForm(form);
  }
});

app.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && pedidoAbertoId) {
    event.preventDefault();
    fecharDetalhe();
    return;
  }
  const linha = event.target.closest("[data-pedido]");
  if (linha && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    abrirPedido(linha.getAttribute("data-pedido"));
  }
});

app.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (form.id === "form-entrar") {
    event.preventDefault();
    enviarEntrada(form);
    return;
  }
  if (form.id === "filtros-pedidos") {
    event.preventDefault();
    lerFiltrosDoForm(form);
  }
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
  filtros.mostrarTestes = lerMostrarTestes(localStorage);
  railEstado = lerRail(localStorage);
  exigirEntrada();
  pintar();
});
