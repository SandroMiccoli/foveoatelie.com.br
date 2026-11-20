import {
  METRICA_PEDIDOS,
  METRICA_REAIS,
  METRICA_VELAS,
  descreverPonto,
  formatarCpf,
  formatarData,
  formatarDataCurta,
  formatarPreco,
  formatarQuantidadeMovimento,
  formatarVelas,
  linkWhatsApp,
  nivelStatus,
  rotuloDia,
  rotuloDisponivel,
  rotuloMovimento,
  rotuloReservado,
  rotuloStatus,
} from "./painel.mjs";

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

function titulo(texto) {
  return el("h1", { text: texto });
}

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
      d: "M12.04 2C6.58 2 2.15 6.4 2.15 11.83c0 1.99.59 3.84 1.6 5.4L2 22l4.95-1.63a9.9 9.9 0 0 0 5.09 1.4h.01c5.46 0 9.89-4.4 9.89-9.84C21.94 6.4 17.5 2 12.04 2zm5.76 14.04c-.24.68-1.4 1.25-1.94 1.33-.5.07-1.13.1-1.82-.11-.42-.13-.96-.31-1.65-.61-2.9-1.25-4.78-4.17-4.93-4.36-.14-.2-1.18-1.57-1.18-3 0-1.42.74-2.12 1-2.41.26-.29.57-.36.76-.36h.55c.17 0 .4-.06.62.48.24.56.8 1.94.87 2.08.07.14.12.3.02.48-.1.2-.15.32-.29.49-.14.17-.3.38-.43.51-.14.14-.29.29-.12.56.16.28.73 1.2 1.56 1.94 1.07.96 1.97 1.26 2.25 1.4.28.14.44.12.6-.07.17-.2.7-.81.89-1.09.19-.28.37-.23.63-.14.26.1 1.64.77 1.92.91.28.14.47.21.54.32.07.12.07.68-.17 1.36z",
      fill: "currentColor",
    }),
  ]);
}

function botaoWa(wa, nome) {
  if (!wa) return null;
  const pessoa = typeof nome === "string" ? nome.trim() : "";
  const rotulo = pessoa && pessoa !== "—" && pessoa !== "Sem nome"
    ? "Abrir WhatsApp de " + pessoa
    : "Abrir WhatsApp";
  return el("a", {
    class: "wa",
    href: wa,
    target: "_blank",
    rel: "noopener noreferrer",
    "aria-label": rotulo,
    title: rotulo,
  }, [iconeWhatsApp()]);
}

function ponto(nivel) {
  return el("span", { class: "ponto", "data-nivel": nivel, "aria-hidden": "true" });
}

function esqueleto(texto) {
  return el("div", { class: "esqueleto", "aria-busy": "true" }, [
    el("p", { text: texto }),
    el("span", { class: "barra" }),
    el("span", { class: "barra" }),
    el("span", { class: "barra" }),
    el("span", { class: "barra" }),
  ]);
}

function avisoErro(mensagem, recarregar) {
  return el("div", { class: "aviso" }, [
    el("p", { role: "alert", tabindex: "-1", text: mensagem }),
    el("button", { type: "button", class: "botao", "data-recarregar": recarregar, text: "Tentar de novo" }),
  ]);
}

function chevron(lado) {
  return svgEl("svg", {
    viewBox: "0 0 24 24",
    width: "18",
    height: "18",
    "aria-hidden": "true",
    focusable: "false",
  }, [
    svgEl("path", {
      d: lado === "esquerda" ? "M14 6 L8 12 L14 18" : "M10 6 L16 12 L10 18",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.5",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    }),
  ]);
}

function rotuloEixo(valor, metrica) {
  if (metrica === METRICA_REAIS) {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      maximumFractionDigits: 0,
    }).format((valor || 0) / 100);
  }
  return String(valor || 0);
}

function leituraDoPeriodo(serie, metrica, diaAtivo) {
  if (!serie || !serie.pontos) return "";
  const pontoAtivo = serie.pontos.find((ponto) => ponto.dia === diaAtivo);
  if (pontoAtivo) return descreverPonto(pontoAtivo, metrica);
  if (metrica === METRICA_PEDIDOS) {
    const total = serie.pontos.reduce((soma, ponto) => soma + ponto.valor, 0);
    return "No período · " + total + (total === 1 ? " pedido" : " pedidos");
  }
  if (metrica === METRICA_VELAS) {
    const total = serie.pontos.reduce((soma, ponto) => soma + ponto.valor, 0);
    return "No período · " + total + (total === 1 ? " vela" : " velas");
  }
  return "No período · " + formatarPreco(serie.totalReais || 0);
}

