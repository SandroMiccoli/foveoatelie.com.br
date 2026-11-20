(function () {
  "use strict";

  var lib = window.FoveoPedidoStatus;
  if (!lib) return;

  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var script = document.currentScript;
  var form = document.getElementById("form-rastreio");
  var erro = document.getElementById("erro");
  var resultado = document.getElementById("resultado");
  var codigo = document.getElementById("codigo");
  var email = document.getElementById("email");
  var cpf = document.getElementById("cpf");
  var botao = form ? form.querySelector("button") : null;

  function soDigitos(valor) {
    return String(valor || "").replace(/\D/g, "");
  }

  function mostrarErro(texto) {
    if (!erro) return;
    erro.hidden = !texto;
    erro.textContent = texto || "";
  }

  function marcarInvalido(campo, invalido) {
    if (!campo) return;
    if (invalido) campo.setAttribute("aria-invalid", "true");
    else campo.removeAttribute("aria-invalid");
  }

  function credencial() {
    var cod = soDigitos(codigo.value);
    var mail = email.value.trim().toLowerCase();
    var doc = soDigitos(cpf.value);
    var temEmail = mail.indexOf("@") > 0 && mail.indexOf(" ") === -1 && mail.indexOf(".") > 0;
    var temCpf = doc.length === 11;
    return {
      codigo: cod,
      email: temEmail ? mail : "",
      cpf: temCpf ? doc : "",
      codigoOk: /^\d{9}$/.test(cod),
      temUm: temEmail || temCpf
    };
  }

  function el(tag, attrs, texto) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (chave) {
        node.setAttribute(chave, attrs[chave]);
      });
    }
    if (texto) node.textContent = texto;
    return node;
  }

  function whatsappHref(dados) {
    var numero = ((script && script.getAttribute("data-whatsapp")) || "").replace(/\D/g, "");
    if (!numero) return "";
    var codigoPedido = dados.codigo || dados.numero || "";
    var texto = "Olá! Quero combinar a retirada do pedido #" + codigoPedido + " da Foveō.";
    return "https://wa.me/" + numero + "?text=" + encodeURIComponent(texto);
  }

  function preencherFormulario(dados) {
    if (dados.codigo && codigo) codigo.value = String(dados.codigo).replace(/\D/g, "").slice(0, 9);
    if (dados.email && email && !email.value) email.value = String(dados.email);
  }

  function desenhar(dados) {
    resultado.hidden = false;
    resultado.textContent = "";

    var opts = { retentativa: !!dados.retentativa };
    var tom = lib.tomDoStatus(dados.status, opts);
    var nivel = lib.nivelEstoqueDoTom(tom);
    var rotulo = lib.rotuloStatus(dados.status, opts);

    // Status uma vez: ponto + rótulo como título do resultado.
    var heading = el("h2", {
      class: "stock resultado-status",
      "data-stock-level": nivel
    });
    heading.appendChild(el("span", { class: "stock-dot", "aria-hidden": "true" }));
    heading.appendChild(el("span", {}, rotulo));
    resultado.appendChild(heading);

    var codigoTexto = dados.codigo || dados.numero || "";
    if (codigoTexto) {
      resultado.appendChild(el("p", { class: "codigo" }, "Pedido #" + codigoTexto));
    }

    var wa = whatsappHref(dados);
    var contexto = lib.mensagemContexto(dados, wa);
    if (contexto) {
      resultado.appendChild(el("p", { class: "resultado-contexto" }, contexto));
    }

    var lista = document.createElement("ol");
    lista.className = "linha";
    var passos = Array.isArray(dados.historico) ? dados.historico : [];
    if (!passos.length) passos = [{ status: dados.status, em: dados.em || "" }];
    passos.forEach(function (passo, indice) {
      var item = document.createElement("li");
      if (indice === passos.length - 1) item.setAttribute("aria-current", "step");
      var nome = el("span", { class: "passo-nome" }, lib.rotuloStatus(passo.status) || passo.status || "");
      item.appendChild(nome);
      var hora = lib.formatarQuando(passo.em);
      if (hora) item.appendChild(el("span", { class: "passo-quando" }, hora));
      lista.appendChild(item);
    });
    resultado.appendChild(lista);

    if (dados.rastreio) {
      var rastreioLinha = el("p", { class: "rastreio" });
      rastreioLinha.appendChild(document.createTextNode("Rastreio " + dados.rastreio));
      if (dados.rastreio_url) {
        rastreioLinha.appendChild(document.createTextNode(" · "));
        rastreioLinha.appendChild(el("a", {
          href: dados.rastreio_url,
          target: "_blank",
          rel: "noopener noreferrer"
        }, "ver na transportadora"));
      }
      resultado.appendChild(rastreioLinha);
    } else if (dados.rastreio_url) {
      var soLink = document.createElement("p");
      soLink.appendChild(el("a", {
        href: dados.rastreio_url,
        target: "_blank",
        rel: "noopener noreferrer"
      }, "Acompanhar na transportadora"));
      resultado.appendChild(soLink);
    }

    if (dados.entrega_tipo === "retirada" && lib.pagoOuDepois(dados.status) && wa) {
      resultado.appendChild(el("a", {
        class: "resultado-whats",
        href: wa,
        target: "_blank",
        rel: "noopener noreferrer"
      }, "Combinar retirada no WhatsApp"));
    }

    preencherFormulario(dados);
  }

  function endpoint() {
    var url = ((script && script.getAttribute("data-supabase-url")) || "").replace(/\/$/, "");
    var key = (script && script.getAttribute("data-supabase-key")) || "";
    return { url: url, key: key };
  }

  function consultarCorpo(corpo) {
    var cfg = endpoint();
    if (!cfg.url || !cfg.key) {
      mostrarErro("A consulta ainda não está disponível.");
      return Promise.resolve(null);
    }
    if (botao) {
      botao.disabled = true;
      botao.textContent = "Consultando";
    }
    return fetch(cfg.url + "/functions/v1/rastrear-pedido", {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: cfg.key },
      body: JSON.stringify(corpo)
    })
      .then(function (res) {
        return res.json().then(function (dados) {
          return { ok: res.ok, status: res.status, dados: dados || {} };
        });
      })
      .then(function (saida) {
        if (!saida) return;
        if (saida.status === 404) {
          resultado.hidden = true;
          mostrarErro("Não achamos um pedido com esses dados.");
          return;
        }
        if (saida.status === 429) {
          mostrarErro("Muitas consultas seguidas. Espere um minuto.");
          return;
        }
        if (!saida.ok || !saida.dados.status) throw new Error("consulta");
        mostrarErro("");
        desenhar(saida.dados);
      })
      .catch(function () {
        mostrarErro("Não conseguimos consultar agora. Tente de novo.");
      })
      .then(function () {
        if (botao) {
          botao.disabled = false;
          botao.textContent = "Ver pedido";
        }
      });
  }

  function uuidDoLink() {
    try {
      var id = new URLSearchParams(location.search).get("pedido") || "";
      return UUID.test(id) ? id.toLowerCase() : "";
    } catch (e) {
      return "";
    }
  }

  if (!form || !script) return;

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var cred = credencial();
    marcarInvalido(codigo, !cred.codigoOk);
    marcarInvalido(email, !cred.temUm && email.value.trim() !== "");
    marcarInvalido(cpf, !cred.temUm && cpf.value.trim() !== "");
    if (!cred.codigoOk) {
      mostrarErro("O código tem nove números, como 261120001.");
      codigo.focus();
      return;
    }
    if (!cred.temUm) {
      mostrarErro("Informe o e-mail da compra. Se não tiver, use o CPF.");
      email.focus();
      return;
    }
    mostrarErro("");
    consultarCorpo({ codigo: cred.codigo, email: cred.email, cpf: cred.cpf });
  });

  var pedidoUuid = uuidDoLink();
  if (pedidoUuid) {
    consultarCorpo({ pedido_id: pedidoUuid });
  }
})();
