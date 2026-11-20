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
  confirmarReembolso,
  emailEhAdmin,
  entrar,
  filtrarPedidos,
  filtrosVazios,
  formatarCpf,
  formatarData,
  formatarEnderecoCompleto,
  formatarPreco,
  formatarTelefone,
  formatarVelas,
  chamarEtiquetas,
  linkRastreio,
  notificarCliente,
  podeGerarEtiqueta,
  podeImprimirEtiqueta,
  precisaConferirEtiqueta,
  resumoEtiquetas,
  rotuloMeStatus,
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
  mensagemJaReembolsado,
  mensagemReembolsar,
  nivelStatus,
  normalizarCaminho,
  opcoesStatus,
  proximoRail,
  reembolsarPedido,
  METRICA_REAIS,
  ajusteEstoque,
  agruparClientes,
  agruparEstoque,
  deslocarMes,
  entradaProducao,
  filtrarClientes,
  juntarEstoque,
  listarAvisos,
  listarLinhasEstoque,
  listarMovimentos,
  listarProdutos,
  dispararAvisos,
  resolverAviso,
  mensagemDeLeitura,
  mesAtualSp,
  periodoMes,
  podeAvancarMes,
  renovar,
  resumoInicio,
  resumoPedidos,
  rotuloDia,
  rotuloEntrega,
  rotuloMes,
  rotuloOrigem,
  rotuloRail,
  rotuloStatus,
  sair,
  salvarNotasPedido,
  serieVendas,
  sessaoPrecisaRenovar,
  tituloDaRota,
  validarAjuste,
  validarEntrada,
  validarMotivo,
  validarPeriodo,
} from "./painel.mjs";
import { mioloAvisos, mioloClientes, mioloEstoque, mioloInicio, paginaAvisos, paginaClientes, paginaEstoque, paginaInicio } from "./telas.mjs";

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
let etiquetasUi = null;
let notasRascunho = "";
let railEstado = RAIL_AUTO;
let railHoverTimer = 0;
const RAIL_HOVER_MS = 300;

let cargaInicio = 0;
let cargaEstoque = 0;
let cargaClientes = 0;
let cargaAvisos = 0;
let pedidosInicio = [];
let velasBrutas = [];
let inicioTipo = "carregando";
let inicioMensagem = "";
let inicioErroEstoque = "";
let estoqueTipo = "carregando";
let estoqueMensagem = "";
let clientesTipo = "carregando";
let clientesMensagem = "";
let avisosTipo = "carregando";
let avisosMensagem = "";
let avisosLista = [];
let avisoAvisos = "";
let avisoSalvandoId = "";
let velaAbertaId = "";
let movimentosAbertos = [];
let historicoEstoqueCarregando = false;
let avisoEstoque = "";
let notaEstoque = "";
let estoqueSalvando = false;
let rascunhoQuantidade = "";
let rascunhoObs = "";
let rascunhoAjuste = null;
let rascunhoMotivo = "";
let clienteAbertoChave = "";
let buscaCliente = "";
let graficoMetrica = METRICA_REAIS;
let graficoAno = null;
let graficoMes = null;
let graficoPersonalizado = false;
let graficoDe = "";
let graficoAte = "";
let graficoDia = "";
let avisoPeriodo = "";

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
  avisos: ["M6 9a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9", "M10 21a2 2 0 0 0 4 0"],
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
      // Glyph monocromático do WhatsApp (preenchido, herda a cor do tema).
      d: "M12.04 2C6.58 2 2.15 6.4 2.15 11.83c0 1.99.59 3.84 1.6 5.4L2 22l4.95-1.63a9.9 9.9 0 0 0 5.09 1.4h.01c5.46 0 9.89-4.4 9.89-9.84C21.94 6.4 17.5 2 12.04 2zm5.76 14.04c-.24.68-1.4 1.25-1.94 1.33-.5.07-1.13.1-1.82-.11-.42-.13-.96-.31-1.65-.61-2.9-1.25-4.78-4.17-4.93-4.36-.14-.2-1.18-1.57-1.18-3 0-1.42.74-2.12 1-2.41.26-.29.57-.36.76-.36h.55c.17 0 .4-.06.62.48.24.56.8 1.94.87 2.08.07.14.12.3.02.48-.1.2-.15.32-.29.49-.14.17-.3.38-.43.51-.14.14-.29.29-.12.56.16.28.73 1.2 1.56 1.94 1.07.96 1.97 1.26 2.25 1.4.28.14.44.12.6-.07.17-.2.7-.81.89-1.09.19-.28.37-.23.63-.14.26.1 1.64.77 1.92.91.28.14.47.21.54.32.07.12.07.68-.17 1.36z",
      fill: "currentColor",
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
  // Selo Ō do favicon, versão clara para o fundo escuro do rail.
  return svgEl("svg", {
    class: "marca-selo-svg",
    viewBox: "142 85 796 910",
    width: "28",
    height: "32",
    "aria-hidden": "true",
    focusable: "false",
  }, [
    svgEl("path", {
      class: "selo-o",
      d: "M158.4,611c0-217.13,162.85-383.23,386.48-383.23,250.78,0,376.72,181.3,376.72,372.37C921.6,819.42,754.41,979,544.88,979,303.88,979,158.4,806.39,158.4,611ZM813,633.77c0-179.13-79.26-372.36-286.61-372.36C413.52,261.41,267,338.49,267,576.24c0,160.67,78.17,369.11,292,369.11C689.27,945.35,813,847.64,813,633.77Z",
      fill: "currentColor",
    }),
    svgEl("rect", {
      class: "selo-barra",
      x: "349.12",
      y: "101",
      width: "377.53",
      height: "59.81",
      rx: "0.99",
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
    ["/avisos", "Avisos", "avisos"],
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

function limparSobrepostos() {
  pedidoAbertoId = "";
  historicoAberto = [];
  avisoPedido = "";
  confirmacao = null;
  notasRascunho = "";
  velaAbertaId = "";
  clienteAbertoChave = "";
  movimentosAbertos = [];
  avisoEstoque = "";
  notaEstoque = "";
  rascunhoQuantidade = "";
  rascunhoObs = "";
  rascunhoAjuste = null;
  rascunhoMotivo = "";
  document.body.classList.remove("detalhe-aberto");
}

function sincronizarSobreposto() {
  const aberto = Boolean(pedidoAbertoId || velaAbertaId || clienteAbertoChave);
  document.body.classList.toggle("detalhe-aberto", aberto);
}

function pontoStatus(nivel) {
  return el("span", { class: "ponto", "data-nivel": nivel, "aria-hidden": "true" });
}

function seloTeste() {
  return el("span", { class: "selo", text: "teste" });
}

function vista(linha) {
  const data = formatarData(linha.created_at);
  const telefone = formatarTelefone(linha.cliente_telefone);
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
    telefone,
    wa,
  };
}

function rotuloWa(nome) {
  const pessoa = typeof nome === "string" ? nome.trim() : "";
  return pessoa && pessoa !== "—"
    ? `Abrir WhatsApp de ${pessoa}`
    : "Abrir WhatsApp";
}

function botaoWa(wa, nome) {
  if (!wa) return null;
  const rotulo = rotuloWa(nome);
  const a = el("a", {
    class: "wa",
    href: wa,
    target: "_blank",
    rel: "noopener noreferrer",
    "aria-label": rotulo,
    title: rotulo,
  });
  a.append(iconeWhatsApp());
  return a;
}

function linkWaComNumero(wa, nome, telefone) {
  if (!wa || !telefone) return null;
  const rotulo = rotuloWa(nome);
  const a = el("a", {
    class: "wa wa-com-numero",
    href: wa,
    target: "_blank",
    rel: "noopener noreferrer",
    "aria-label": rotulo,
    title: rotulo,
  });
  a.append(document.createTextNode(telefone), iconeWhatsApp());
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
    el("th", { scope: "col", class: "th-contato", text: "WhatsApp" }),
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
      el("td", { "data-campo": "contato" }, [botaoWa(item.wa, item.cliente)]),
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
          ...(item.wa && item.telefone
            ? [
              el("dt", { text: "WhatsApp" }),
              el("dd", {}, [linkWaComNumero(item.wa, item.cliente, item.telefone)]),
            ]
            : []),
        ]),
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
  const telefoneFmt = formatarTelefone(pedido.cliente_telefone);
  const wa = linkWhatsApp(pedido.cliente_telefone);
  const waValor = linkWaComNumero(wa, pedido.cliente_nome, telefoneFmt) || tracoOu("");
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
        el("span", { class: "hist-origem", text: rotuloOrigem(h.origem) }),
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
          text: confirmacao.naoLabel || "Voltar",
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
      campoDetalhe("WhatsApp", waValor),
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
      pedido.entrega_tipo === "envio"
        ? campoDetalhe(
          "Rastreio",
          pedido.rastreio
            ? el("span", { class: "rastreio-valor" }, [
              el("span", { class: "codigo", text: pedido.rastreio }),
              linkRastreio(frete.transportadora, pedido.rastreio)
                ? el("a", {
                  class: "rastreio-link",
                  href: linkRastreio(frete.transportadora, pedido.rastreio),
                  target: "_blank",
                  rel: "noopener noreferrer",
                  text: "Acompanhar",
                })
                : null,
            ])
            : tracoOu(""),
        )
        : null,
      pedido.me_status
        ? campoDetalhe("Melhor Envio", tracoOu(rotuloMeStatus(pedido.me_status)))
        : null,
    ].filter(Boolean)),
    pedido.entrega_tipo === "envio" && !pedido.teste
      ? el("div", { class: "detalhe-bloco" }, [
        el("h3", { text: "Etiqueta" }),
        precisaConferirEtiqueta(pedido)
          ? el("p", {
            class: "alerta",
            role: "alert",
            text: "Essa etiqueta pode já estar paga. Não compre outra. Confira no Melhor Envio.",
          })
          : null,
        precisaConferirEtiqueta(pedido)
          ? el("button", {
            type: "button",
            class: "botao",
            "data-conferir-etiqueta": pedido.id,
            text: "Conferir etiqueta",
          })
          : null,
        podeGerarEtiqueta(pedido)
          ? el("button", {
            type: "button",
            class: "botao",
            "data-gerar-etiqueta": pedido.id,
            text: pedido.me_order_id ? "Gerar rastreio" : "Gerar etiqueta",
          })
          : null,
        podeImprimirEtiqueta(pedido)
          ? el("div", { class: "acoes-etiquetas" }, [
            el("button", {
              type: "button",
              class: "botao",
              "data-imprimir-uma": "a4",
              "data-pedido-id": pedido.id,
              text: "Imprimir em A4",
            }),
            el("button", {
              type: "button",
              class: "botao botao-secundario",
              "data-imprimir-uma": "termica",
              "data-pedido-id": pedido.id,
              text: "Imprimir na térmica",
            }),
          ])
          : null,
      ])
      : null,
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
    dialogoEtiquetas(),
  ]);
}