function eixoBonito(maximo, metrica) {
  const reais = metrica === METRICA_REAIS;
  const maxUnidade = reais ? (maximo || 0) / 100 : maximo || 0;
  if (maxUnidade <= 0) {
    const teto = reais ? 100 : 1;
    return { teto, marcas: [0, teto] };
  }
  const alvo = Math.max(maxUnidade / 2, 1);
  const potencia = 10 ** Math.floor(Math.log10(alvo));
  const fracao = alvo / potencia;
  const bonito = fracao <= 1 ? 1 : fracao <= 2 ? 2 : fracao <= 2.5 ? 2.5 : fracao <= 5 ? 5 : 10;
  const passo = bonito * potencia;
  const tetoUnidade = Math.max(passo, Math.ceil((maxUnidade - 1e-9) / passo) * passo);
  const marcas = [];
  for (let valor = 0; valor <= tetoUnidade + passo * 0.01; valor += passo) {
    marcas.push(Math.round(valor * (reais ? 100 : 1)));
  }
  return { teto: Math.round(tetoUnidade * (reais ? 100 : 1)), marcas };
}

function passoDosDias(total) {
  if (total > 20) return 5;
  if (total > 12) return 2;
  return 1;
}

function graficoBarras(pontos, metrica, diaAtivo, larguraInformada) {
  const largura = Math.max(280, larguraInformada || 640);
  const altura = 232;
  const esquerda = 80;
  const direita = 16;
  const topo = 16;
  const base = 28;
  const mioloL = largura - esquerda - direita;
  const mioloA = altura - topo - base;
  const maior = Math.max(0, ...pontos.map((ponto) => ponto.valor));
  const eixo = eixoBonito(maior, metrica);
  const maximo = Math.max(eixo.teto, 1);
  const n = Math.max(pontos.length, 1);
  const slot = mioloL / n;
  const passo = passoDosDias(n);
  const svg = svgEl("svg", {
    class: "grafico",
    viewBox: "0 0 " + largura + " " + altura,
    width: String(largura),
    height: String(altura),
    role: "group",
    "aria-label": "Barras de vendas por dia",
  });

  for (const marca of eixo.marcas) {
    const y = topo + mioloA - (marca / maximo) * mioloA;
    svg.append(svgEl("line", {
      x1: String(esquerda),
      x2: String(largura - direita),
      y1: String(y),
      y2: String(y),
      class: "grafico-fio",
    }));
    svg.append(svgEl("text", {
      x: String(esquerda - 8),
      y: String(y + 4),
      class: "grafico-eixo",
      "text-anchor": "end",
    }, [document.createTextNode(rotuloEixo(marca, metrica))]));
  }

  pontos.forEach((ponto, indice) => {
    const x = esquerda + slot * indice;
    const alturaBarra = ponto.valor > 0 ? Math.max(2, (ponto.valor / maximo) * mioloA) : 0;
    const y = topo + mioloA - alturaBarra;
    const ativo = ponto.dia === diaAtivo;
    const grupo = svgEl("g", {
      class: ativo ? "grafico-dia ativo" : "grafico-dia",
      tabindex: "0",
      role: "button",
      "data-dia": ponto.dia,
      "aria-label": descreverPonto(ponto, metrica),
      "aria-pressed": ativo ? "true" : "false",
    });
    grupo.append(svgEl("rect", {
      x: String(x),
      y: String(topo),
      width: String(Math.max(slot, 1)),
      height: String(mioloA),
      class: "grafico-alvo",
    }));
    if (alturaBarra > 0) {
      const folga = Math.min(4, slot * 0.28);
      grupo.append(svgEl("rect", {
        x: String(x + folga / 2),
        y: String(y),
        width: String(Math.max(slot - folga, 1)),
        height: String(alturaBarra),
        class: "grafico-barra",
      }));
    }
    svg.append(grupo);
    const mostrar = indice % passo === 0 || indice === n - 1;
    if (mostrar) {
      svg.append(svgEl("text", {
        x: String(x + slot / 2),
        y: String(altura - 8),
        class: "grafico-dia-rotulo",
        "text-anchor": "middle",
      }, [document.createTextNode(String(Number(ponto.dia.slice(8))))]));
    }
  });
  return svg;
}

