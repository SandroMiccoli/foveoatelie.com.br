// Situação do pedido depois do Mercado Pago. O status vem de consultar-pedido.
// A sacola só sai do navegador quando o pedido está pago.
(function () {
  "use strict";

  var lib = window.FoveoPedidoStatus;
  if (!lib) return;

  var STORAGE_KEY = "foveo-carrinho-v1";
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var INTERVALO = 3000;
  var LIMITE = 60000;

  var TITULOS = {
    pago: "Pagamento aprovado",
    etiqueta_gerada: "Etiqueta gerada",
    enviado: "Pedido enviado",
    entregue: "Pedido entregue",
    pronto_retirada: "Pronto pra retirada",
    retirado: "Pedido retirado"
  };

  var raiz = document.getElementById("pedido-pagina");
  if (!raiz) return;

  var titulo = document.getElementById("pedido-titulo");
  var nota = document.getElementById("pedido-nota");
  var resumo = document.getElementById("pedido-resumo");
  var prazo = document.getElementById("pedido-prazo");
  var acoes = document.getElementById("pedido-acoes");
  var acao = document.getElementById("pedido-acao");
  var whats = document.getElementById("pedido-whatsapp");
  var conferir = document.getElementById("pedido-conferir");
  var retentar = document.getElementById("pedido-retentar");
  var statusEl = document.getElementById("pedido-status");
  var statusRotulo = document.getElementById("pedido-status-rotulo");
  var secundario = document.getElementById("pedido-secundario");
  var secundarioLink = document.getElementById("pedido-secundario-link");
  var tentarDeNovo = document.getElementById("pedido-tentar-de-novo");
  var inicio = Date.now();
  var pedidoId = "";
  var esvaziou = false;

  function params() {
    return new URLSearchParams(location.search);
  }

  function idDoLink() {
    var q = params();
    var id = q.get("pedido") || q.get("external_reference") || "";
    return UUID.test(id) ? id.toLowerCase() : "";
  }

  function formatarBRL(centavos) {
    var fc = window.FoveoCatalog;
    if (fc && typeof fc.formatarPrecoBRL === "function") {
      var texto = fc.formatarPrecoBRL(Math.abs(centavos));
      if (texto) return texto;
    }
    var reais = Math.abs(centavos) / 100;
    if (centavos % 100 === 0) return "R$ " + Math.round(reais);
    return "R$ " + reais.toFixed(2).replace(".", ",");
  }

  function mostrarNota(texto) {
    if (!nota) return;
    nota.hidden = !texto;
    nota.textContent = texto || "";
  }

  function pintarStatus(status, opcoes) {
    if (!statusEl || !statusRotulo) return;
    var tom = lib.tomDoStatus(status, opcoes);
    var nivel = lib.nivelEstoqueDoTom(tom);
    var rotulo = lib.rotuloStatus(status, opcoes);
    statusEl.hidden = !rotulo;
    statusEl.setAttribute("data-stock-level", nivel);
    statusRotulo.textContent = rotulo;
  }

  function limparStatus() {
    if (!statusEl || !statusRotulo) return;
    statusEl.hidden = true;
    statusEl.removeAttribute("data-stock-level");
    statusRotulo.textContent = "";
  }

  function definirAcao(rotulo, href) {
    if (!acao) return;
    if (!rotulo || !href) {
      acao.hidden = true;
      acao.removeAttribute("href");
      acao.textContent = "";
      return;
    }
    acao.hidden = false;
    acao.href = href;
    acao.textContent = rotulo;
  }

  function esvaziarSacola() {
    if (esvaziou) return;
    esvaziou = true;
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }

  function linha(rotulo, valor, destaque) {
    var row = document.createElement("div");
    row.className = "pedido-linha" + (destaque ? " pedido-linha--total" : "");
    var dt = document.createElement("span");
    dt.textContent = rotulo;
    var dd = document.createElement("span");
    dd.textContent = valor;
    row.appendChild(dt);
    row.appendChild(dd);
    return row;
  }

  function desenharResumo(dados) {
    if (!resumo) return;
    resumo.textContent = "";
    resumo.hidden = false;

    var numero = document.createElement("p");
    numero.className = "pedido-numero";
    numero.textContent = "Pedido #" + dados.numero;
    resumo.appendChild(numero);

    var lista = document.createElement("ul");
    lista.className = "pedido-itens";
    (dados.itens || []).forEach(function (item) {
      var li = document.createElement("li");
      var nome = document.createElement("span");
      nome.textContent = item.nome;
      var preco = document.createElement("span");
      preco.textContent = item.qtd + " × " + formatarBRL(item.preco_unitario_centavos);
      li.appendChild(nome);
      li.appendChild(preco);
      lista.appendChild(li);
    });
    resumo.appendChild(lista);

    var totais = document.createElement("div");
    totais.className = "pedido-totais";
    totais.appendChild(linha("Subtotal", formatarBRL(dados.subtotal_centavos)));
    if (dados.desconto_centavos > 0) {
      var desconto = linha("Desconto combo", "– " + formatarBRL(dados.desconto_centavos));
      desconto.className += " pedido-linha--desconto";
      totais.appendChild(desconto);
    }
    var frete = dados.frete || {};
    var freteNome = dados.entrega_tipo === "retirada"
      ? "Retirada em BH"
      : [frete.transportadora, frete.servico].filter(Boolean).join(" ");
    var freteValor = dados.entrega_tipo === "retirada" || !frete.preco_centavos
      ? "Grátis"
      : formatarBRL(frete.preco_centavos);
    totais.appendChild(linha("Frete", freteNome ? freteNome + " · " + freteValor : freteValor));
    totais.appendChild(linha("Total", formatarBRL(dados.total_centavos), true));
    resumo.appendChild(totais);
  }

  function textoPrazo(dados) {
    var hrefWhats = linkWhatsapp(dados, "");
    return lib.mensagemContexto(dados, hrefWhats);
  }

  function linkWhatsapp(dados, extra) {
    var numero = (raiz.getAttribute("data-whatsapp") || "").replace(/\D/g, "");
    if (!numero) return "";
    var itens = (dados.itens || []).map(function (item) {
      return item.qtd + " " + item.nome;
    }).join(", ");
    var texto = "Olá! Fiz o pedido #" + dados.numero + " da Foveō: " + itens + ". Total " + formatarBRL(dados.total_centavos) + ".";
    if (extra) texto += " " + extra;
    return "https://wa.me/" + numero + "?text=" + encodeURIComponent(texto);
  }

  function esconderAcoes() {
    if (conferir) {
      conferir.hidden = true;
      conferir.disabled = false;
      conferir.textContent = "Conferir pagamento de novo";
      conferir.removeAttribute("aria-busy");
    }
    definirAcao("", "");
    if (whats) {
      whats.hidden = true;
      whats.removeAttribute("href");
    }
    if (retentar) {
      retentar.hidden = true;
      retentar.removeAttribute("href");
    }
    if (acoes) acoes.hidden = true;
    esconderSecundario();
  }

  function esconderSecundario() {
    if (secundario) secundario.hidden = true;
    if (secundarioLink) {
      secundarioLink.hidden = true;
      secundarioLink.removeAttribute("href");
      secundarioLink.textContent = "";
    }
    if (tentarDeNovo) tentarDeNovo.hidden = true;
  }

  function mostrarSecundarioLink(rotulo, href) {
    if (!secundario || !secundarioLink) return;
    if (tentarDeNovo) tentarDeNovo.hidden = true;
    secundario.hidden = false;
    secundarioLink.hidden = false;
    secundarioLink.href = href;
    secundarioLink.textContent = rotulo;
  }

  function mostrarTentarDeNovo() {
    if (!secundario || !tentarDeNovo) return;
    if (secundarioLink) {
      secundarioLink.hidden = true;
      secundarioLink.removeAttribute("href");
      secundarioLink.textContent = "";
    }
    secundario.hidden = false;
    tentarDeNovo.hidden = false;
  }

  function linkAcompanhar() {
    var base = raiz.getAttribute("data-rastreio") || "/rastreio/";
    var sep = base.indexOf("?") === -1 ? "?" : "&";
    return base + sep + "pedido=" + encodeURIComponent(pedidoId);
  }

  function mostrarAcoes() {
    if (!acoes) return;
    var algum = (conferir && !conferir.hidden) || (acao && !acao.hidden) || (whats && !whats.hidden) || (retentar && !retentar.hidden);
    acoes.hidden = !algum;
  }

  function checkoutConfiavel(url) {
    try {
      var u = new URL(url);
      if (u.protocol !== "https:") return false;
      return /(^|\.)mercadopago\.(com\.br|com|com\.ar|cl|com\.mx|com\.co|com\.pe|com\.uy)$/i.test(u.hostname);
    } catch (e) {
      return false;
    }
  }

  function ligarRetentar(url) {
    if (!retentar || !url || !checkoutConfiavel(url)) return;
    retentar.hidden = false;
    retentar.href = url;
  }

  function ligarWhatsapp(dados, extra) {
    var href = linkWhatsapp(dados, extra);
    if (!whats || !href) return;
    whats.hidden = false;
    whats.href = href;
    whats.target = "_blank";
    whats.rel = "noopener noreferrer";
  }

  function homeSacola() {
    var home = raiz.getAttribute("data-home") || "/";
    return home + (home.indexOf("?") === -1 ? "?" : "&") + "sacola=1";
  }

  function blocoRastreio(dados) {
    var antigo = document.getElementById("pedido-rastreio");
    if (antigo) antigo.remove();
    if (!dados || !dados.rastreio || !prazo || !prazo.parentNode) return;
    var bloco = document.createElement("div");
    bloco.id = "pedido-rastreio";
    bloco.className = "pedido-rastreio";
    var rotulo = document.createElement("p");
    rotulo.className = "pedido-nota";
    rotulo.textContent = "Rastreio " + dados.rastreio;
    bloco.appendChild(rotulo);
    if (dados.rastreio_url) {
      var link = document.createElement("a");
      link.className = "cta";
      link.href = dados.rastreio_url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Acompanhar na transportadora";
      bloco.appendChild(link);
    }
    prazo.parentNode.insertBefore(bloco, prazo.nextSibling);
  }

  function desenhar(dados) {
    if (!dados || !titulo) return;
    if (resumo) resumo.hidden = true;
    if (prazo) prazo.hidden = true;
    esconderAcoes();
    document.title = "Pedido — Foveō Ateliê";
    var opts = { retentativa: !!dados.retentativa };
    pintarStatus(dados.status, opts);

    if (lib.pagoOuDepois(dados.status)) {
      var tituloPago = TITULOS[dados.status] || "Pagamento aprovado";
      titulo.textContent = tituloPago;
      document.title = tituloPago + " — Foveō Ateliê";
      mostrarNota(dados.primeiro_nome ? "Obrigado, " + dados.primeiro_nome + "!" : "Obrigado!");
      desenharResumo(dados);
      if (prazo) {
        var frase = textoPrazo(dados);
        prazo.hidden = !frase;
        prazo.textContent = frase;
      }
      blocoRastreio(dados);
      ligarWhatsapp(dados, "");
      mostrarSecundarioLink("Acompanhar pedido", linkAcompanhar());
      mostrarAcoes();
      esvaziarSacola();
      return;
    }
    var velho = document.getElementById("pedido-rastreio");
    if (velho) velho.remove();

    if (dados.status === "pendente" && dados.retentativa) {
      titulo.textContent = "Pagamento não aprovado";
      document.title = "Pagamento não aprovado — Foveō Ateliê";
      mostrarNota(dados.checkout_url
        ? "O pagamento não foi aprovado. Tente de novo com outro cartão ou com Pix. As velas seguem reservadas por enquanto."
        : "O pagamento não foi aprovado. A reserva já acabou.");
      desenharResumo(dados);
      ligarRetentar(dados.checkout_url);
      if (acao) {
        acao.target = "";
        acao.rel = "";
      }
      definirAcao("Voltar à sacola", homeSacola());
      ligarWhatsapp(dados, "Pagamento não aprovado.");
      mostrarAcoes();
      return;
    }

    if (dados.status === "pendente") {
      titulo.textContent = "Pagamento em análise";
      document.title = "Pagamento em análise — Foveō Ateliê";
      mostrarNota("Pix e cartão podem levar alguns minutos. A página atualiza sozinha.");
      desenharResumo(dados);
      if (conferir) conferir.hidden = false;
      if (acao) {
        acao.target = "";
        acao.rel = "";
      }
      if (dados.checkout_url && checkoutConfiavel(dados.checkout_url)) {
        ligarRetentar(dados.checkout_url);
      } else {
        definirAcao("Voltar à sacola", homeSacola());
      }
      ligarWhatsapp(dados, "Pagamento em análise.");
      mostrarAcoes();
      return;
    }

    var extraWhats = "Pagamento não aprovado.";
    if (dados.status === "expirado") {
      titulo.textContent = "O tempo pra pagar acabou";
      extraWhats = "O tempo pra pagar acabou.";
    } else if (dados.status === "cancelado") {
      titulo.textContent = "Esse pedido foi cancelado";
      extraWhats = "Pedido cancelado.";
    } else if (dados.status === "reembolsado") {
      titulo.textContent = "Pedido reembolsado";
      extraWhats = "Pedido reembolsado.";
    } else {
      titulo.textContent = "Pagamento não aprovado";
    }
    document.title = titulo.textContent + " — Foveō Ateliê";
    mostrarNota("A sacola continua aqui.");
    if (acao) {
      acao.target = "";
      acao.rel = "";
    }
    definirAcao("Voltar à sacola", homeSacola());
    ligarWhatsapp(dados, extraWhats);
    mostrarAcoes();
  }

  function falhaConsulta(mensagem) {
    limparStatus();
    if (titulo) titulo.textContent = mensagem || "Não conseguimos consultar o pedido agora.";
    mostrarNota("Tente de novo em instantes.");
    if (resumo) resumo.hidden = true;
    if (prazo) prazo.hidden = true;
    var velho = document.getElementById("pedido-rastreio");
    if (velho) velho.remove();
    esconderAcoes();
    mostrarTentarDeNovo();
  }

  function consultar(manual) {
    var url = (raiz.getAttribute("data-supabase-url") || "").replace(/\/$/, "");
    var key = raiz.getAttribute("data-supabase-key") || "";
    if (!url || !key || typeof fetch !== "function") {
      falhaConsulta("Não conseguimos consultar o pedido agora.");
      return;
    }
    if (manual && conferir) {
      conferir.disabled = true;
      conferir.textContent = "Conferindo…";
      conferir.setAttribute("aria-busy", "true");
    }
    if (manual && tentarDeNovo && !tentarDeNovo.hidden) {
      tentarDeNovo.disabled = true;
      tentarDeNovo.textContent = "Consultando…";
    }

    fetch(url + "/functions/v1/consultar-pedido", {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: key },
      body: JSON.stringify({ pedido_id: pedidoId })
    })
      .then(function (res) {
        return res.json().then(function (dados) {
          return { ok: res.ok, status: res.status, dados: dados || {} };
        });
      })
      .then(function (resultado) {
        if (tentarDeNovo) {
          tentarDeNovo.disabled = false;
          tentarDeNovo.textContent = "Tentar de novo";
        }
        if (resultado.status === 404) {
          limparStatus();
          if (titulo) titulo.textContent = "Não achamos esse pedido.";
          mostrarNota("");
          esconderAcoes();
          mostrarTentarDeNovo();
          return;
        }
        if (!resultado.ok || !resultado.dados.status) throw new Error("consulta");
        desenhar(resultado.dados);
        if (!manual && resultado.dados.status === "pendente" && Date.now() - inicio < LIMITE) {
          window.setTimeout(function () { consultar(false); }, INTERVALO);
        }
      })
      .catch(function () {
        if (manual && conferir && !conferir.hidden) {
          conferir.disabled = false;
          conferir.textContent = "Conferir pagamento de novo";
          conferir.removeAttribute("aria-busy");
        }
        if (tentarDeNovo) {
          tentarDeNovo.disabled = false;
          tentarDeNovo.textContent = "Tentar de novo";
        }
        if (titulo && titulo.textContent === "Conferindo o pagamento.") {
          falhaConsulta("Não conseguimos consultar o pedido agora.");
        } else if (!manual && Date.now() - inicio < LIMITE) {
          window.setTimeout(function () { consultar(false); }, INTERVALO);
        } else {
          falhaConsulta("Não conseguimos consultar o pedido agora.");
        }
      });
  }

  pedidoId = idDoLink();
  if (!pedidoId) {
    limparStatus();
    if (titulo) titulo.textContent = "Não achamos esse pedido.";
    mostrarTentarDeNovo();
    return;
  }
  if (conferir) {
    conferir.addEventListener("click", function () {
      if (conferir.disabled) return;
      consultar(true);
    });
  }
  if (tentarDeNovo) {
    tentarDeNovo.addEventListener("click", function () {
      if (tentarDeNovo.disabled) return;
      if (titulo) titulo.textContent = "Conferindo o pagamento.";
      mostrarNota("");
      consultar(true);
    });
  }
  consultar(false);
})();