function paginaPedidos(estado) {
  return el("div", { class: "pagina pagina-pedidos" }, [
    titulo("Pedidos"),
    el("div", { class: "acoes-pedidos" }, [
      el("button", {
        type: "button",
        class: "botao",
        "data-etiquetas-quarta": "1",
        text: "Gerar etiquetas da quarta",
      }),
      el("button", {
        type: "button",
        class: "botao botao-secundario",
        "data-imprimir-lote": "1",
        text: "Imprimir etiquetas",
      }),
    ]),
    el("div", { id: "regiao-pedidos" }, [mioloPedidos(estado)]),
  ]);
}

function dialogoEtiquetas() {
  if (!etiquetasUi) return null;
  const ui = etiquetasUi;
  let corpo = [];
  if (ui.fase === "carregando" || ui.fase === "comprando" || ui.fase === "imprimindo") {
    const texto = ui.fase === "comprando"
      ? "Comprando as etiquetas no Melhor Envio."
      : ui.fase === "imprimindo"
      ? "Pedindo o PDF."
      : "Conferindo saldo e pedidos.";
    corpo = [el("p", { text: texto }), el("span", { class: "barra" })];
  } else if (ui.fase === "erro") {
    corpo = [
      el("p", { class: "alerta", role: "alert", text: ui.mensagem || "Não deu certo." }),
      el("button", { type: "button", class: "botao-texto", "data-etiquetas-fechar": "1", text: "Fechar" }),
    ];
  } else if (ui.fase === "resumo") {
    const resumo = resumoEtiquetas(ui.resumo || {});
    const fora = Array.isArray(ui.resumo && ui.resumo.fora) ? ui.resumo.fora : [];
    corpo = [
      el("p", { text: resumo.frase }),
      ui.resumo && ui.resumo.quantidade
        ? el("p", { text: "Custo no Melhor Envio: " + resumo.custo + "." })
        : null,
      el("p", { text: "Saldo: " + resumo.saldo + "." }),
      resumo.falta
        ? el("p", { class: "alerta", role: "alert", text: "Falta " + resumo.falta + " no saldo. Não vou comprar." })
        : null,
      ui.resumo && ui.resumo.remetente_ok === false
        ? el("p", { class: "alerta", role: "alert", text: "Faltam os dados do remetente. Não vou comprar." })
        : null,
      fora.length
        ? el("ul", { class: "fora-lista" }, fora.map((item) =>
          el("li", { text: (item.codigo ? "#" + item.codigo + ": " : "") + (item.motivo || "Ficou de fora.") })
        ))
        : null,
      Array.isArray(ui.resumo && ui.resumo.conferir) && ui.resumo.conferir.length
        ? el("p", {
          class: "alerta",
          role: "alert",
          text: "Algum pedido precisa de conferência. Não compre outra etiqueta para ele.",
        })
        : null,
      Array.isArray(ui.resumo && ui.resumo.conferir)
        ? el("div", { class: "confirmacao-acoes" }, ui.resumo.conferir.map((item) =>
          el("button", {
            type: "button",
            class: "botao botao-secundario",
            "data-conferir-etiqueta": item.id,
            text: "Conferir etiqueta" + (item.codigo ? " #" + item.codigo : ""),
          })
        ))
        : null,
      el("div", { class: "confirmacao-acoes" }, [
        resumo.podeComprar
          ? el("button", {
            type: "button",
            class: "botao",
            "data-etiquetas-comprar": "1",
            text: ui.resumo && ui.resumo.quantidade > 0 ? "Comprar etiquetas" : "Gerar rastreio",
          })
          : null,
        el("button", { type: "button", class: "botao-texto", "data-etiquetas-fechar": "1", text: "Voltar" }),
      ]),
    ];
  } else if (ui.fase === "pronto") {
    corpo = [
      el("p", { text: ui.mensagem || "Etiquetas geradas." }),
      el("div", { class: "confirmacao-acoes" }, [
        el("button", { type: "button", class: "botao", "data-imprimir-formato": "a4", text: "Imprimir em A4" }),
        el("button", {
          type: "button",
          class: "botao botao-secundario",
          "data-imprimir-formato": "termica",
          text: "Imprimir na térmica",
        }),
        el("button", { type: "button", class: "botao-texto", "data-etiquetas-fechar": "1", text: "Fechar" }),
      ]),
    ];
  } else if (ui.fase === "formato") {
    corpo = [
      el("p", { text: ui.mensagem || "Escolha o papel. Sai um PDF só, com todas as etiquetas." }),
      el("div", { class: "confirmacao-acoes" }, [
        el("button", { type: "button", class: "botao", "data-imprimir-formato": "a4", text: "Imprimir em A4" }),
        el("button", {
          type: "button",
          class: "botao botao-secundario",
          "data-imprimir-formato": "termica",
          text: "Imprimir na térmica",
        }),
        el("button", { type: "button", class: "botao-texto", "data-etiquetas-fechar": "1", text: "Voltar" }),
      ]),
    ];
  }
  return el("div", { class: "etiquetas-camada", "data-etiquetas-fundo": "1" }, [
    el("div", {
      class: "dialogo-etiquetas",
      role: "alertdialog",
      "aria-modal": "true",
      "aria-labelledby": "etiquetas-titulo",
    }, [
      el("h2", { id: "etiquetas-titulo", tabindex: "-1", text: ui.titulo || "Etiquetas da quarta" }),
      ...corpo,
    ]),
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

function pintarRegiao() {
  const caminho = caminhoAgora();
  if (caminho === "/pedidos") renderPedidos();
  else if (caminho === "/") pintarRegiaoInicio();
  else if (caminho === "/estoque") pintarRegiaoEstoque();
  else if (caminho === "/clientes") pintarRegiaoClientes();
  else if (caminho === "/avisos") pintarRegiaoAvisos();
}

function renderPedidos() {
  const regiao = document.getElementById("regiao-pedidos");
  if (!regiao) return;
  regiao.replaceChildren(mioloPedidos({ tipo: "pronto", linhas: pedidosBrutos }));
  if (pedidoAbertoId && caminhoAgora() === "/pedidos") {
    const fechar = document.querySelector("[data-fechar-detalhe]");
    if (fechar && document.activeElement !== fechar) fechar.focus();
  }
}

function fecharDetalhe() {
  pedidoAbertoId = "";
  historicoAberto = [];
  avisoPedido = "";
  confirmacao = null;
  notasRascunho = "";
  sincronizarSobreposto();
  pintarRegiao();
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
  pintarRegiao();

  const hist = await listarHistorico(config, sessao.access_token, id, fetch);
  if (pedidoAbertoId !== id) return;
  if (hist.ok) historicoAberto = hist.linhas;
  pintarRegiao();
  if (caminhoAgora() === "/clientes") {
    const fecharPedido = document.querySelector("[data-fechar-detalhe]");
    if (fecharPedido) fecharPedido.focus();
  }
}

function garantirMesGrafico(agora = new Date()) {
  if (graficoAno == null || graficoMes == null) {
    const atual = mesAtualSp(agora);
    graficoAno = atual.ano;
    graficoMes = atual.mes;
  }
}

function periodoAtual(agora = new Date()) {
  if (graficoPersonalizado && graficoDe && graficoAte) {
    return { de: graficoDe, ate: graficoAte };
  }
  garantirMesGrafico(agora);
  return periodoMes(graficoAno, graficoMes);
}

function estadoInicio(agora = new Date()) {
  const periodo = periodoAtual(agora);
  const serie = serieVendas(pedidosInicio, periodo.de, periodo.ate, graficoMetrica);
  if (graficoDia && !serie.pontos.some((ponto) => ponto.dia === graficoDia)) graficoDia = "";
  return {
    tipo: inicioTipo,
    mensagem: inicioMensagem,
    erroEstoque: inicioErroEstoque,
    resumo: resumoInicio(pedidosInicio, agora),
    grupos: agruparEstoque(velasBrutas),
    serie,
    metrica: graficoMetrica,
    tituloPeriodo: graficoPersonalizado
      ? rotuloDia(periodo.de) + " – " + rotuloDia(periodo.ate)
      : rotuloMes(graficoAno, graficoMes),
    personalizado: graficoPersonalizado,
    podeVoltar: !graficoPersonalizado,
    podeAvancar: !graficoPersonalizado && podeAvancarMes(graficoAno, graficoMes, agora),
    de: periodo.de,
    ate: periodo.ate,
    diaAtivo: graficoDia,
    avisoPeriodo,
  };
}

function larguraDoGrafico(regiao) {
  const pagina = regiao.closest(".pagina") || regiao;
  const estilo = getComputedStyle(pagina);
  const pad = (parseFloat(estilo.paddingLeft) || 0) + (parseFloat(estilo.paddingRight) || 0);
  return Math.max(280, Math.round(pagina.clientWidth - pad));
}

function pintarRegiaoInicio() {
  const regiao = document.getElementById("regiao-inicio");
  if (!regiao) return;
  const estado = estadoInicio();
  estado.largura = larguraDoGrafico(regiao);
  regiao.replaceChildren(mioloInicio(estado));
}

function estadoEstoque() {
  const grupos = agruparEstoque(velasBrutas);
  const vela = velasBrutas.find((item) => item.id === velaAbertaId) || null;
  return {
    tipo: estoqueTipo,
    mensagem: estoqueMensagem,
    grupos,
    vela,
    movimentos: movimentosAbertos,
    historicoCarregando: historicoEstoqueCarregando,
    aviso: avisoEstoque,
    nota: notaEstoque,
    salvando: estoqueSalvando,
    rascunhoQuantidade,
    rascunhoObs,
    rascunhoAjuste,
    rascunhoMotivo,
  };
}

function pintarRegiaoEstoque() {
  const regiao = document.getElementById("regiao-estoque");
  if (!regiao) return;
  const ativo = document.activeElement;
  const idAtivo = ativo && ativo.id ? ativo.id : "";
  const selecao = ativo && typeof ativo.selectionStart === "number" ? ativo.selectionStart : null;
  regiao.replaceChildren(mioloEstoque(estadoEstoque()));
  if (idAtivo) {
    const novo = document.getElementById(idAtivo);
    if (novo) {
      novo.focus();
      if (selecao != null && novo.setSelectionRange) {
        const fim = Math.min(selecao, novo.value.length);
        novo.setSelectionRange(fim, fim);
      }
    }
  }
}

function clientesAgrupados() {
  return agruparClientes(pedidosBrutos);
}

function estadoClientes() {
  const todos = clientesAgrupados();
  const clientes = filtrarClientes(todos, buscaCliente);
  const cliente = todos.find((item) => item.chave === clienteAbertoChave) || null;
  const pedido = pedidosBrutos.find((item) => item.id === pedidoAbertoId) || null;
  return {
    tipo: clientesTipo,
    mensagem: clientesMensagem,
    clientes,
    total: todos.length,
    busca: buscaCliente,
    cliente,
    detalhePedido: pedido ? painelDetalhe(pedido) : null,
  };
}

function pintarRegiaoClientes() {
  const regiao = document.getElementById("regiao-clientes");
  if (!regiao) return;
  const campo = document.getElementById("busca-clientes-campo");
  const tinhaFoco = campo && document.activeElement === campo;
  const selecao = campo ? campo.selectionStart : null;
  regiao.replaceChildren(mioloClientes(estadoClientes()));
  if (tinhaFoco) {
    const novo = document.getElementById("busca-clientes-campo");
    if (novo) {
      novo.focus();
      if (selecao != null && novo.setSelectionRange) novo.setSelectionRange(selecao, selecao);
    }
  }
}

async function renovarSePreciso(resposta) {
  const codigo = resposta && resposta.body && resposta.body.code;
  if (!resposta || resposta.ok || resposta.abortado || resposta.rede || resposta.status !== 401 || codigo === "42501") {
    return "segue";
  }
  const renovada = await renovar(config, sessao, fetch, Date.now());
  if (!renovada.ok) {
    sessao = null;
    limparSessao(localStorage);
    avisoEntrada = "A sessão expirou. Entre de novo.";
    ir("/entrar", { substituir: true });
    return "saiu";
  }
  sessao = renovada.sessao;
  gravarSessao(localStorage, sessao);
  return "renovou";
}

async function carregarInicio() {
  const id = ++cargaInicio;
  inicioTipo = "carregando";
  const sinal = undefined;
  let pedidos = await listarPedidos(config, sessao.access_token, fetch, sinal);
  let produtos = await listarProdutos(config, sessao.access_token, fetch, sinal);
  let linhas = await listarLinhasEstoque(config, sessao.access_token, fetch, sinal);
  if (id !== cargaInicio || caminhoAgora() !== "/") return;
  const algum401 = [pedidos, produtos, linhas].find((item) => item.status === 401 && !(item.body && item.body.code === "42501"));
  if (algum401) {
    const seguiu = await renovarSePreciso(algum401);
    if (seguiu === "saiu" || id !== cargaInicio || caminhoAgora() !== "/") return;
    if (seguiu === "renovou") {
      pedidos = await listarPedidos(config, sessao.access_token, fetch, sinal);
      produtos = await listarProdutos(config, sessao.access_token, fetch, sinal);
      linhas = await listarLinhasEstoque(config, sessao.access_token, fetch, sinal);
      if (id !== cargaInicio || caminhoAgora() !== "/") return;
    }
  }
  if (!pedidos.ok) {
    inicioTipo = "erro";
    inicioMensagem = pedidos.rede
      ? "Não consegui falar com o servidor. Tente de novo."
      : mensagemDeLeitura(pedidos.status, pedidos.body, "do início");
    pintarRegiaoInicio();
    const alerta = document.querySelector("#regiao-inicio [role=alert]");
    if (alerta) alerta.focus();
    return;
  }
  pedidosInicio = pedidos.linhas;
  if (produtos.ok && linhas.ok) {
    velasBrutas = juntarEstoque(produtos.linhas, linhas.linhas);
    inicioErroEstoque = "";
  } else {
    velasBrutas = [];
    const falha = !produtos.ok ? produtos : linhas;
    inicioErroEstoque = falha.rede
      ? "Não consegui falar com o servidor. Tente de novo."
      : mensagemDeLeitura(falha.status, falha.body, "do estoque");
  }
  inicioTipo = "pronto";
  garantirMesGrafico();
  pintarRegiaoInicio();
}

async function carregarEstoque() {
  const id = ++cargaEstoque;
  estoqueTipo = "carregando";
  let produtos = await listarProdutos(config, sessao.access_token, fetch);
  let linhas = await listarLinhasEstoque(config, sessao.access_token, fetch);
  if (id !== cargaEstoque || caminhoAgora() !== "/estoque") return;
  const algum401 = [produtos, linhas].find((item) => item.status === 401 && !(item.body && item.body.code === "42501"));
  if (algum401) {
    const seguiu = await renovarSePreciso(algum401);
    if (seguiu === "saiu" || id !== cargaEstoque || caminhoAgora() !== "/estoque") return;
    if (seguiu === "renovou") {
      produtos = await listarProdutos(config, sessao.access_token, fetch);
      linhas = await listarLinhasEstoque(config, sessao.access_token, fetch);
      if (id !== cargaEstoque || caminhoAgora() !== "/estoque") return;
    }
  }
  if (!produtos.ok || !linhas.ok) {
    const falha = !produtos.ok ? produtos : linhas;
    estoqueTipo = "erro";
    estoqueMensagem = falha.rede
      ? "Não consegui falar com o servidor. Tente de novo."
      : mensagemDeLeitura(falha.status, falha.body, "do estoque");
    pintarRegiaoEstoque();
    const alerta = document.querySelector("#regiao-estoque [role=alert]");
    if (alerta) alerta.focus();
    return;
  }
  velasBrutas = juntarEstoque(produtos.linhas, linhas.linhas);
  if (velaAbertaId && !velasBrutas.some((vela) => vela.id === velaAbertaId)) velaAbertaId = "";
  estoqueTipo = "pronto";
  pintarRegiaoEstoque();
}

async function carregarClientes() {
  const id = ++cargaClientes;
  clientesTipo = "carregando";
  let resposta = await listarPedidos(config, sessao.access_token, fetch);
  if (id !== cargaClientes || caminhoAgora() !== "/clientes") return;
  const seguiu = await renovarSePreciso(resposta);
  if (seguiu === "saiu" || id !== cargaClientes || caminhoAgora() !== "/clientes") return;
  if (seguiu === "renovou") {
    resposta = await listarPedidos(config, sessao.access_token, fetch);
    if (id !== cargaClientes || caminhoAgora() !== "/clientes") return;
  }
  if (!resposta.ok) {
    clientesTipo = "erro";
    clientesMensagem = resposta.rede
      ? "Não consegui falar com o servidor. Tente de novo."
      : mensagemDeLeitura(resposta.status, resposta.body, "dos clientes");
    pintarRegiaoClientes();
    const alerta = document.querySelector("#regiao-clientes [role=alert]");
    if (alerta) alerta.focus();
    return;
  }
  pedidosBrutos = resposta.linhas;
  if (clienteAbertoChave && !clientesAgrupados().some((cliente) => cliente.chave === clienteAbertoChave)) {
    clienteAbertoChave = "";
  }
  clientesTipo = "pronto";
  pintarRegiaoClientes();
}

function estadoAvisos() {
  return {
    tipo: avisosTipo,
    mensagem: avisosMensagem,
    avisos: avisosLista,
    aviso: avisoAvisos,
    salvandoId: avisoSalvandoId,
  };
}

function pintarRegiaoAvisos() {
  const regiao = document.getElementById("regiao-avisos");
  if (!regiao) return;
  regiao.replaceChildren(mioloAvisos(estadoAvisos()));
}

async function carregarAvisos() {
  const id = ++cargaAvisos;
  avisosTipo = "carregando";
  dispararAvisos(config, sessao.access_token, fetch);
  let resposta = await listarAvisos(config, sessao.access_token, fetch);
  if (id !== cargaAvisos || caminhoAgora() !== "/avisos") return;
  const seguiu = await renovarSePreciso(resposta);
  if (seguiu === "saiu" || id !== cargaAvisos || caminhoAgora() !== "/avisos") return;
  if (seguiu === "renovou") {
    resposta = await listarAvisos(config, sessao.access_token, fetch);
    if (id !== cargaAvisos || caminhoAgora() !== "/avisos") return;
  }
  if (!resposta.ok) {
    avisosTipo = "erro";
    avisosMensagem = resposta.rede
      ? "Não consegui falar com o servidor. Tente de novo."
      : mensagemDeLeitura(resposta.status, resposta.body, "dos avisos");
    pintarRegiaoAvisos();
    const alerta = document.querySelector("#regiao-avisos [role=alert]");
    if (alerta) alerta.focus();
    return;
  }
  avisosLista = resposta.linhas;
  avisosTipo = "pronto";
  pintarRegiaoAvisos();
}

async function alternarAviso(id, resolvidoAgora) {
  if (!id || avisoSalvandoId) return;
  avisoSalvandoId = id;
  avisoAvisos = "";
  pintarRegiaoAvisos();
  const resultado = await resolverAviso(config, sessao.access_token, id, !resolvidoAgora, fetch);
  avisoSalvandoId = "";
  if (!resultado.ok) {
    avisoAvisos = resultado.rede
      ? "Não consegui falar com o servidor. Tente de novo."
      : mensagemDeAcao(resultado.body, "Não foi possível atualizar o aviso.");
    pintarRegiaoAvisos();
    return;
  }
  const aviso = avisosLista.find((item) => item.id === id);
  if (aviso) aviso.resolvido = !resolvidoAgora;
  avisosLista = [...avisosLista].sort((a, b) => {
    if (a.resolvido !== b.resolvido) return a.resolvido ? 1 : -1;
    return new Date(b.created_at) - new Date(a.created_at);
  });
  pintarRegiaoAvisos();
  const botoes = document.querySelectorAll('[data-resolver-aviso="' + id + '"]');
  const visivel = [...botoes].find((botao) => botao.offsetParent !== null);
  if (visivel) visivel.focus();
}

function fecharVela() {
  velaAbertaId = "";
  movimentosAbertos = [];
  avisoEstoque = "";
  notaEstoque = "";
  historicoEstoqueCarregando = false;
  rascunhoQuantidade = "";
  rascunhoObs = "";
  rascunhoAjuste = null;
  rascunhoMotivo = "";
  sincronizarSobreposto();
  pintarRegiaoEstoque();
}

async function abrirVela(id) {
  if (!id) return;
  if (velaAbertaId === id) {
    fecharVela();
    return;
  }
  velaAbertaId = id;
  movimentosAbertos = [];
  avisoEstoque = "";
  notaEstoque = "";
  rascunhoQuantidade = "";
  rascunhoObs = "";
  rascunhoAjuste = null;
  rascunhoMotivo = "";
  historicoEstoqueCarregando = true;
  sincronizarSobreposto();
  pintarRegiaoEstoque();
  const fechar = document.querySelector("[data-fechar-vela]");
  if (fechar) fechar.focus();
  const resposta = await listarMovimentos(config, sessao.access_token, id, fetch);
  if (velaAbertaId !== id) return;
  historicoEstoqueCarregando = false;
  if (resposta.ok) movimentosAbertos = resposta.linhas;
  else {
    avisoEstoque = resposta.rede
      ? "Não consegui falar com o servidor. Tente de novo."
      : mensagemDeLeitura(resposta.status, resposta.body, "do histórico");
  }
  pintarRegiaoEstoque();
}

function fecharCliente() {
  clienteAbertoChave = "";
  pedidoAbertoId = "";
  historicoAberto = [];
  avisoPedido = "";
  confirmacao = null;
  notasRascunho = "";
  sincronizarSobreposto();
  pintarRegiaoClientes();
}

function abrirCliente(chave) {
  if (!chave) return;
  if (clienteAbertoChave === chave && !pedidoAbertoId) {
    fecharCliente();
    return;
  }
  clienteAbertoChave = chave;
  pedidoAbertoId = "";
  historicoAberto = [];
  avisoPedido = "";
  confirmacao = null;
  sincronizarSobreposto();
  pintarRegiaoClientes();
  const fechar = document.querySelector("[data-fechar-cliente]");
  if (fechar) fechar.focus();
}

async function registrarEntrada(form) {
  const produtoId = form.getAttribute("data-produto");
  const quantidade = form.quantidade.value;
  const observacao = form.observacao.value;
  rascunhoQuantidade = quantidade;
  rascunhoObs = observacao;
  const erro = validarEntrada(quantidade) || validarMotivo(observacao);
  if (erro) {
    avisoEstoque = erro;
    notaEstoque = "";
    pintarRegiaoEstoque();
    return;
  }
  estoqueSalvando = true;
  avisoEstoque = "";
  notaEstoque = "";
  pintarRegiaoEstoque();
  const resultado = await entradaProducao(
    config,
    sessao.access_token,
    produtoId,
    Number(quantidade),
    observacao.trim(),
    fetch,
  );
  estoqueSalvando = false;
  if (!resultado.ok) {
    avisoEstoque = resultado.rede
      ? "Não consegui falar com o servidor. Tente de novo."
      : mensagemDeAcao(resultado.body, "Não foi possível registrar a entrada.");
    pintarRegiaoEstoque();
    return;
  }
  rascunhoQuantidade = "";
  rascunhoObs = "";
  notaEstoque = "Entrada registrada.";
  dispararAvisos(config, sessao.access_token, fetch);
  await carregarEstoque();
  if (velaAbertaId === produtoId) {
    historicoEstoqueCarregando = true;
    pintarRegiaoEstoque();
    const movs = await listarMovimentos(config, sessao.access_token, produtoId, fetch);
    historicoEstoqueCarregando = false;
    if (movs.ok) movimentosAbertos = movs.linhas;
    pintarRegiaoEstoque();
  }
}

async function enviarAjuste(form) {
  const produtoId = form.getAttribute("data-produto");
  const disponivel = form.disponivel.value;
  const motivo = form.motivo.value;
  rascunhoAjuste = disponivel;
  rascunhoMotivo = motivo;
  const erro = validarAjuste(disponivel) || validarMotivo(motivo);
  if (erro) {
    avisoEstoque = erro;
    notaEstoque = "";
    pintarRegiaoEstoque();
    return;
  }
  estoqueSalvando = true;
  avisoEstoque = "";
  notaEstoque = "";
  pintarRegiaoEstoque();
  const resultado = await ajusteEstoque(
    config,
    sessao.access_token,
    produtoId,
    Number(disponivel),
    motivo.trim(),
    fetch,
  );
  estoqueSalvando = false;
  if (!resultado.ok) {
    avisoEstoque = resultado.rede
      ? "Não consegui falar com o servidor. Tente de novo."
      : mensagemDeAcao(resultado.body, "Não foi possível ajustar o estoque.");
    pintarRegiaoEstoque();
    return;
  }
  rascunhoAjuste = null;
  rascunhoMotivo = "";
  notaEstoque = resultado.body && resultado.body.ja ? "O disponível já estava nesse número." : "Ajuste registrado.";
  if (!(resultado.body && resultado.body.ja)) dispararAvisos(config, sessao.access_token, fetch);
  await carregarEstoque();
  if (velaAbertaId === produtoId) {
    const movs = await listarMovimentos(config, sessao.access_token, produtoId, fetch);
    if (movs.ok) movimentosAbertos = movs.linhas;
    pintarRegiaoEstoque();
  }
}

function aplicarPeriodo(form) {
  const dados = new FormData(form);
  const de = String(dados.get("de") || "");
  const ate = String(dados.get("ate") || "");
  const erro = validarPeriodo(de, ate);
  if (erro) {
    avisoPeriodo = erro;
    pintarRegiaoInicio();
    return;
  }
  graficoPersonalizado = true;
  graficoDe = de;
  graficoAte = ate;
  graficoDia = "";
  avisoPeriodo = "";
  pintarRegiaoInicio();
}

function moverMes(delta) {
  if (graficoPersonalizado) return;
  garantirMesGrafico();
  if (delta > 0 && !podeAvancarMes(graficoAno, graficoMes, new Date())) return;
  const proximo = deslocarMes(graficoAno, graficoMes, delta);
  graficoAno = proximo.ano;
  graficoMes = proximo.mes;
  graficoDia = "";
  avisoPeriodo = "";
  pintarRegiaoInicio();
}

function voltarEsteMes() {
  const atual = mesAtualSp(new Date());
  graficoAno = atual.ano;
  graficoMes = atual.mes;
  graficoPersonalizado = false;
  graficoDe = "";
  graficoAte = "";
  graficoDia = "";
  avisoPeriodo = "";
  pintarRegiaoInicio();
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
      limparSobrepostos();
      pintarConteudo(paginaPedidos({ tipo: "carregando" }), true);
      carregarPedidos();
    }
    return;
  }

  if (caminho === "/") {
    const regiao = document.getElementById("regiao-inicio");
    if (!regiao || mudou) {
      limparSobrepostos();
      inicioTipo = "carregando";
      inicioErroEstoque = "";
      pintarConteudo(paginaInicio(estadoInicio()), true);
      carregarInicio();
    }
    return;
  }

  if (caminho === "/estoque") {
    const regiao = document.getElementById("regiao-estoque");
    if (!regiao || mudou) {
      limparSobrepostos();
      estoqueTipo = "carregando";
      pintarConteudo(paginaEstoque(estadoEstoque()), true);
      carregarEstoque();
    }
    return;
  }

  if (caminho === "/clientes") {
    const regiao = document.getElementById("regiao-clientes");
    if (!regiao || mudou) {
      limparSobrepostos();
      clientesTipo = "carregando";
      pintarConteudo(paginaClientes(estadoClientes()), true);
      carregarClientes();
    }
    return;
  }

  if (caminho === "/avisos") {
    const regiao = document.getElementById("regiao-avisos");
    if (!regiao || mudou) {
      limparSobrepostos();
      avisosTipo = "carregando";
      avisoAvisos = "";
      pintarConteudo(paginaAvisos(estadoAvisos()), true);
      carregarAvisos();
    }
  }
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
  pintarRegiao();
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
  pintarRegiao();
}

function idsDoUi() {
  if (!etiquetasUi) return null;
  if (etiquetasUi.pedidoId) return [etiquetasUi.pedidoId];
  return null;
}

async function abrirResumoEtiquetas(pedidoId) {
  etiquetasUi = {
    fase: "carregando",
    pedidoId: pedidoId || "",
    titulo: pedidoId ? "Etiqueta do pedido" : "Etiquetas da quarta",
  };
  pintarRegiao();
  const corpo = { acao: "resumo" };
  if (pedidoId) corpo.pedido_ids = [pedidoId];
  const resposta = await chamarEtiquetas(config, sessao.access_token, corpo, fetch);
  if (!resposta.ok) {
    etiquetasUi = {
      fase: "erro",
      pedidoId: pedidoId || "",
      titulo: pedidoId ? "Etiqueta do pedido" : "Etiquetas da quarta",
      mensagem: resposta.rede
        ? "Não consegui falar com o servidor. Tente de novo."
        : mensagemDeAcao(resposta.body, "Não consegui montar o resumo."),
    };
    pintarRegiao();
    return;
  }
  etiquetasUi = {
    fase: "resumo",
    pedidoId: pedidoId || "",
    titulo: pedidoId ? "Etiqueta do pedido" : "Etiquetas da quarta",
    resumo: resposta.body,
  };
  pintarRegiao();
  const titulo = document.getElementById("etiquetas-titulo");
  if (titulo) titulo.focus();
}

async function comprarEtiquetas() {
  if (!etiquetasUi || etiquetasUi.fase !== "resumo") return;
  const pedidoId = etiquetasUi.pedidoId;
  const titulo = etiquetasUi.titulo;
  const resumo = etiquetasUi.resumo || {};
  const ids = [
    ...(Array.isArray(resumo.pedidos) ? resumo.pedidos : []),
    ...(Array.isArray(resumo.ja_pagas) ? resumo.ja_pagas : []),
  ].map((item) => item && item.id).filter(Boolean);
  if (!ids.length) return;
  etiquetasUi = { fase: "comprando", pedidoId, titulo };
  pintarRegiao();
  const corpo = { acao: "comprar", pedido_ids: ids };
  const resposta = await chamarEtiquetas(config, sessao.access_token, corpo, fetch);
  if (!resposta.ok) {
    etiquetasUi = {
      fase: "erro",
      pedidoId,
      titulo,
      mensagem: resposta.rede
        ? "Não consegui falar com o servidor. Abra o pedido e confira antes de comprar de novo."
        : mensagemDeAcao(resposta.body, "Não comprei as etiquetas."),
    };
    pintarRegiao();
    return;
  }
  etiquetasUi = {
    fase: "pronto",
    pedidoId,
    titulo,
    mensagem: resposta.body && resposta.body.mensagem ? resposta.body.mensagem : "Etiquetas geradas.",
    pedidoIds: (resposta.body && resposta.body.geradas || []).map((item) => item.id).filter(Boolean),
  };
  await carregarPedidos();
  if (pedidoId) {
    const hist = await listarHistorico(config, sessao.access_token, pedidoId, fetch);
    if (hist.ok) historicoAberto = hist.linhas;
    pintarRegiao();
  }
}

async function conferirEtiqueta(pedidoId) {
  if (!pedidoId) return;
  avisoPedido = "Conferindo a etiqueta no Melhor Envio.";
  pintarRegiao();
  const resposta = await chamarEtiquetas(config, sessao.access_token, {
    acao: "reconciliar",
    pedido_ids: [pedidoId],
  }, fetch);
  avisoPedido = resposta.rede
    ? "Não consegui falar com o servidor. A etiqueta continua como está."
    : mensagemDeAcao(resposta.body, "Não conferi a etiqueta.");
  await carregarPedidos();
  const hist = await listarHistorico(config, sessao.access_token, pedidoId, fetch);
  if (hist.ok) historicoAberto = hist.linhas;
  pintarRegiao();
}

async function imprimirEtiquetas(formato, pedidoId) {
  const titulo = etiquetasUi && etiquetasUi.titulo ? etiquetasUi.titulo : "Imprimir etiquetas";
  const ids = pedidoId ? [pedidoId] : etiquetasUi && etiquetasUi.pedidoIds && etiquetasUi.pedidoIds.length
    ? etiquetasUi.pedidoIds
    : etiquetasUi && etiquetasUi.pedidoId
    ? [etiquetasUi.pedidoId]
    : null;
  etiquetasUi = { fase: "imprimindo", titulo, pedidoId: pedidoId || (etiquetasUi && etiquetasUi.pedidoId) || "" };
  pintarRegiao();
  const corpo = { acao: "imprimir", formato };
  if (ids) corpo.pedido_ids = ids;
  const resposta = await chamarEtiquetas(config, sessao.access_token, corpo, fetch);
  if (!resposta.ok || !resposta.body || !resposta.body.url) {
    etiquetasUi = {
      fase: "erro",
      titulo,
      mensagem: resposta.rede
        ? "Não consegui falar com o servidor."
        : mensagemDeAcao(resposta.body, "Não consegui o PDF."),
    };
    pintarRegiao();
    return;
  }
  window.open(resposta.body.url, "_blank", "noopener");
  etiquetasUi = {
    fase: "pronto",
    titulo,
    mensagem: resposta.body.mensagem || "PDF pronto.",
    pedidoIds: ids || undefined,
    pedidoId: pedidoId || "",
  };
  pintarRegiao();
}

async function pedirMudancaStatus(pedidoId, novoStatus) {
  const pedido = pedidosBrutos.find((p) => p.id === pedidoId);
  if (!pedido || !novoStatus || novoStatus === pedido.status) {
    pintarRegiao();
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
    pintarRegiao();
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
    pintarRegiao();
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
    pintarRegiao();
    return;
  }
  const pedido = pedidosBrutos.find((p) => p.id === pedidoId);
  if (pedido) pedido.status = novoStatus;
  confirmacao = null;
  const hist = await listarHistorico(config, sessao.access_token, pedidoId, fetch);
  if (hist.ok) historicoAberto = hist.linhas;
  pintarRegiao();
  const eventoEmail = novoStatus === "enviado"
    ? "enviado"
    : novoStatus === "entregue"
    ? "entregue"
    : novoStatus === "pronto_retirada"
    ? "pronto_retirada"
    : "";
  if (eventoEmail && resultado.body && resultado.body.ja !== true) {
    const aviso = await notificarCliente(config, sessao.access_token, pedidoId, eventoEmail, fetch);
    if (!aviso.ok && !aviso.rede) {
      avisoPedido = mensagemDeAcao(aviso.body, "O status mudou, mas o e-mail não saiu.");
      pintarRegiao();
    }
  }
}

async function aplicarReembolso(pedidoId) {
  avisoPedido = "";
  confirmacao = null;
  pintarRegiao();
  const resultado = await reembolsarPedido(config, sessao.access_token, pedidoId, fetch);
  if (resultado.ja_reembolsado) {
    confirmacao = {
      tipo: "sincronizar_reembolso",
      pedidoId,
      texto: mensagemJaReembolsado(),
      simLabel: "Confirmar",
      naoLabel: "Cancelar",
    };
    pintarRegiao();
    return;
  }
  if (!resultado.ok) {
    avisoPedido = resultado.rede
      ? "Não consegui falar com o servidor. Tente de novo."
      : mensagemDeAcao(resultado.body, "O reembolso não foi concluído.");
    pintarRegiao();
    return;
  }
  const pedido = pedidosBrutos.find((p) => p.id === pedidoId);
  if (pedido) pedido.status = "reembolsado";
  const hist = await listarHistorico(config, sessao.access_token, pedidoId, fetch);
  if (hist.ok) historicoAberto = hist.linhas;
  pintarRegiao();
}

async function sincronizarReembolso(pedidoId) {
  avisoPedido = "";
  confirmacao = null;
  pintarRegiao();
  const resultado = await confirmarReembolso(
    config,
    sessao.access_token,
    pedidoId,
    "mp_ja_reembolsado",
    fetch,
  );
  if (!resultado.ok) {
    avisoPedido = resultado.rede
      ? "Não consegui falar com o servidor. Tente de novo."
      : mensagemDeAcao(resultado.body, "Não foi possível marcar o pedido como reembolsado.");
    pintarRegiao();
    return;
  }
  const pedido = pedidosBrutos.find((p) => p.id === pedidoId);
  if (pedido) pedido.status = "reembolsado";
  const hist = await listarHistorico(config, sessao.access_token, pedidoId, fetch);
  if (hist.ok) historicoAberto = hist.linhas;
  pintarRegiao();
}

async function aplicarApagar(pedidoId) {
  avisoPedido = "";
  const resultado = await apagarPedidoTeste(config, sessao.access_token, pedidoId, fetch);
  if (!resultado.ok) {
    avisoPedido = mensagemDeAcao(resultado.body, "Não foi possível apagar o pedido.");
    confirmacao = null;
    pintarRegiao();
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
    pintarRegiao();
    return;
  }
  const pedido = pedidosBrutos.find((p) => p.id === pedidoId);
  if (pedido) pedido.notas_internas = notas;
  avisoPedido = "";
  pintarRegiao();
}

app.addEventListener("click", (event) => {
  const sairBotao = event.target.closest("[data-sair]");
  if (sairBotao) {
    event.preventDefault();
    encerrar();
    return;
  }
  const resolver = event.target.closest("[data-resolver-aviso]");
  if (resolver) {
    event.preventDefault();
    const id = resolver.getAttribute("data-resolver-aviso");
    const resolvido = resolver.getAttribute("data-resolvido") === "true";
    alternarAviso(id, resolvido);
    return;
  }
  const recarregar = event.target.closest("[data-recarregar]");
  if (recarregar) {
    const qual = recarregar.getAttribute("data-recarregar");
    if (qual === "inicio") {
      inicioTipo = "carregando";
      pintarRegiaoInicio();
      carregarInicio();
      return;
    }
    if (qual === "estoque") {
      estoqueTipo = "carregando";
      pintarRegiaoEstoque();
      carregarEstoque();
      return;
    }
    if (qual === "clientes") {
      clientesTipo = "carregando";
      pintarRegiaoClientes();
      carregarClientes();
      return;
    }
    if (qual === "avisos") {
      avisosTipo = "carregando";
      avisoAvisos = "";
      pintarRegiaoAvisos();
      carregarAvisos();
      return;
    }
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
    pintarRegiao();
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
  const fecharEtiquetas = event.target.closest("[data-etiquetas-fechar]");
  if (fecharEtiquetas) {
    etiquetasUi = null;
    pintarRegiao();
    return;
  }
  const fundoEtiquetas = event.target.closest("[data-etiquetas-fundo]");
  if (fundoEtiquetas && event.target === fundoEtiquetas) {
    if (!etiquetasUi || etiquetasUi.fase === "comprando" || etiquetasUi.fase === "imprimindo") return;
    etiquetasUi = null;
    pintarRegiao();
    return;
  }
  const quarta = event.target.closest("[data-etiquetas-quarta]");
  if (quarta) {
    abrirResumoEtiquetas("");
    return;
  }
  const gerarUma = event.target.closest("[data-gerar-etiqueta]");
  if (gerarUma) {
    abrirResumoEtiquetas(gerarUma.getAttribute("data-gerar-etiqueta"));
    return;
  }
  const comprarBtn = event.target.closest("[data-etiquetas-comprar]");
  if (comprarBtn) {
    comprarEtiquetas();
    return;
  }
  const conferirBtn = event.target.closest("[data-conferir-etiqueta]");
  if (conferirBtn) {
    conferirEtiqueta(conferirBtn.getAttribute("data-conferir-etiqueta"));
    return;
  }
  const lote = event.target.closest("[data-imprimir-lote]");
  if (lote) {
    etiquetasUi = {
      fase: "formato",
      titulo: "Imprimir etiquetas",
      mensagem: "Escolha o papel. O lote sai num PDF só.",
    };
    pintarRegiao();
    return;
  }
  const formatoBtn = event.target.closest("[data-imprimir-formato]");
  if (formatoBtn) {
    imprimirEtiquetas(formatoBtn.getAttribute("data-imprimir-formato"), "");
    return;
  }
  const uma = event.target.closest("[data-imprimir-uma]");
  if (uma) {
    imprimirEtiquetas(uma.getAttribute("data-imprimir-uma"), uma.getAttribute("data-pedido-id"));
    return;
  }
  const fechar = event.target.closest("[data-fechar-detalhe]");
  if (fechar) {
    fecharDetalhe();
    return;
  }
  const fecharVelaBtn = event.target.closest("[data-fechar-vela]");
  if (fecharVelaBtn) {
    fecharVela();
    return;
  }
  const fecharClienteBtn = event.target.closest("[data-fechar-cliente]");
  if (fecharClienteBtn) {
    fecharCliente();
    return;
  }
  const fundo = event.target.closest("[data-fechar-fundo]");
  if (fundo && event.target === fundo) {
    const qual = fundo.getAttribute("data-fechar-fundo");
    if (qual === "vela") fecharVela();
    else if (qual === "cliente") fecharCliente();
    else fecharDetalhe();
    return;
  }
  const mesBtn = event.target.closest("[data-mes]");
  if (mesBtn && !mesBtn.disabled) {
    moverMes(Number(mesBtn.getAttribute("data-mes")));
    return;
  }
  const metricaBtn = event.target.closest("[data-metrica]");
  if (metricaBtn) {
    graficoMetrica = metricaBtn.getAttribute("data-metrica") || METRICA_REAIS;
    graficoDia = "";
    pintarRegiaoInicio();
    return;
  }
  const esteMes = event.target.closest("[data-este-mes]");
  if (esteMes) {
    voltarEsteMes();
    return;
  }
  const diaBtn = event.target.closest("[data-dia]");
  if (diaBtn) {
    const dia = diaBtn.getAttribute("data-dia");
    graficoDia = graficoDia === dia ? "" : dia;
    pintarRegiaoInicio();
    return;
  }
  const nao = event.target.closest("[data-confirmar-nao]");
  if (nao) {
    confirmacao = null;
    pintarRegiao();
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
    if (tipo === "sincronizar_reembolso") {
      sincronizarReembolso(pedidoId);
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
    pintarRegiao();
    return;
  }
  const wa = event.target.closest("a.wa, .detalhe a[href^='https://wa.me']");
  if (wa) {
    event.stopPropagation();
    return;
  }
  const abrirDoCliente = event.target.closest("[data-abrir-pedido]");
  if (abrirDoCliente) {
    event.preventDefault();
    abrirPedido(abrirDoCliente.getAttribute("data-abrir-pedido"));
    return;
  }
  const linha = event.target.closest("[data-pedido]");
  if (linha && !event.target.closest(".detalhe")) {
    event.preventDefault();
    abrirPedido(linha.getAttribute("data-pedido"));
    return;
  }
  const vela = event.target.closest("[data-vela]");
  if (vela && !event.target.closest(".detalhe")) {
    event.preventDefault();
    abrirVela(vela.getAttribute("data-vela"));
    return;
  }
  const cliente = event.target.closest("[data-cliente]");
  if (cliente && !event.target.closest(".detalhe")) {
    event.preventDefault();
    abrirCliente(cliente.getAttribute("data-cliente"));
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
  if (event.target && event.target.id === "entrada-quantidade") {
    rascunhoQuantidade = event.target.value;
    return;
  }
  if (event.target && event.target.id === "entrada-obs") {
    rascunhoObs = event.target.value;
    return;
  }
  if (event.target && event.target.id === "ajuste-disponivel") {
    rascunhoAjuste = event.target.value;
    return;
  }
  if (event.target && event.target.id === "ajuste-motivo") {
    rascunhoMotivo = event.target.value;
    return;
  }
  if (event.target && event.target.id === "busca-clientes-campo") {
    buscaCliente = event.target.value;
    pintarRegiaoClientes();
    return;
  }
  const form = event.target.closest("#filtros-pedidos");
  if (form && event.target.name === "busca") {
    lerFiltrosDoForm(form);
  }
});

app.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (etiquetasUi && etiquetasUi.fase !== "comprando" && etiquetasUi.fase !== "imprimindo") {
      event.preventDefault();
      etiquetasUi = null;
      pintarRegiao();
      return;
    }
    if (pedidoAbertoId) {
      event.preventDefault();
      fecharDetalhe();
      return;
    }
    if (clienteAbertoChave) {
      event.preventDefault();
      fecharCliente();
      return;
    }
    if (velaAbertaId) {
      event.preventDefault();
      fecharVela();
      return;
    }
  }
  if (event.key !== "Enter" && event.key !== " ") return;
  const linha = event.target.closest("[data-pedido], [data-vela], [data-cliente], [data-dia]");
  if (!linha) return;
  event.preventDefault();
  if (linha.hasAttribute("data-pedido")) abrirPedido(linha.getAttribute("data-pedido"));
  else if (linha.hasAttribute("data-vela")) abrirVela(linha.getAttribute("data-vela"));
  else if (linha.hasAttribute("data-cliente")) abrirCliente(linha.getAttribute("data-cliente"));
  else if (linha.hasAttribute("data-dia")) {
    const dia = linha.getAttribute("data-dia");
    graficoDia = graficoDia === dia ? "" : dia;
    pintarRegiaoInicio();
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
    return;
  }
  if (form.id === "periodo-grafico") {
    event.preventDefault();
    aplicarPeriodo(form);
    return;
  }
  if (form.id === "form-entrada") {
    event.preventDefault();
    registrarEntrada(form);
    return;
  }
  if (form.id === "form-ajuste") {
    event.preventDefault();
    enviarAjuste(form);
    return;
  }
  if (form.id === "busca-clientes") {
    event.preventDefault();
    buscaCliente = form.busca.value;
    pintarRegiaoClientes();
  }
});

window.addEventListener("resize", () => {
  if (caminhoAgora() === "/" && inicioTipo === "pronto") pintarRegiaoInicio();
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