function graficoLinha(pontos, diaAtivo, larguraInformada) {
  const largura = Math.max(280, larguraInformada || 640);
  const altura = 180;
  const esquerda = 80;
  const direita = 16;
  const topo = 16;
  const base = 28;
  const mioloL = largura - esquerda - direita;
  const mioloA = altura - topo - base;
  const maior = Math.max(0, ...pontos.map((ponto) => ponto.acumulado));
  const eixo = eixoBonito(maior, METRICA_REAIS);
  const maximo = Math.max(eixo.teto, 1);
  const n = Math.max(pontos.length, 1);
  const slot = mioloL / n;
  const svg = svgEl("svg", {
    class: "grafico",
    viewBox: "0 0 " + largura + " " + altura,
    width: String(largura),
    height: String(altura),
    role: "img",
    "aria-label": "Linha do valor acumulado no período",
  });

  for (const marca of eixo.marcas) {
    const y = topo + mioloA - (marca / maximo) * mioloA;
    svg.append(svgEl("line", {
      x1: String(esquerda),
      x2: String(largura - direita),
      y1: String(y),
      y2: String(y),
      class: "grafico-fio",
    }));
    svg.append(svgEl("text", {
      x: String(esquerda - 8),
      y: String(y + 4),
      class: "grafico-eixo",
      "text-anchor": "end",
    }, [document.createTextNode(rotuloEixo(marca, METRICA_REAIS))]));
  }

  const coords = pontos.map((ponto, indice) => {
    const x = esquerda + slot * indice + slot / 2;
    const y = topo + mioloA - (ponto.acumulado / maximo) * mioloA;
    return x.toFixed(1) + "," + y.toFixed(1);
  });
  if (coords.length) {
    svg.append(svgEl("polyline", {
      points: coords.join(" "),
      class: "grafico-linha",
    }));
  }
  pontos.forEach((ponto, indice) => {
    if (ponto.dia !== diaAtivo) return;
    const x = esquerda + slot * indice + slot / 2;
    const y = topo + mioloA - (ponto.acumulado / maximo) * mioloA;
    svg.append(svgEl("circle", {
      cx: String(x),
      cy: String(y),
      r: "4",
      class: "grafico-ponto",
    }));
  });

  const passo = passoDosDias(n);
  pontos.forEach((ponto, indice) => {
    if (indice % passo !== 0 && indice !== n - 1) return;
    const x = esquerda + slot * indice + slot / 2;
    svg.append(svgEl("text", {
      x: String(x),
      y: String(altura - 8),
      class: "grafico-dia-rotulo",
      "text-anchor": "middle",
    }, [document.createTextNode(String(Number(ponto.dia.slice(8))))]));
  });
  return svg;
}

function tabelaOculta(pontos, metrica) {
  const corpo = pontos.map((ponto) => el("tr", {}, [
    el("td", { text: rotuloDia(ponto.dia) }),
    el("td", { text: metrica === METRICA_REAIS ? formatarPreco(ponto.valor) : String(ponto.valor) }),
    el("td", { text: formatarPreco(ponto.acumulado) }),
  ]));
  return el("table", { class: "sr-only" }, [
    el("caption", { text: "Vendas do período, por dia, e o acumulado em reais." }),
    el("thead", {}, [
      el("tr", {}, [
        el("th", { scope: "col", text: "Dia" }),
        el("th", { scope: "col", text: metrica === METRICA_PEDIDOS ? "Pedidos" : metrica === METRICA_VELAS ? "Velas" : "Valor" }),
        el("th", { scope: "col", text: "Acumulado" }),
      ]),
    ]),
    el("tbody", {}, corpo),
  ]);
}

function botaoMetrica(valor, nome, atual) {
  return el("button", {
    type: "button",
    "data-metrica": valor,
    "aria-pressed": atual === valor ? "true" : "false",
    text: nome,
  });
}

function notaSemLiquido(n) {
  if (!n) return "";
  if (n === 1) return "1 pedido sem o líquido salvo";
  return n + " pedidos sem o líquido salvo";
}

function cartoes(resumo) {
  const nota = notaSemLiquido(resumo.pagosSemLiquido);
  return el("ul", { class: "numeros" }, [
    el("li", { class: "numero" }, [
      el("span", { class: "numero-rotulo", text: "Aguardando envio" }),
      el("span", { class: "numero-valor", text: String(resumo.aguardandoEnvio) }),
    ]),
    el("li", { class: "numero" }, [
      el("span", { class: "numero-rotulo", text: "Vendas da semana" }),
      el("span", { class: "numero-valor", text: formatarPreco(resumo.vendasSemanaCentavos) }),
    ]),
    el("li", { class: "numero" }, [
      el("span", { class: "numero-rotulo", text: "Vendas do mês" }),
      el("span", { class: "numero-valor", text: formatarPreco(resumo.vendasMesCentavos) }),
    ]),
    el("li", { class: "numero" }, [
      el("span", { class: "numero-rotulo", text: "Aguardando pagamento" }),
      el("span", { class: "numero-valor", text: String(resumo.aguardandoPagamento) }),
    ]),
    el("li", { class: "numero" }, [
      el("span", { class: "numero-rotulo", text: "A liberar" }),
      el("span", { class: "numero-valor", text: formatarPreco(resumo.aLiberarCentavos) }),
      nota ? el("span", { class: "numero-nota", text: nota }) : null,
    ]),
  ]);
}

