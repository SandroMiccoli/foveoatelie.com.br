// Situação do pedido depois do Mercado Pago. O status vem de consultar-pedido.
// A sacola só sai do navegador quando o pedido está pago.
(function () {
  "use strict";

  var STORAGE_KEY = "foveo-carrinho-v1";
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var INTERVALO = 3000;
  var LIMITE = 60000;
  var PAGOS = { pago: true, enviado: true, entregue: true };

  var raiz = document.getElementById("pedido-pagina");
  if (!raiz) return;

  var titulo = document.getElementById("pedido-titulo");
  var nota = document.getElementById("pedido-nota");
  var resumo = document.getElementById("pedido-resumo");
  var prazo = document.getElementById("pedido-prazo");
  var acao = document.getElementById("pedido-acao");
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

  function formatarDia(iso) {
    var p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    if (!p) return "";
    return p[3] + "/" + p[2];
  }

  function mostrarNota(texto) {
    if (!nota) return;
    nota.hidden = !texto;
    nota.textContent = texto || "";
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
    var dia = formatarDia(dados.data_postagem);
    if (!dia) return "";
    if (dados.entrega_tipo === "retirada") {
      return "Suas velas ficam prontas a partir de quarta\u2011feira, " + dia + ". Chama a gente no WhatsApp pra combinar a retirada.";
    }
    return "Seu pedido será postado na quarta\u2011feira, " + dia + ". O código de rastreio chega pelo WhatsApp.";
  }

  function linkWhatsapp(dados) {
    var numero = (raiz.getAttribute("data-whatsapp") || "").replace(/\D/g, "");
    if (!numero) return "";
    var itens = (dados.itens || []).map(function (item) {
      return item.qtd + " " + item.nome;
    }).join(", ");
    var texto = "Olá! Fiz o pedido #" + dados.numero + " da Foveō: " + itens + ". Total " + formatarBRL(dados.total_centavos) + ".";
    return "https://wa.me/" + numero + "?text=" + encodeURIComponent(texto);
  }

  function homeSacola() {
    var home = raiz.getAttribute("data-home") || "/";
    return home + (home.indexOf("?") === -1 ? "?" : "&") + "sacola=1";
  }

  function desenhar(dados, calmo) {
    if (!dados || !titulo) return;
    if (resumo) resumo.hidden = true;
    if (prazo) prazo.hidden = true;
    definirAcao("", "");
    document.title = "Pedido — Foveō Ateliê";

    if (PAGOS[dados.status]) {
      titulo.textContent = "Pagamento aprovado";
      document.title = "Pagamento aprovado — Foveō Ateliê";
      mostrarNota(dados.primeiro_nome ? "Obrigado, " + dados.primeiro_nome + "!" : "Obrigado!");
      desenharResumo(dados);
      if (prazo) {
        var frase = textoPrazo(dados);
        prazo.hidden = !frase;
        prazo.textContent = frase;
      }
      var whats = linkWhatsapp(dados);
      if (whats && acao) {
        definirAcao("Falar com a Foveō", whats);
        acao.target = "_blank";
        acao.rel = "noopener noreferrer";
      }
      esvaziarSacola();
      return;
    }

    if (dados.status === "pendente") {
      titulo.textContent = "Pagamento em análise";
      document.title = "Pagamento em análise — Foveō Ateliê";
      mostrarNota(calmo ? "Pix e cartão podem levar alguns minutos pra confirmar." : "");
      desenharResumo(dados);
      return;
    }

    if (dados.status === "expirado") titulo.textContent = "O tempo pra pagar acabou";
    else if (dados.status === "cancelado") titulo.textContent = "Esse pedido foi cancelado";
    else titulo.textContent = "Pagamento não aprovado";
    document.title = titulo.textContent + " — Foveō Ateliê";
    mostrarNota("A sacola continua aqui.");
    if (acao) {
      acao.target = "";
      acao.rel = "";
    }
    definirAcao("Voltar à sacola", homeSacola());
  }

  function consultar() {
    var url = (raiz.getAttribute("data-supabase-url") || "").replace(/\/$/, "");
    var key = raiz.getAttribute("data-supabase-key") || "";
    if (!url || !key || typeof fetch !== "function") {
      if (titulo) titulo.textContent = "Não conseguimos consultar o pedido agora.";
      mostrarNota("Atualize a página em instantes.");
      return;
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
        if (resultado.status === 404) {
          if (titulo) titulo.textContent = "Não achamos esse pedido.";
          mostrarNota("");
          return;
        }
        if (!resultado.ok || !resultado.dados.status) throw new Error("consulta");
        var calmo = resultado.dados.status === "pendente" && Date.now() - inicio >= LIMITE;
        desenhar(resultado.dados, calmo);
        if (resultado.dados.status === "pendente" && !calmo) {
          window.setTimeout(consultar, INTERVALO);
        }
      })
      .catch(function () {
        if (titulo && titulo.textContent === "Conferindo o pagamento.") {
          titulo.textContent = "Não conseguimos consultar o pedido agora.";
          mostrarNota("Atualize a página em instantes.");
        } else if (Date.now() - inicio < LIMITE) {
          window.setTimeout(consultar, INTERVALO);
        }
      });
  }

  pedidoId = idDoLink();
  if (!pedidoId) {
    if (titulo) titulo.textContent = "Não achamos esse pedido.";
    return;
  }
  consultar();
})();
