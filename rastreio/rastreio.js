(function () {
  "use strict";

  var ROTULO = {
    pendente: "Pagamento em análise",
    pago: "Pagamento confirmado",
    etiqueta_gerada: "Etiqueta gerada",
    enviado: "Enviado",
    entregue: "Entregue",
    pronto_retirada: "Pronto pra retirada",
    retirado: "Retirado",
    expirado: "Tempo esgotado",
    recusado: "Pagamento recusado",
    cancelado: "Cancelado",
    reembolsado: "Reembolsado"
  };

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

  function quando(iso) {
    if (!iso) return "";
    var data = new Date(iso);
    if (Number.isNaN(data.getTime())) return "";
    return data.toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
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

  function desenhar(dados) {
    resultado.hidden = false;
    resultado.textContent = "";
    var status = ROTULO[dados.status] || "Em andamento";
    resultado.appendChild(el("h2", {}, status));
    resultado.appendChild(el("p", { class: "codigo" }, "Pedido #" + (dados.codigo || "")));
    var lista = document.createElement("ol");
    lista.className = "linha";
    var passos = Array.isArray(dados.historico) ? dados.historico : [];
    if (!passos.length) passos = [{ status: dados.status, em: "" }];
    passos.forEach(function (passo, indice) {
      var item = document.createElement("li");
      if (indice === passos.length - 1) item.setAttribute("aria-current", "step");
      var nome = el("span", { class: "passo-nome" }, ROTULO[passo.status] || passo.status || "");
      item.appendChild(nome);
      var hora = quando(passo.em);
      if (hora) item.appendChild(el("span", { class: "passo-quando" }, hora));
      lista.appendChild(item);
    });
    resultado.appendChild(lista);
    if (dados.rastreio) {
      var rastreio = el("p", { class: "rastreio" }, "Rastreio " + dados.rastreio);
      resultado.appendChild(rastreio);
    }
    if (dados.rastreio_url) {
      var link = el("a", { href: dados.rastreio_url, target: "_blank", rel: "noopener noreferrer" }, "Acompanhar na transportadora");
      var p = document.createElement("p");
      p.appendChild(link);
      resultado.appendChild(p);
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
      mostrarErro("Informe o e-mail da compra ou o CPF.");
      email.focus();
      return;
    }
    mostrarErro("");
    var url = (script.getAttribute("data-supabase-url") || "").replace(/\/$/, "");
    var key = script.getAttribute("data-supabase-key") || "";
    if (!url || !key) {
      mostrarErro("A consulta ainda não está disponível.");
      return;
    }
    if (botao) {
      botao.disabled = true;
      botao.textContent = "Consultando";
    }
    fetch(url + "/functions/v1/rastrear-pedido", {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: key },
      body: JSON.stringify({ codigo: cred.codigo, email: cred.email, cpf: cred.cpf })
    })
      .then(function (res) {
        return res.json().then(function (dados) {
          return { ok: res.ok, status: res.status, dados: dados || {} };
        });
      })
      .then(function (saida) {
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
  });
})();