function listaVelasInicio(grupos) {
  if (!grupos.length) {
    return el("p", { class: "vazio", text: "Nenhuma vela cadastrada." });
  }
  return el("div", { class: "colecoes" }, grupos.map((grupo) =>
    el("section", { class: "colecao" }, [
      el("h3", { class: "colecao-nome", text: grupo.colecao }),
      el("ul", { class: "velas-resumo" }, grupo.itens.map((vela) => {
        const qtd = el("span", { class: "vela-qtd" }, [
          vela.baixo ? ponto("para") : null,
          document.createTextNode(rotuloDisponivel(vela.disponivel)),
          vela.reservado > 0
            ? el("span", { class: "vela-reserva", text: rotuloReservado(vela.reservado) })
            : null,
          vela.baixo ? el("span", { class: "marca-baixo", text: "baixo" }) : null,
        ]);
        const nome = vela.ativo ? vela.nome : vela.nome + ", inativa";
        return el("li", { class: vela.baixo ? "vela-resumo baixo" : "vela-resumo" }, [
          el("span", { class: "vela-nome", text: nome }),
          qtd,
        ]);
      })),
    ]),
  ));
}

export function mioloInicio(estado) {
  if (estado.tipo === "carregando") return esqueleto("Carregando o início.");
  if (estado.tipo === "erro") return avisoErro(estado.mensagem, "inicio");

  const serie = estado.serie;
  const pontos = serie && serie.pontos ? serie.pontos : [];
  const aviso = estado.avisoPeriodo
    ? el("p", { class: "alerta", role: "alert", text: estado.avisoPeriodo })
    : null;

  return el("div", {}, [
    cartoes(estado.resumo),
    el("section", { class: "bloco", "aria-labelledby": "titulo-estoque-inicio" }, [
      el("h2", { id: "titulo-estoque-inicio", text: "Estoque" }),
      estado.erroEstoque
        ? el("p", { class: "alerta", role: "alert", text: estado.erroEstoque })
        : listaVelasInicio(estado.grupos || []),
    ]),
    el("section", { class: "bloco", "aria-labelledby": "titulo-vendas" }, [
      el("h2", { id: "titulo-vendas", text: "Vendas" }),
      el("div", { class: "grafico-topo" }, [
        el("div", { class: "mes-nav" }, [
          el("button", {
            type: "button",
            class: "seta",
            "data-mes": "-1",
            "aria-label": "Mês anterior",
            disabled: estado.podeVoltar ? null : "disabled",
          }, [chevron("esquerda")]),
          el("p", { class: "mes-titulo", text: estado.tituloPeriodo }),
          el("button", {
            type: "button",
            class: "seta",
            "data-mes": "1",
            "aria-label": "Próximo mês",
            disabled: estado.podeAvancar ? null : "disabled",
          }, [chevron("direita")]),
        ]),
        el("div", { class: "segmento", role: "group", "aria-label": "Medida do gráfico" }, [
          botaoMetrica(METRICA_REAIS, "R$", estado.metrica),
          botaoMetrica(METRICA_PEDIDOS, "Pedidos", estado.metrica),
          botaoMetrica(METRICA_VELAS, "Velas", estado.metrica),
        ]),
      ]),
      el("form", { id: "periodo-grafico", class: "periodo" }, [
        el("div", { class: "filtro" }, [
          el("label", { for: "periodo-de", text: "De" }),
          el("input", { id: "periodo-de", name: "de", type: "date", value: estado.de || "" }),
        ]),
        el("div", { class: "filtro" }, [
          el("label", { for: "periodo-ate", text: "Até" }),
          el("input", { id: "periodo-ate", name: "ate", type: "date", value: estado.ate || "" }),
        ]),
        el("div", { class: "periodo-acoes" }, [
          el("button", { class: "botao botao-secundario", type: "submit", text: "Aplicar" }),
          estado.personalizado
            ? el("button", { type: "button", class: "botao-texto", "data-este-mes": "1", text: "Este mês" })
            : null,
        ]),
      ]),
      aviso,
      pontos.length
        ? el("div", { class: "grafico-caixa" }, [
          graficoBarras(pontos, estado.metrica, estado.diaAtivo, estado.largura),
          tabelaOculta(pontos, estado.metrica),
        ])
        : el("p", { class: "vazio", text: "Nenhuma venda neste período." }),
      el("p", {
        class: "grafico-leitura",
        "aria-live": "polite",
        text: leituraDoPeriodo(serie, estado.metrica, estado.diaAtivo),
      }),
    ]),
    el("section", { class: "bloco", "aria-labelledby": "titulo-acumulado" }, [
      el("h2", { id: "titulo-acumulado", text: "Acumulado" }),
      el("p", { class: "grafico-nota", text: "Valor vendido somado dia a dia, no mesmo período." }),
      pontos.length
        ? el("div", { class: "grafico-caixa" }, [graficoLinha(pontos, estado.diaAtivo, estado.largura)])
        : null,
    ]),
  ]);
}

export function paginaInicio(estado) {
  return el("div", { class: "pagina pagina-inicio" }, [
    titulo("Início"),
    el("div", { id: "regiao-inicio" }, [mioloInicio(estado)]),
  ]);
}

function linhaHistorico(mov) {
  const data = formatarData(mov.created_at);
  const texto = data ? data.texto.replace(/\/\d{4},/, "") : "—";
  const tempo = el("time", { text: texto });
  if (data) tempo.setAttribute("datetime", data.iso);
  return {
    data: tempo,
    tipo: rotuloMovimento(mov.tipo),
    qtd: formatarQuantidadeMovimento(mov.quantidade),
    saldo: String(mov.saldo_disponivel),
    obs: mov.observacao || "—",
  };
}

function historicoTabela(movimentos) {
  if (!movimentos.length) {
    return el("p", { class: "vazio", text: "Nenhum movimento ainda. Entrada e ajuste aparecem aqui." });
  }
  const linhas = movimentos.map((mov) => {
    const item = linhaHistorico(mov);
    return el("tr", {}, [
      el("td", { "data-campo": "data" }, [item.data]),
      el("td", { "data-campo": "tipo", text: item.tipo }),
      el("td", { "data-campo": "qtd", text: item.qtd }),
      el("td", { "data-campo": "saldo", text: item.saldo }),
      el("td", { "data-campo": "obs", text: item.obs }),
    ]);
  });
  const cards = movimentos.map((mov) => {
    const item = linhaHistorico(mov);
    return el("li", {}, [
      el("article", { class: "pedido movimento" }, [
        el("h3", { class: "codigo", text: item.tipo }),
        el("dl", {}, [
          el("dt", { text: "Data" }),
          el("dd", {}, [item.data.cloneNode(true)]),
          el("dt", { text: "Quantidade" }),
          el("dd", { text: item.qtd }),
          el("dt", { text: "Saldo depois" }),
          el("dd", { text: item.saldo }),
          el("dt", { text: "Observação" }),
          el("dd", { text: item.obs }),
        ]),
      ]),
    ]);
  });
  return el("div", {}, [
    el("div", { class: "rolagem so-larga" }, [
      el("table", { class: "tabela-historico" }, [
        el("caption", { class: "sr-only", text: "Movimentos desta vela, do mais recente ao mais antigo." }),
        el("thead", {}, [
          el("tr", {}, [
            el("th", { scope: "col", text: "Data" }),
            el("th", { scope: "col", text: "Tipo" }),
            el("th", { scope: "col", text: "Quantidade" }),
            el("th", { scope: "col", text: "Saldo depois" }),
            el("th", { scope: "col", text: "Observação" }),
          ]),
        ]),
        el("tbody", {}, linhas),
      ]),
    ]),
    el("ol", { class: "pedidos-pilha so-estreita" }, cards),
  ]);
}

function painelVela(estado) {
  const vela = estado.vela;
  if (!vela) return null;
  const aviso = estado.aviso
    ? el("p", { class: "alerta", role: "alert", text: estado.aviso })
    : null;
  const nota = estado.nota
    ? el("p", { class: "nota-ok", role: "status", text: estado.nota })
    : null;
  const travado = estado.salvando ? "disabled" : null;
  const forms = vela.temLinha
    ? [
      el("form", { id: "form-entrada", class: "form-estoque", "data-produto": vela.id }, [
        el("h3", { text: "Entrada de produção" }),
        el("label", { for: "entrada-quantidade", text: "Quantidade" }),
        el("input", {
          id: "entrada-quantidade",
          name: "quantidade",
          type: "number",
          min: "1",
          max: "100000",
          step: "1",
          inputmode: "numeric",
          value: estado.rascunhoQuantidade || "",
        }),
        el("label", { for: "entrada-obs", text: "Observação" }),
        el("input", {
          id: "entrada-obs",
          name: "observacao",
          type: "text",
          maxlength: "400",
          value: estado.rascunhoObs || "",
          autocomplete: "off",
        }),
        el("button", {
          class: "botao",
          type: "submit",
          disabled: travado,
          text: estado.salvando ? "Salvando…" : "Registrar entrada",
        }),
      ]),
      el("form", { id: "form-ajuste", class: "form-estoque", "data-produto": vela.id }, [
        el("h3", { text: "Ajuste rápido" }),
        el("label", { for: "ajuste-disponivel", text: "Disponível correto" }),
        el("input", {
          id: "ajuste-disponivel",
          name: "disponivel",
          type: "number",
          min: "0",
          max: "100000",
          step: "1",
          inputmode: "numeric",
          value: estado.rascunhoAjuste != null && estado.rascunhoAjuste !== ""
            ? estado.rascunhoAjuste
            : String(vela.disponivel),
        }),
        el("label", { for: "ajuste-motivo", text: "Motivo" }),
        el("input", {
          id: "ajuste-motivo",
          name: "motivo",
          type: "text",
          maxlength: "400",
          value: estado.rascunhoMotivo || "",
          autocomplete: "off",
        }),
        el("button", {
          class: "botao botao-secundario",
          type: "submit",
          disabled: travado,
          text: estado.salvando ? "Salvando…" : "Ajustar",
        }),
      ]),
    ]
    : [el("p", { class: "vazio", text: "Essa vela ainda não tem linha de estoque." })];

  return el("aside", {
    class: "detalhe detalhe-estoque",
    id: "painel-estoque",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "estoque-titulo",
  }, [
    el("div", { class: "detalhe-topo" }, [
      el("h2", { id: "estoque-titulo", text: vela.nome }),
      el("button", {
        type: "button",
        class: "fechar",
        "data-fechar-vela": "1",
        "aria-label": "Fechar estoque",
        text: "Fechar",
      }),
    ]),
    el("p", { class: "detalhe-meta", text: vela.colecao }),
    el("p", { class: "estoque-saldos" }, [
      document.createTextNode(rotuloDisponivel(vela.disponivel)),
      vela.baixo ? el("span", { class: "marca-baixo", text: "baixo" }) : null,
      document.createTextNode(" · " + rotuloReservado(vela.reservado)),
    ]),
    aviso,
    nota,
    ...forms,
    el("div", { class: "detalhe-bloco" }, [
      el("h3", { text: "Histórico" }),
      estado.historicoCarregando
        ? el("p", { class: "vazio", text: "Carregando o histórico." })
        : historicoTabela(estado.movimentos || []),
    ]),
  ]);
}

function tabelaEstoque(grupos, abertaId) {
  const blocos = grupos.map((grupo) => {
    const linhas = grupo.itens.map((vela) => {
      const aberta = vela.id === abertaId;
      const nome = el("span", {}, [
        document.createTextNode(vela.nome),
        vela.ativo ? null : el("span", { class: "marca-baixo", text: "inativa" }),
      ]);
      const disponivel = el("span", { class: "status" }, [
        vela.baixo ? ponto("para") : null,
        document.createTextNode(String(vela.disponivel)),
        vela.baixo ? el("span", { class: "marca-baixo", text: "baixo" }) : null,
      ]);
      return el("tr", {
        class: aberta ? "pedido-linha aberta" : "pedido-linha",
        "data-vela": vela.id,
        tabindex: "0",
        role: "button",
        "aria-pressed": aberta ? "true" : "false",
        "aria-label": vela.nome + ", " + rotuloDisponivel(vela.disponivel),
      }, [
        el("td", { "data-campo": "vela" }, [nome]),
        el("td", { "data-campo": "disponivel" }, [disponivel]),
        el("td", { "data-campo": "reservado", text: String(vela.reservado) }),
      ]);
    });
    return el("section", { class: "colecao" }, [
      el("h3", { class: "colecao-nome", text: grupo.colecao }),
      el("div", { class: "rolagem so-larga" }, [
        el("table", {}, [
          el("caption", { class: "sr-only", text: "Velas de " + grupo.colecao + "." }),
          el("thead", {}, [
            el("tr", {}, [
              el("th", { scope: "col", text: "Vela" }),
              el("th", { scope: "col", text: "Disponível" }),
              el("th", { scope: "col", text: "Reservado" }),
            ]),
          ]),
          el("tbody", {}, linhas),
        ]),
      ]),
      el("ol", { class: "pedidos-pilha so-estreita" }, grupo.itens.map((vela) => {
        const aberta = vela.id === abertaId;
        return el("li", {}, [
          el("article", {
            class: aberta ? "pedido aberta" : "pedido",
            "data-vela": vela.id,
            tabindex: "0",
            role: "button",
            "aria-pressed": aberta ? "true" : "false",
          }, [
            el("h2", {}, [
              el("span", { class: "codigo", text: vela.nome }),
              vela.baixo ? el("span", { class: "marca-baixo", text: "baixo" }) : null,
            ]),
            el("dl", {}, [
              el("dt", { text: "Coleção" }),
              el("dd", { text: vela.colecao }),
              el("dt", { text: "Disponível" }),
              el("dd", { text: String(vela.disponivel) }),
              el("dt", { text: "Reservado" }),
              el("dd", { text: String(vela.reservado) }),
            ]),
          ]),
        ]);
      })),
    ]);
  });
  return el("div", { class: "lista-estoque" }, blocos);
}

export function mioloEstoque(estado) {
  if (estado.tipo === "carregando") return esqueleto("Carregando o estoque.");
  if (estado.tipo === "erro") return avisoErro(estado.mensagem, "estoque");
  const grupos = estado.grupos || [];
  const lista = grupos.length
    ? tabelaEstoque(grupos, estado.vela && estado.vela.id)
    : el("p", { class: "vazio", text: "Nenhuma vela cadastrada." });
  return el("div", { class: estado.vela ? "pedidos-com-detalhe" : "pedidos-so-lista" }, [
    lista,
    estado.vela
      ? el("div", { class: "detalhe-camada", "data-fechar-fundo": "vela" }, [painelVela(estado)])
      : null,
  ]);
}

export function paginaEstoque(estado) {
  return el("div", { class: "pagina pagina-estoque" }, [
    titulo("Estoque"),
    el("div", { id: "regiao-estoque" }, [mioloEstoque(estado)]),
  ]);
}

function resumoClientes(lista, total) {
  if (!total) return "Nenhum cliente ainda.";
  if (lista.length !== total) {
    return lista.length + " de " + total + (total === 1 ? " cliente." : " clientes.");
  }
  return total + (total === 1 ? " cliente." : " clientes.");
}

function tabelaClientes(clientes, aberta) {
  const corpo = clientes.map((cliente) => {
    const ultima = formatarDataCurta(cliente.ultimaCompra);
    const tempo = el("time", { text: ultima ? ultima.texto : "—" });
    if (ultima) tempo.setAttribute("datetime", ultima.iso);
    const wa = botaoWa(linkWhatsApp(cliente.telefone), cliente.nome);
    const marcada = aberta && aberta.chave === cliente.chave;
    return el("tr", {
      class: marcada ? "pedido-linha aberta" : "pedido-linha",
      "data-cliente": cliente.chave,
      tabindex: "0",
      role: "button",
      "aria-pressed": marcada ? "true" : "false",
    }, [
      el("td", { "data-campo": "cliente", text: cliente.nome }),
      el("td", { "data-campo": "contato" }, [wa]),
      el("td", { "data-campo": "qtd", text: String(cliente.quantidade) }),
      el("td", { "data-campo": "total", text: formatarPreco(cliente.totalCentavos) }),
      el("td", { "data-campo": "data" }, [tempo]),
    ]);
  });
  const cards = clientes.map((cliente) => {
    const ultima = formatarDataCurta(cliente.ultimaCompra);
    const tempo = el("time", { text: ultima ? ultima.texto : "—" });
    if (ultima) tempo.setAttribute("datetime", ultima.iso);
    const marcada = aberta && aberta.chave === cliente.chave;
    const wa = linkWhatsApp(cliente.telefone);
    return el("li", {}, [
      el("article", {
        class: marcada ? "pedido aberta" : "pedido",
        "data-cliente": cliente.chave,
        tabindex: "0",
        role: "button",
        "aria-pressed": marcada ? "true" : "false",
      }, [
        el("h2", { text: cliente.nome }),
        el("dl", {}, [
          el("dt", { text: "Pedidos" }),
          el("dd", { text: String(cliente.quantidade) }),
          el("dt", { text: "Total" }),
          el("dd", { text: formatarPreco(cliente.totalCentavos) }),
          el("dt", { text: "Última compra" }),
          el("dd", {}, [tempo]),
        ]),
        wa ? el("p", { class: "pedido-wa" }, [botaoWa(wa, cliente.nome)]) : null,
      ]),
    ]);
  });
  return el("div", { class: "lista-clientes" }, [
    el("div", { class: "rolagem so-larga" }, [
      el("table", {}, [
        el("caption", { class: "sr-only", text: "Clientes, pela última compra." }),
        el("thead", {}, [
          el("tr", {}, [
            el("th", { scope: "col", text: "Cliente" }),
            el("th", { scope: "col", class: "th-contato", text: "WhatsApp" }),
            el("th", { scope: "col", class: "th-num", text: "Pedidos" }),
            el("th", { scope: "col", class: "th-num", text: "Total" }),
            el("th", { scope: "col", text: "Última compra" }),
          ]),
        ]),
        el("tbody", {}, corpo),
      ]),
    ]),
    el("ol", { class: "pedidos-pilha so-estreita" }, cards),
  ]);
}

function painelCliente(cliente) {
  const wa = linkWhatsApp(cliente.telefone);
  const compras = cliente.pedidos.length
    ? el("ol", { class: "compras" }, cliente.pedidos.map((pedido) => {
      const data = formatarData(pedido.created_at);
      const tempo = el("time", { text: data ? data.texto : "—" });
      if (data) tempo.setAttribute("datetime", data.iso);
      return el("li", {}, [
        el("button", {
          type: "button",
          class: "compra",
          "data-abrir-pedido": pedido.id,
        }, [
          el("span", { class: "compra-codigo", text: pedido.codigo ? "#" + pedido.codigo : "Pedido" }),
          tempo,
          el("span", { class: "compra-velas", text: formatarVelas(pedido.itens) }),
          el("span", { class: "compra-total", text: formatarPreco(pedido.total_centavos) }),
          el("span", { class: "status" }, [
            ponto(nivelStatus(pedido.status)),
            document.createTextNode(rotuloStatus(pedido.status)),
          ]),
        ]),
      ]);
    }))
    : el("p", { class: "vazio", text: "Nenhuma compra ainda." });

  return el("aside", {
    class: "detalhe",
    id: "painel-cliente",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "cliente-titulo",
  }, [
    el("div", { class: "detalhe-topo" }, [
      el("h2", { id: "cliente-titulo", text: cliente.nome }),
      el("button", {
        type: "button",
        class: "fechar",
        "data-fechar-cliente": "1",
        "aria-label": "Fechar cliente",
        text: "Fechar",
      }),
    ]),
    el("div", { class: "detalhe-lista" }, [
      el("div", { class: "detalhe-campo" }, [
        el("span", { class: "detalhe-rotulo", text: "E-mail" }),
        el("div", { class: "detalhe-valor", text: cliente.email || "—" }),
      ]),
      el("div", { class: "detalhe-campo" }, [
        el("span", { class: "detalhe-rotulo", text: "CPF" }),
        el("div", { class: "detalhe-valor", text: cliente.cpf ? formatarCpf(cliente.cpf) : "—" }),
      ]),
      el("div", { class: "detalhe-campo" }, [
        el("span", { class: "detalhe-rotulo", text: "WhatsApp" }),
        el("div", { class: "detalhe-valor" }, [
          wa
            ? el("a", {
              href: wa,
              target: "_blank",
              rel: "noopener noreferrer",
              text: cliente.telefone,
            })
            : el("span", { text: "—" }),
        ]),
      ]),
      el("div", { class: "detalhe-campo" }, [
        el("span", { class: "detalhe-rotulo", text: "Total" }),
        el("div", { class: "detalhe-valor", text: formatarPreco(cliente.totalCentavos) }),
      ]),
    ]),
    el("div", { class: "detalhe-bloco" }, [
      el("h3", { text: "Compras" }),
      compras,
    ]),
  ]);
}

export function mioloClientes(estado) {
  if (estado.tipo === "carregando") return esqueleto("Carregando os clientes.");
  if (estado.tipo === "erro") return avisoErro(estado.mensagem, "clientes");

  const clientes = estado.clientes || [];
  const lista = clientes.length
    ? tabelaClientes(clientes, estado.cliente)
    : el("p", {
      class: "vazio",
      text: estado.total
        ? "Nenhum cliente com essa busca."
        : "Nenhuma compra ainda. Quando alguém comprar, a pessoa aparece aqui.",
    });

  return el("div", { class: estado.cliente ? "pedidos-com-detalhe" : "pedidos-so-lista" }, [
    el("form", { id: "busca-clientes", class: "filtros", role: "search" }, [
      el("div", { class: "filtro filtro-busca" }, [
        el("label", { for: "busca-clientes-campo", text: "Busca" }),
        el("input", {
          id: "busca-clientes-campo",
          name: "busca",
          type: "search",
          placeholder: "Nome, e-mail ou CPF",
          value: estado.busca || "",
          autocomplete: "off",
        }),
      ]),
    ]),
    el("p", { class: "resumo", text: resumoClientes(clientes, estado.total || 0) }),
    el("div", { class: "pedidos-miolo" }, [
      lista,
      estado.cliente
        ? el("div", { class: "detalhe-camada", "data-fechar-fundo": "cliente" }, [painelCliente(estado.cliente)])
        : null,
      estado.detalhePedido
        ? el("div", { class: "detalhe-camada camada-pedido", "data-fechar-fundo": "pedido" }, [estado.detalhePedido])
        : null,
    ]),
  ]);
}

export function paginaClientes(estado) {
  return el("div", { class: "pagina pagina-clientes" }, [
    titulo("Clientes"),
    el("div", { id: "regiao-clientes" }, [mioloClientes(estado)]),
  ]);
}
