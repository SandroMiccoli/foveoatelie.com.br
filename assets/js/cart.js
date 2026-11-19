// ── Sacola de compras ──────────────────────────────────────────────────
// Quantidades no localStorage, combo via window.FoveoCatalog, estoque
// ao vivo quando o catálogo responde. O frete é cotado em cotar-frete.
// "Pagar com Mercado Pago" chama criar-pedido, que recota e reserva no
// servidor e devolve o checkout_url da Orders API. O preço nesta tela
// é só o que a pessoa vê.
//
// CEP, frete e os dados de quem compra ficam no mesmo localStorage.
//
// Só entra em ação quando os elementos do carrinho existem na página
// (hoje, só a home) — nas demais páginas este arquivo não faz nada,
// mesma filosofia de falha silenciosa do catalog.js.
window.FoveoCart = (function () {
  "use strict";

  var STORAGE_KEY = "foveo-carrinho-v1";
  var ID_RETIRADA = "retirada";
  var ROTULO_RETIRADA = "Retirar em BH (combinar)";
  var MSG_FRETE_INDISPONIVEL = "Não conseguimos calcular o frete agora";
  // Cautela otimista enquanto o estoque ao vivo de um produto ainda não
  // respondeu — não bloqueia quem está adicionando, a revalidação ajusta
  // depois. 99 é só um teto de sanidade, não uma meta de venda.
  var LIMITE_SEM_ESTOQUE = 99;
  // R$ 60 — só usado se nem o catálogo ao vivo nem o HTML tiverem o preço.
  var PRECO_UNITARIO_PADRAO = 6000;

  var catalogo = {}; // id -> { nome, precoUnitarioCentavos, disponivelReal }
  var carrinho = {}; // id -> quantidade
  var cepInformado = "";
  var cepParaRecalcular = "";
  var cepDaCidade = "";
  var cidadeUfManual = false;
  var viaCepSeq = 0;
  var freteEscolhido = null;
  var opcoesFrete = [];
  var freteRecalculando = false;
  var cotacaoSeq = 0;
  var assinaturaCotada = "";
  var assinaturaEmVoo = "";
  var estadoAtual = { itens: [], totalCentavos: 0, totalComFrete: 0, frete: null };
  var ultimoFoco = null;
  var dom = null;
  var comprador = compradorVazio();
  var checkoutEmVoo = false;
  var idempotencyKey = "";
  var enderecoAutomatico = false;

  // ---- armazenamento ----------------------------------------------------

  function limparMapaQtd(origem) {
    var limpo = {};
    if (!origem || typeof origem !== "object") return limpo;
    Object.keys(origem).forEach(function (id) {
      var qtd = Math.floor(Number(origem[id]));
      if (qtd > 0) limpo[id] = qtd;
    });
    return limpo;
  }

  function freteRetirada() {
    return {
      id: ID_RETIRADA,
      transportadora: "",
      servico: ROTULO_RETIRADA,
      preco_centavos: 0,
      prazo_dias: null
    };
  }

  function normalizarFrete(valor) {
    if (!valor || typeof valor !== "object") return null;
    if (valor.id === ID_RETIRADA) return freteRetirada();
    if (typeof valor.id !== "string" || !valor.id) return null;
    var preco = Math.round(Number(valor.preco_centavos));
    if (!isFinite(preco) || preco < 0) return null;
    var prazo = valor.prazo_dias == null ? null : Math.round(Number(valor.prazo_dias));
    if (prazo != null && (!isFinite(prazo) || prazo < 0)) prazo = null;
    return {
      id: valor.id,
      transportadora: typeof valor.transportadora === "string" ? valor.transportadora : "",
      servico: typeof valor.servico === "string" ? valor.servico : "Entrega",
      preco_centavos: preco,
      prazo_dias: prazo
    };
  }

  function compradorVazio() {
    return {
      nome: "",
      email: "",
      telefone: "",
      logradouro: "",
      numero: "",
      complemento: "",
      bairro: "",
      cidade: "",
      uf: ""
    };
  }

  function lerComprador(valor) {
    var base = compradorVazio();
    if (!valor || typeof valor !== "object") return base;
    Object.keys(base).forEach(function (chave) {
      if (typeof valor[chave] === "string") base[chave] = valor[chave];
    });
    base.telefone = mascararTelefone(base.telefone);
    base.uf = base.uf.toUpperCase().slice(0, 2);
    return base;
  }

  function lerEstadoSalvo() {
    var vazio = { carrinho: {}, cep: "", frete: null, comprador: compradorVazio() };
    var bruto = null;
    try {
      bruto = localStorage.getItem(STORAGE_KEY);
    } catch (e) {}
    if (!bruto) return vazio;
    try {
      var obj = JSON.parse(bruto);
      if (!obj || typeof obj !== "object") return vazio;
      // Formato antigo: mapa id -> quantidade, sem envelope.
      if (!Object.prototype.hasOwnProperty.call(obj, "itens")) {
        return { carrinho: limparMapaQtd(obj), cep: "", frete: null, comprador: compradorVazio() };
      }
      return {
        carrinho: limparMapaQtd(obj.itens),
        cep: typeof obj.cep === "string" ? mascararCep(obj.cep) : "",
        frete: normalizarFrete(obj.frete),
        comprador: lerComprador(obj.comprador)
      };
    } catch (e) {
      return vazio;
    }
  }

  function salvarEstado() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          itens: carrinho,
          cep: cepInformado,
          frete: freteEscolhido,
          comprador: comprador
        })
      );
    } catch (e) {}
  }

  // ---- catálogo -----------------------------------------------------------

  function centavosDoTexto(texto) {
    if (!texto) return null;
    var m = texto.match(/([\d.,]+)/);
    if (!m) return null;
    var normalizado = m[1].replace(/\./g, "").replace(",", ".");
    var valor = parseFloat(normalizado);
    if (!isFinite(valor)) return null;
    return Math.round(valor * 100);
  }

  // Semente inicial a partir do próprio HTML, pra sacola funcionar mesmo
  // se o Supabase não responder. disponivelReal fica null = "ainda não
  // sabemos o estoque real" (diferente de 0 = esgotado).
  function catalogoDoDom() {
    var mapa = {};
    var cards = document.querySelectorAll(".product[id]");
    Array.prototype.forEach.call(cards, function (card) {
      var titulo = card.querySelector(".product-heading h3");
      var precoEl = card.querySelector("[data-price]");
      mapa[card.id] = {
        nome: titulo ? titulo.textContent.trim() : card.id,
        precoUnitarioCentavos: centavosDoTexto(precoEl && precoEl.textContent) || PRECO_UNITARIO_PADRAO,
        disponivelReal: null
      };
    });
    return mapa;
  }

  function mesclarCatalogoAoVivo(produtos) {
    if (!produtos || !produtos.length) return;
    produtos.forEach(function (p) {
      if (!p || !p.id) return;
      var atual = catalogo[p.id] || {};
      catalogo[p.id] = {
        nome: atual.nome || p.nome || p.id,
        precoUnitarioCentavos:
          typeof p.preco_unitario_centavos === "number" ? p.preco_unitario_centavos : atual.precoUnitarioCentavos,
        disponivelReal: typeof p.disponivel_real === "number" ? p.disponivel_real : atual.disponivelReal
      };
    });
  }

  function estoqueCarregado(id) {
    var p = catalogo[id];
    return !!p && typeof p.disponivelReal === "number";
  }

  function limiteDisponivel(id) {
    var p = catalogo[id];
    if (!p) return 0;
    if (typeof p.disponivelReal === "number") return Math.max(0, p.disponivelReal);
    return LIMITE_SEM_ESTOQUE;
  }

  // Esgotado cobre dois casos: estoque real zerado, ou produto que nem
  // consta mais no catálogo (nunca deveria sumir, mas não apaga o item
  // do carrinho em silêncio se acontecer — fica flagado pro cliente remover).
  function produtoEsgotado(id) {
    var p = catalogo[id];
    if (!p) return true;
    return estoqueCarregado(id) && limiteDisponivel(id) <= 0;
  }

  // ---- preço (reaproveita window.FoveoCatalog; nunca duplica a regra) ---

  function formatarBRL(centavos) {
    var fc = window.FoveoCatalog;
    var texto = fc && typeof fc.formatarPrecoBRL === "function" && fc.formatarPrecoBRL(Math.abs(centavos));
    if (texto) return centavos < 0 ? "– " + texto : texto;
    var reais = Math.abs(centavos) / 100;
    return (centavos < 0 ? "– " : "") + "R$ " + reais.toFixed(2).replace(".", ",");
  }

  function precoTotal(qtd) {
    var fc = window.FoveoCatalog;
    if (fc && typeof fc.calcularPrecoCentavos === "function") return fc.calcularPrecoCentavos(qtd);
    // Mesma regra do catalog.js, só pro raro caso dele não ter carregado.
    if (typeof qtd !== "number" || qtd < 1) return 0;
    var trios = Math.floor(qtd / 3);
    var resto = qtd % 3;
    var porResto = resto === 0 ? 0 : resto === 1 ? 6000 : 11000;
    return trios * 15000 + porResto;
  }

  // ---- mutações do carrinho ----------------------------------------------

  function adicionar(id) {
    if (produtoEsgotado(id)) return false;
    var limite = limiteDisponivel(id);
    var atual = carrinho[id] || 0;
    if (atual >= limite) return false;
    carrinho[id] = atual + 1;
    invalidarChave();
    salvarEstado();
    render();
    recalcularFreteSePrecisar();
    return true;
  }

  function alterarQtd(id, delta) {
    var atual = carrinho[id] || 0;
    var novo = atual + delta;
    var limite = limiteDisponivel(id);
    if (novo > limite) novo = limite;
    if (novo < 0) novo = 0;
    if (novo === 0) delete carrinho[id];
    else carrinho[id] = novo;
    invalidarChave();
    salvarEstado();
    render();
    recalcularFreteSePrecisar();
  }

  function remover(id) {
    delete carrinho[id];
    invalidarChave();
    salvarEstado();
    render();
    recalcularFreteSePrecisar();
  }

  // ---- renderização -------------------------------------------------------

  function render() {
    if (!dom) return;

    var sujo = false;
    var itens = [];
    var totalAtivo = 0;
    var subtotal = 0;

    Object.keys(carrinho).forEach(function (id) {
      var qtdSalva = carrinho[id];
      if (!qtdSalva || qtdSalva < 1) {
        delete carrinho[id];
        sujo = true;
        return;
      }

      var p = catalogo[id];
      var esgotado = produtoEsgotado(id);
      var qtd = qtdSalva;

      if (!esgotado) {
        var limite = limiteDisponivel(id);
        qtd = Math.min(qtdSalva, limite);
        if (qtd < 1) {
          delete carrinho[id];
          sujo = true;
          return;
        }
        if (qtd !== qtdSalva) {
          carrinho[id] = qtd;
          sujo = true;
        }
      }

      var precoUnit = (p && p.precoUnitarioCentavos) || PRECO_UNITARIO_PADRAO;
      var item = {
        id: id,
        nome: (p && p.nome) || id,
        precoUnitarioCentavos: precoUnit,
        qtd: qtd,
        limite: limiteDisponivel(id),
        esgotado: esgotado
      };
      itens.push(item);

      if (!esgotado) {
        totalAtivo += qtd;
        subtotal += qtd * precoUnit;
      }
    });

    if (sujo) salvarEstado();

    var totalCentavos = precoTotal(totalAtivo);
    var descontoCentavos = Math.max(0, subtotal - totalCentavos);

    estadoAtual.itens = itens;
    estadoAtual.totalCentavos = totalCentavos;

    desenharItens(itens);
    desenharTotais(subtotal, descontoCentavos, totalCentavos, totalAtivo > 0);
    desenharNudge(totalAtivo);
    atualizarContador(totalAtivo);
    sincronizarBotoesAdicionar();
    if (dom.frete) dom.frete.hidden = !(totalAtivo > 0);
    if (dom.dados) dom.dados.hidden = !(totalAtivo > 0);
    sincronizarEndereco();
  }

  function desenharItens(itens) {
    dom.empty.hidden = itens.length > 0;
    dom.itemsList.textContent = "";
    itens.forEach(function (item) {
      dom.itemsList.appendChild(linhaDoItem(item));
    });
  }

  function linhaDoItem(item) {
    var li = document.createElement("li");
    li.className = "cart-item" + (item.esgotado ? " is-esgotado" : "");
    li.setAttribute("data-cart-item", "");
    li.setAttribute("data-id", item.id);

    var info = document.createElement("div");
    info.className = "cart-item-info";

    var nome = document.createElement("p");
    nome.className = "cart-item-name";
    nome.textContent = item.nome;
    info.appendChild(nome);

    if (item.esgotado) {
      var flag = document.createElement("p");
      flag.className = "cart-item-flag";
      flag.textContent = "Esgotado — remova para continuar";
      info.appendChild(flag);
    } else {
      var unidade = document.createElement("p");
      unidade.className = "cart-item-unit";
      unidade.textContent = formatarBRL(item.precoUnitarioCentavos) + " cada";
      info.appendChild(unidade);
    }

    li.appendChild(info);

    var total = document.createElement("p");
    total.className = "cart-item-total";
    total.textContent = item.esgotado ? "—" : formatarBRL(item.qtd * item.precoUnitarioCentavos);
    li.appendChild(total);

    var qtyWrap = document.createElement("div");
    qtyWrap.className = "cart-item-qty";

    var btnDec = document.createElement("button");
    btnDec.type = "button";
    btnDec.className = "qty-btn";
    btnDec.setAttribute("data-qty-dec", "");
    btnDec.setAttribute("aria-label", "Diminuir quantidade de " + item.nome);
    btnDec.textContent = "–";
    btnDec.disabled = item.esgotado;
    qtyWrap.appendChild(btnDec);

    var valor = document.createElement("span");
    valor.className = "qty-value";
    valor.setAttribute("aria-live", "polite");
    valor.textContent = String(item.qtd);
    qtyWrap.appendChild(valor);

    var btnInc = document.createElement("button");
    btnInc.type = "button";
    btnInc.className = "qty-btn";
    btnInc.setAttribute("data-qty-inc", "");
    btnInc.setAttribute("aria-label", "Aumentar quantidade de " + item.nome);
    btnInc.textContent = "+";
    btnInc.disabled = item.esgotado || item.qtd >= item.limite;
    qtyWrap.appendChild(btnInc);

    li.appendChild(qtyWrap);

    var remover = document.createElement("button");
    remover.type = "button";
    remover.className = "cart-item-remove";
    remover.setAttribute("data-remove", "");
    remover.setAttribute("aria-label", "Remover " + item.nome + " da sacola");
    remover.textContent = "Remover";
    li.appendChild(remover);

    return li;
  }

  function freteEntraNoTotal() {
    if (!freteEscolhido) return false;
    if (freteRecalculando && freteEscolhido.id !== ID_RETIRADA) return false;
    return true;
  }

  function totalComFreteDe(totalProdutos) {
    if (!freteEntraNoTotal()) return totalProdutos;
    return totalProdutos + (freteEscolhido.preco_centavos || 0);
  }

  function textoFrete() {
    if (freteRecalculando && (!freteEscolhido || freteEscolhido.id !== ID_RETIRADA)) return "Calculando…";
    if (!freteEscolhido) return "A escolher";
    if (freteEscolhido.id === ID_RETIRADA) return "Grátis";
    return formatarBRL(freteEscolhido.preco_centavos);
  }

  function desenharTotais(subtotal, desconto, totalProdutos, temAlgoAComprar) {
    dom.foot.hidden = !temAlgoAComprar;
    dom.subtotal.textContent = formatarBRL(subtotal);
    if (desconto > 0) {
      dom.discountRow.hidden = false;
      dom.discount.textContent = "– " + formatarBRL(desconto);
    } else {
      dom.discountRow.hidden = true;
    }
    if (dom.freight) dom.freight.textContent = textoFrete();
    var total = totalComFreteDe(totalProdutos);
    estadoAtual.totalComFrete = total;
    estadoAtual.frete = freteEntraNoTotal() ? freteEscolhido : null;
    dom.total.textContent = formatarBRL(total);
  }

  // Mostra o empurrãozinho só quando a próxima vela custaria menos que o
  // preço cheio (ou seja, quando ela completa ou aproxima um combo) e
  // existe estoque de verdade pra alguém aceitar a sugestão.
  function desenharNudge(totalAtivo) {
    if (totalAtivo < 1) {
      dom.nudge.hidden = true;
      return;
    }
    var atual = precoTotal(totalAtivo);
    var proximo = precoTotal(totalAtivo + 1);
    var extra = proximo - atual;
    if (extra >= PRECO_UNITARIO_PADRAO) {
      dom.nudge.hidden = true;
      return;
    }
    var haEstoqueParaMais = Object.keys(catalogo).some(function (id) {
      if (produtoEsgotado(id)) return false;
      return limiteDisponivel(id) > (carrinho[id] || 0);
    });
    if (!haEstoqueParaMais) {
      dom.nudge.hidden = true;
      return;
    }
    dom.nudge.hidden = false;
    dom.nudge.textContent = "Adicione mais 1 vela e pague só " + formatarBRL(extra) + " nela — o combo libera o desconto.";
  }

  function atualizarContador(totalAtivo) {
    if (dom.count) {
      if (totalAtivo > 0) {
        dom.count.hidden = false;
        dom.count.textContent = totalAtivo > 99 ? "99+" : String(totalAtivo);
      } else {
        dom.count.hidden = true;
        dom.count.textContent = "0";
      }
    }
    if (dom.toggle) {
      dom.toggle.setAttribute(
        "aria-label",
        totalAtivo > 0
          ? "Abrir sacola de compras, " + totalAtivo + (totalAtivo === 1 ? " item" : " itens")
          : "Abrir sacola de compras"
      );
    }
  }

  function sincronizarBotoesAdicionar() {
    var botoes = document.querySelectorAll("[data-add-to-cart]");
    Array.prototype.forEach.call(botoes, function (btn) {
      var id = btn.getAttribute("data-id");
      if (produtoEsgotado(id)) {
        btn.disabled = true;
        btn.textContent = "Esgotado";
        return;
      }
      var limite = limiteDisponivel(id);
      var noCarrinho = carrinho[id] || 0;
      if (noCarrinho >= limite) {
        btn.disabled = true;
        btn.textContent = "Máximo na sacola";
        return;
      }
      btn.disabled = false;
      btn.textContent = "Adicionar à sacola";
    });
  }

  // ---- pagamento (Mercado Pago Checkout Pro) ----------------------------

  function invalidarChave(forcar) {
    if (checkoutEmVoo && !forcar) return;
    idempotencyKey = "";
  }

  function chaveCheckout() {
    if (!idempotencyKey && window.crypto && typeof crypto.randomUUID === "function") {
      idempotencyKey = crypto.randomUUID();
    }
    return idempotencyKey;
  }

  function mostrarErroCheckout(texto) {
    if (!dom.erro) return;
    dom.erro.hidden = !texto;
    dom.erro.textContent = texto || "";
  }

  function marcarInvalido(el, invalido) {
    if (!el) return;
    el.setAttribute("aria-invalid", invalido ? "true" : "false");
  }

  function lerCompradorDoForm() {
    if (!dom.nome) return;
    comprador = {
      nome: dom.nome.value,
      email: dom.email ? dom.email.value : "",
      telefone: dom.telefone ? dom.telefone.value : "",
      logradouro: dom.logradouro ? dom.logradouro.value : "",
      numero: dom.numero ? dom.numero.value : "",
      complemento: dom.complemento ? dom.complemento.value : "",
      bairro: dom.bairro ? dom.bairro.value : "",
      cidade: dom.cidade ? dom.cidade.value : "",
      uf: dom.uf ? dom.uf.value : ""
    };
  }

  function preencherComprador() {
    if (!dom.nome) return;
    dom.nome.value = comprador.nome || "";
    if (dom.email) dom.email.value = comprador.email || "";
    if (dom.telefone) dom.telefone.value = mascararTelefone(comprador.telefone || "");
    if (dom.logradouro) dom.logradouro.value = comprador.logradouro || "";
    if (dom.numero) dom.numero.value = comprador.numero || "";
    if (dom.complemento) dom.complemento.value = comprador.complemento || "";
    if (dom.bairro) dom.bairro.value = comprador.bairro || "";
    if (dom.cidade) dom.cidade.value = comprador.cidade || "";
    if (dom.uf) dom.uf.value = (comprador.uf || "").toUpperCase();
  }

  function entregaEhRetirada() {
    return !!(freteEscolhido && freteEscolhido.id === ID_RETIRADA);
  }

  function sincronizarEndereco() {
    if (!dom.endereco) return;
    var mostra = !!(dom.dados && !dom.dados.hidden && freteEscolhido && !entregaEhRetirada());
    dom.endereco.hidden = !mostra;
  }

  function digitosTelefone(valor) {
    var d = String(valor || "").replace(/\D/g, "");
    if (d.indexOf("55") === 0 && d.length > 11) d = d.slice(2);
    return d.slice(0, 11);
  }

  function mascararTelefone(valor) {
    var d = digitosTelefone(valor);
    if (d.length < 1) return "";
    if (d.length < 3) return "(" + d;
    if (d.length < 7) return "(" + d.slice(0, 2) + ") " + d.slice(2);
    if (d.length <= 10) return "(" + d.slice(0, 2) + ") " + d.slice(2, 6) + "-" + d.slice(6);
    return "(" + d.slice(0, 2) + ") " + d.slice(2, 7) + "-" + d.slice(7);
  }

  function emailValido(valor) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(valor || "").trim());
  }

  function aoEditarComprador(evento) {
    var alvo = evento && evento.target;
    if (alvo && alvo.setAttribute) alvo.setAttribute("aria-invalid", "false");
    mostrarErroCheckout("");
    if (alvo === dom.logradouro) enderecoAutomatico = false;
    if (alvo === dom.cidade || alvo === dom.uf) cidadeUfManual = true;
    if (alvo === dom.telefone && dom.telefone) {
      var antes = dom.telefone.value;
      var pos = typeof dom.telefone.selectionStart === "number" ? dom.telefone.selectionStart : antes.length;
      var digitosAntes = digitosTelefone(antes.slice(0, pos)).length;
      var mascarado = mascararTelefone(antes);
      if (antes !== mascarado) {
        dom.telefone.value = mascarado;
        var novaPos = 0;
        var vistos = 0;
        while (novaPos < mascarado.length && vistos < digitosAntes) {
          if (/\d/.test(mascarado.charAt(novaPos))) vistos += 1;
          novaPos += 1;
        }
        if (dom.telefone.setSelectionRange) dom.telefone.setSelectionRange(novaPos, novaPos);
      }
    }
    if (alvo === dom.uf && dom.uf) dom.uf.value = dom.uf.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
    lerCompradorDoForm();
    invalidarChave();
    salvarEstado();
  }

  function preencherEnderecoViaCep(dados) {
    if (!dados || dados.erro) return;
    if (dom.logradouro && !dom.logradouro.value && dados.logradouro) {
      dom.logradouro.value = dados.logradouro;
      enderecoAutomatico = true;
    } else if (enderecoAutomatico && dom.logradouro && dados.logradouro) {
      dom.logradouro.value = dados.logradouro;
    }
    if (dom.bairro && (!dom.bairro.value || enderecoAutomatico) && dados.bairro) dom.bairro.value = dados.bairro;
    lerCompradorDoForm();
    salvarEstado();
  }

  function limparCidadeUf() {
    if (dom.cidade) dom.cidade.value = "";
    if (dom.uf) dom.uf.value = "";
    cepDaCidade = "";
    cidadeUfManual = false;
  }

  function aplicarCidadeUf(dados, cep) {
    if (!dom.cidade || !dom.uf) return;
    if (digitosCep(cepInformado) !== cep) return;
    if (!dados || dados.erro) return;
    var cidade = typeof dados.localidade === "string" ? dados.localidade.trim() : "";
    var uf = typeof dados.uf === "string" ? dados.uf.trim().toUpperCase() : "";
    if (cidade.length < 2 || !/^[A-Z]{2}$/.test(uf)) return;
    if (cidadeUfManual && cepDaCidade === cep) return;
    dom.cidade.value = cidade;
    dom.uf.value = uf;
    cepDaCidade = cep;
    cidadeUfManual = false;
    lerCompradorDoForm();
    salvarEstado();
  }

  function buscarViaCep() {
    if (!cepValido(cepInformado) || typeof fetch !== "function") return;
    var cep = digitosCep(cepInformado);
    var seq = ++viaCepSeq;
    fetch("https://viacep.com.br/ws/" + cep + "/json/")
      .then(function (res) {
        if (!res.ok) throw new Error("status");
        return res.json();
      })
      .then(function (dados) {
        if (seq !== viaCepSeq) return;
        if (digitosCep(cepInformado) !== cep) return;
        preencherEnderecoViaCep(dados);
        aplicarCidadeUf(dados, cep);
      })
      .catch(function () {});
  }

  function configPedido() {
    var root = document.querySelector("[data-supabase-url]");
    if (!root || typeof fetch !== "function") return null;
    var url = root.getAttribute("data-supabase-url");
    var key = root.getAttribute("data-supabase-key");
    if (!url || !key) return null;
    return { url: url.replace(/\/$/, "") + "/functions/v1/criar-pedido", key: key };
  }

  function urlCheckoutSegura(url) {
    try {
      var u = new URL(url);
      if (u.protocol !== "https:") return false;
      return /(^|\.)mercadopago\.(com\.br|com|com\.ar|cl|com\.mx|com\.co|com\.pe|com\.uy)$/i.test(u.hostname);
    } catch (e) {
      return false;
    }
  }

  function mensagemErroPedido(codigo) {
    if (codigo === "estoque") return "A quantidade de alguma vela mudou. Atualize a página para ver o estoque.";
    if (codigo === "frete_opcao") return "Essa opção de frete não está mais disponível. Calcule de novo.";
    if (codigo === "cotacao_indisponivel") return "Não conseguimos calcular o frete agora. Tente de novo em instantes.";
    if (codigo === "idempotencia") return "Não conseguimos retomar esse pagamento. Tente de novo.";
    if (codigo === "pedido_invalido" || codigo === "origem" || codigo === "metodo") return "Confira os dados e tente de novo.";
    return "Não conseguimos abrir o Mercado Pago agora. Tente de novo.";
  }

  function validarCheckout() {
    lerCompradorDoForm();
    var foco = null;
    var mensagem = "";

    function falhar(el, texto) {
      if (!mensagem) {
        mensagem = texto;
        foco = el;
      }
      marcarInvalido(el, true);
    }

    marcarInvalido(dom.nome, false);
    marcarInvalido(dom.email, false);
    marcarInvalido(dom.telefone, false);
    marcarInvalido(dom.cep, false);
    marcarInvalido(dom.logradouro, false);
    marcarInvalido(dom.numero, false);
    marcarInvalido(dom.bairro, false);
    marcarInvalido(dom.cidade, false);
    marcarInvalido(dom.uf, false);

    var ativos = estadoAtual.itens.filter(function (item) {
      return !item.esgotado && item.qtd > 0;
    });
    if (!ativos.length) {
      mostrarErroCheckout("A sacola não tem vela disponível para pagar.");
      return null;
    }
    if (!freteEscolhido || (freteRecalculando && !entregaEhRetirada())) {
      falhar(dom.cep, "Escolha o frete ou a retirada em BH.");
    } else if (!entregaEhRetirada()) {
      if (!cepValido(cepInformado) || assinaturaCotada !== assinaturaPedido()) {
        falhar(dom.cep, "Calcule o frete de novo. A sacola ou o CEP mudou.");
      }
    }

    if (comprador.nome.trim().length < 2 || !/[A-Za-zÀ-ÿ]/.test(comprador.nome)) falhar(dom.nome, "Escreva seu nome.");
    if (!emailValido(comprador.email)) falhar(dom.email, "Confira o e-mail.");
    if (digitosTelefone(comprador.telefone).length < 10) falhar(dom.telefone, "Confira o WhatsApp, com DDD.");

    if (freteEscolhido && !entregaEhRetirada()) {
      if (comprador.logradouro.trim().length < 2) falhar(dom.logradouro, "Preencha o endereço de entrega.");
      if (!comprador.numero.trim()) falhar(dom.numero, "Preencha o endereço de entrega.");
      if (comprador.bairro.trim().length < 1) falhar(dom.bairro, "Preencha o endereço de entrega.");
      if (comprador.cidade.trim().length < 2) falhar(dom.cidade, "Preencha o endereço de entrega.");
      if (!/^[A-Z]{2}$/.test((comprador.uf || "").toUpperCase())) falhar(dom.uf, "Preencha o endereço de entrega.");
    }

    if (mensagem) {
      mostrarErroCheckout(mensagem);
      if (foco && typeof foco.focus === "function") foco.focus();
      return null;
    }
    mostrarErroCheckout("");
    return ativos;
  }

  function corpoDoPedido(ativos) {
    var entrega;
    if (entregaEhRetirada()) {
      entrega = { tipo: "retirada" };
    } else {
      entrega = {
        tipo: "envio",
        frete_id: freteEscolhido.id,
        cep: digitosCep(cepInformado),
        endereco: {
          logradouro: comprador.logradouro.trim(),
          numero: comprador.numero.trim(),
          complemento: comprador.complemento.trim(),
          bairro: comprador.bairro.trim(),
          cidade: comprador.cidade.trim(),
          uf: comprador.uf.toUpperCase()
        }
      };
    }
    return {
      idempotency_key: chaveCheckout(),
      comprador: {
        nome: comprador.nome.trim(),
        email: comprador.email.trim(),
        telefone: digitosTelefone(comprador.telefone)
      },
      entrega: entrega,
      itens: ativos.map(function (item) {
        return { produto_id: item.id, qtd: item.qtd };
      })
    };
  }

  function travarCheckout(travado) {
    checkoutEmVoo = travado;
    if (dom.checkout) {
      dom.checkout.disabled = travado;
      dom.checkout.textContent = travado ? "Abrindo o pagamento…" : "Pagar com Mercado Pago";
    }
    if (dom.drawer) {
      if (travado) dom.drawer.setAttribute("aria-busy", "true");
      else dom.drawer.removeAttribute("aria-busy");
    }
    if (dom.corpo) {
      if (travado) dom.corpo.setAttribute("inert", "");
      else dom.corpo.removeAttribute("inert");
    }
  }

  function tratarFinalizar(evento) {
    if (evento) evento.preventDefault();
    if (checkoutEmVoo) return;
    var ativos = validarCheckout();
    if (!ativos) return;

    var cfg = configPedido();
    var chave = chaveCheckout();
    if (!cfg || !chave) {
      mostrarErroCheckout("Não conseguimos abrir o Mercado Pago agora. Tente de novo.");
      return;
    }

    travarCheckout(true);
    mostrarErroCheckout("");
    if (typeof window.gtag === "function") window.gtag("event", "begin_checkout");

    fetch(cfg.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: cfg.key
      },
      body: JSON.stringify(corpoDoPedido(ativos))
    })
      .then(function (res) {
        return res.json().then(function (dados) {
          return { ok: res.ok, dados: dados || {} };
        });
      })
      .then(function (resultado) {
        if (!resultado.ok || !resultado.dados.checkout_url || !urlCheckoutSegura(resultado.dados.checkout_url)) {
          if (!resultado.dados || resultado.dados.repetir !== true) invalidarChave(true);
          if (resultado.dados && resultado.dados.erro === "estoque" && window.FoveoCatalog && typeof window.FoveoCatalog.obterCatalogo === "function") {
            window.FoveoCatalog.obterCatalogo(true).then(function (produtos) {
              mesclarCatalogoAoVivo(produtos);
              render();
            });
          }
          throw new Error((resultado.dados && resultado.dados.erro) || "pagamento_indisponivel");
        }
        window.location.assign(resultado.dados.checkout_url);
      })
      .catch(function (err) {
        travarCheckout(false);
        var codigo = err && err.message ? err.message : "";
        mostrarErroCheckout(mensagemErroPedido(codigo));
      });
  }

  // ---- abrir/fechar + foco --------------------------------------------

  function elementosFocaveis(raiz) {
    return Array.prototype.filter.call(
      raiz.querySelectorAll(
        "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
      ),
      function (el) {
        return el.offsetParent !== null || el === document.activeElement;
      }
    );
  }

  function estaAberto() {
    return !!(dom && dom.drawer && !dom.drawer.hidden);
  }

  function abrir(origem) {
    if (!dom || estaAberto()) return;
    ultimoFoco = origem || document.activeElement;
    dom.overlay.hidden = false;
    dom.drawer.hidden = false;
    document.body.classList.add("cart-open");
    if (dom.toggle) dom.toggle.setAttribute("aria-expanded", "true");
    window.requestAnimationFrame(function () {
      dom.overlay.classList.add("is-open");
      dom.drawer.classList.add("is-open");
    });
    window.setTimeout(function () {
      if (dom.close) dom.close.focus();
    }, 10);
  }

  function fechar(restaurarFoco) {
    if (!estaAberto()) return;
    dom.overlay.classList.remove("is-open");
    dom.drawer.classList.remove("is-open");
    if (dom.toggle) dom.toggle.setAttribute("aria-expanded", "false");
    var reduzido = false;
    try {
      reduzido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) {}
    var finalizarFechamento = function () {
      dom.overlay.hidden = true;
      dom.drawer.hidden = true;
      document.body.classList.remove("cart-open");
    };
    if (reduzido) finalizarFechamento();
    else window.setTimeout(finalizarFechamento, 380);
    if (restaurarFoco && ultimoFoco && typeof ultimoFoco.focus === "function") ultimoFoco.focus();
  }

  // ---- eventos ------------------------------------------------------------

  function tratarClique(evento) {
    var alvo = evento.target;
    if (!alvo || !alvo.closest) return;

    var addBtn = alvo.closest("[data-add-to-cart]");
    if (addBtn) {
      var id = addBtn.getAttribute("data-id");
      if (id && adicionar(id)) {
        abrir(addBtn);
        if (typeof window.gtag === "function") window.gtag("event", "add_to_cart", { item_id: id });
      }
      return;
    }

    if (dom.toggle && dom.toggle.contains(alvo)) {
      if (estaAberto()) fechar(true);
      else abrir(dom.toggle);
      return;
    }

    if (dom.close && dom.close.contains(alvo)) {
      fechar(true);
      return;
    }

    if (alvo === dom.overlay) {
      fechar(true);
      return;
    }

    var incBtn = alvo.closest("[data-qty-inc]");
    if (incBtn) {
      var itemInc = incBtn.closest("[data-cart-item]");
      if (itemInc) alterarQtd(itemInc.getAttribute("data-id"), 1);
      return;
    }

    var decBtn = alvo.closest("[data-qty-dec]");
    if (decBtn) {
      var itemDec = decBtn.closest("[data-cart-item]");
      if (itemDec) alterarQtd(itemDec.getAttribute("data-id"), -1);
      return;
    }

    var remBtn = alvo.closest("[data-remove]");
    if (remBtn) {
      var itemRem = remBtn.closest("[data-cart-item]");
      if (itemRem) remover(itemRem.getAttribute("data-id"));
      return;
    }

  }

  function tratarTeclado(evento) {
    if (!estaAberto()) return;
    if (evento.key === "Escape") {
      evento.stopPropagation();
      fechar(true);
      return;
    }
    if (evento.key !== "Tab") return;
    var itens = elementosFocaveis(dom.drawer);
    if (!itens.length) return;
    var primeiro = itens[0];
    var ultimo = itens[itens.length - 1];
    if (evento.shiftKey && document.activeElement === primeiro) {
      evento.preventDefault();
      ultimo.focus();
    } else if (!evento.shiftKey && document.activeElement === ultimo) {
      evento.preventDefault();
      primeiro.focus();
    }
  }

  // ---- frete --------------------------------------------------------------

  function digitosCep(valor) {
    return String(valor || "").replace(/\D/g, "").slice(0, 8);
  }

  function mascararCep(valor) {
    var digitos = digitosCep(valor);
    if (digitos.length <= 5) return digitos;
    return digitos.slice(0, 5) + "-" + digitos.slice(5);
  }

  function cepValido(valor) {
    return /^\d{5}-\d{3}$/.test(mascararCep(valor));
  }

  function textoPrazo(dias) {
    if (dias === 0) return "No mesmo dia";
    if (dias === 1) return "1 dia útil";
    return dias + " dias úteis";
  }

  function configFrete() {
    var root = document.querySelector("[data-supabase-url]");
    if (!root || typeof fetch !== "function") return null;
    var url = root.getAttribute("data-supabase-url");
    var key = root.getAttribute("data-supabase-key");
    if (!url || !key) return null;
    return { url: url.replace(/\/$/, "") + "/functions/v1/cotar-frete", key: key };
  }

  function itensParaCotacao() {
    var lista = [];
    Object.keys(carrinho).forEach(function (id) {
      if (produtoEsgotado(id)) return;
      var qtd = carrinho[id];
      if (qtd > 0) lista.push({ produto_id: id, qtd: qtd });
    });
    return lista;
  }

  function assinaturaPedido() {
    var partes = [];
    itensParaCotacao()
      .sort(function (a, b) {
        return a.produto_id < b.produto_id ? -1 : a.produto_id > b.produto_id ? 1 : 0;
      })
      .forEach(function (item) {
        partes.push(item.produto_id + ":" + item.qtd);
      });
    return digitosCep(cepInformado) + "|" + partes.join(",");
  }

  function mostrarStatus(texto, erro) {
    if (!dom || !dom.status) return;
    dom.status.hidden = false;
    dom.status.textContent = texto;
    if (erro) dom.status.classList.add("is-erro");
    else dom.status.classList.remove("is-erro");
  }

  function esconderStatus() {
    if (!dom || !dom.status) return;
    dom.status.hidden = true;
    dom.status.textContent = "";
    dom.status.classList.remove("is-erro");
  }

  function rotuloOpcao(opcao) {
    if (opcao.id === ID_RETIRADA) return ROTULO_RETIRADA;
    if (opcao.transportadora && opcao.servico) return opcao.transportadora + " · " + opcao.servico;
    return opcao.servico || opcao.transportadora || "Entrega";
  }

  function listaOpcoesVisiveis() {
    var lista = [freteRetirada()];
    var ids = {};
    ids[ID_RETIRADA] = true;
    opcoesFrete.forEach(function (opcao) {
      if (ids[opcao.id]) return;
      ids[opcao.id] = true;
      lista.push(opcao);
    });
    // Cotação ainda não voltou: mantém a escolha salva visível, logo abaixo da retirada.
    if (freteEscolhido && !ids[freteEscolhido.id]) lista.splice(1, 0, freteEscolhido);
    return lista;
  }

  function desenharOpcoes() {
    if (!dom || !dom.opcoes) return;
    dom.opcoes.textContent = "";
    listaOpcoesVisiveis().forEach(function (opcao) {
      dom.opcoes.appendChild(linhaOpcao(opcao));
    });
  }

  function linhaOpcao(opcao) {
    var label = document.createElement("label");
    label.className = "cart-frete-opcao";

    var input = document.createElement("input");
    input.type = "radio";
    input.name = "frete";
    input.value = opcao.id;
    if (freteEscolhido && freteEscolhido.id === opcao.id) input.checked = true;

    var texto = document.createElement("span");
    texto.className = "cart-frete-opcao-texto";

    var nome = document.createElement("span");
    nome.className = "cart-frete-opcao-nome";
    nome.textContent = rotuloOpcao(opcao);
    texto.appendChild(nome);

    if (opcao.id !== ID_RETIRADA && typeof opcao.prazo_dias === "number") {
      var prazo = document.createElement("span");
      prazo.className = "cart-frete-opcao-prazo";
      prazo.textContent = textoPrazo(opcao.prazo_dias);
      texto.appendChild(prazo);
    }

    var preco = document.createElement("span");
    preco.className = "cart-frete-opcao-preco";
    preco.textContent = opcao.id === ID_RETIRADA ? "Grátis" : formatarBRL(opcao.preco_centavos);

    label.appendChild(input);
    label.appendChild(texto);
    label.appendChild(preco);
    return label;
  }

  function normalizarOpcaoApi(bruta) {
    if (!bruta || typeof bruta !== "object") return null;
    if (bruta.id == null || String(bruta.id) === "" || String(bruta.id) === ID_RETIRADA) return null;
    var preco = Math.round(Number(bruta.preco_centavos));
    if (!isFinite(preco) || preco < 0) return null;
    var prazo = bruta.prazo_dias == null ? null : Math.round(Number(bruta.prazo_dias));
    if (prazo != null && (!isFinite(prazo) || prazo < 0)) prazo = null;
    return {
      id: String(bruta.id),
      transportadora: typeof bruta.transportadora === "string" ? bruta.transportadora : "",
      servico: typeof bruta.servico === "string" ? bruta.servico : "Entrega",
      preco_centavos: preco,
      prazo_dias: prazo
    };
  }

  function aplicarOpcoes(lista, avisoExtra) {
    var idAntes = freteEscolhido ? freteEscolhido.id : null;
    opcoesFrete = lista;
    if (idAntes === ID_RETIRADA) {
      freteEscolhido = freteRetirada();
    } else if (idAntes) {
      var achou = null;
      lista.forEach(function (opcao) {
        if (opcao.id === idAntes) achou = opcao;
      });
      if (achou) freteEscolhido = achou;
      else freteEscolhido = null;
    }
    if (!lista.length) {
      mostrarStatus("Nenhuma entrega disponível para este CEP.", true);
    } else if (!freteEscolhido && idAntes && idAntes !== ID_RETIRADA) {
      mostrarStatus("A opção de frete anterior não está mais disponível. Escolha outra.", true);
    } else if (avisoExtra) {
      mostrarStatus(avisoExtra, true);
    } else {
      esconderStatus();
    }
  }

  function terminarCotacao(seq) {
    if (seq !== cotacaoSeq) return;
    freteRecalculando = false;
    assinaturaEmVoo = "";
    if (dom.calc) {
      dom.calc.disabled = false;
      dom.calc.textContent = "Calcular";
    }
    if (dom.frete) dom.frete.removeAttribute("aria-busy");
    desenharTotaisVisiveis();
    desenharOpcoes();
    sincronizarEndereco();
    invalidarChave();
    if (cepValido(cepInformado)) buscarViaCep();
    salvarEstado();
  }

  function desenharTotaisVisiveis() {
    if (!dom || !dom.subtotal) return;
    var subtotal = 0;
    var totalAtivo = 0;
    estadoAtual.itens.forEach(function (item) {
      if (item.esgotado) return;
      totalAtivo += item.qtd;
      subtotal += item.qtd * item.precoUnitarioCentavos;
    });
    var totalProdutos = precoTotal(totalAtivo);
    var desconto = Math.max(0, subtotal - totalProdutos);
    estadoAtual.totalCentavos = totalProdutos;
    desenharTotais(subtotal, desconto, totalProdutos, totalAtivo > 0);
  }

  function cotarFrete() {
    var itens = itensParaCotacao();
    var assinatura = assinaturaPedido();
    if (!itens.length || !cepValido(cepInformado)) return;
    if (assinatura === assinaturaEmVoo) return;

    var seq = ++cotacaoSeq;
    assinaturaEmVoo = assinatura;
    freteRecalculando = true;
    if (dom.calc) {
      dom.calc.disabled = true;
      dom.calc.textContent = "Calculando…";
    }
    if (dom.frete) dom.frete.setAttribute("aria-busy", "true");
    mostrarStatus("Calculando o frete…", false);
    desenharTotaisVisiveis();

    var cfg = configFrete();
    if (!cfg) {
      falharCotacao(seq, assinatura);
      return;
    }

    var cep = digitosCep(cepInformado);
    fetch(cfg.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: cfg.key
      },
      body: JSON.stringify({
        cep_destino: cep,
        itens: itens
      })
    })
      .then(function (res) {
        if (!res.ok) throw new Error("status");
        return res.json();
      })
      .then(function (dados) {
        if (seq !== cotacaoSeq) return;
        if (!dados || !Array.isArray(dados.opcoes)) throw new Error("forma");
        var lista = [];
        dados.opcoes.forEach(function (bruta) {
          var opcao = normalizarOpcaoApi(bruta);
          if (opcao) lista.push(opcao);
        });
        aplicarOpcoes(lista);
        assinaturaCotada = assinatura;
        terminarCotacao(seq);
      })
      .catch(function () {
        falharCotacao(seq, assinatura);
      });
  }

  function falharCotacao(seq, assinatura) {
    if (seq !== cotacaoSeq) return;
    opcoesFrete = [];
    if (freteEscolhido && freteEscolhido.id !== ID_RETIRADA) freteEscolhido = null;
    assinaturaCotada = "";
    assinaturaEmVoo = "";
    mostrarStatus(MSG_FRETE_INDISPONIVEL, true);
    terminarCotacao(seq);
    // A assinatura em voo é limpa no terminar. Guardar a que falhou evita
    // um novo pedido idêntico a cada render; mudança de quantidade troca a assinatura.
    assinaturaCotada = "falha:" + assinatura;
  }

  function recalcularFreteSePrecisar() {
    if (!cepParaRecalcular) return;
    if (digitosCep(cepInformado) !== cepParaRecalcular) return;
    if (!cepValido(cepInformado)) return;
    var assinatura = assinaturaPedido();
    if (assinatura.indexOf("|") === assinatura.length - 1) return;
    if (assinatura === assinaturaCotada || assinatura === assinaturaEmVoo) return;
    if (assinaturaCotada === "falha:" + assinatura) return;
    cotarFrete();
  }

  function aoDigitarCep() {
    if (!dom.cep) return;
    var el = dom.cep;
    var antes = el.value;
    var pos = typeof el.selectionStart === "number" ? el.selectionStart : antes.length;
    var digitosAntes = antes.slice(0, pos).replace(/\D/g, "").length;
    var mascarado = mascararCep(antes);
    if (antes !== mascarado) {
      el.value = mascarado;
      var novaPos = 0;
      var vistos = 0;
      while (novaPos < mascarado.length && vistos < digitosAntes) {
        if (/\d/.test(mascarado.charAt(novaPos))) vistos += 1;
        novaPos += 1;
      }
      if (el.setSelectionRange) el.setSelectionRange(novaPos, novaPos);
    }
    cepInformado = mascarado;
    dom.cep.setAttribute("aria-invalid", "false");
    mostrarErroCheckout("");
    var digitosCepAtual = digitosCep(cepInformado);
    if (cepDaCidade && digitosCepAtual !== cepDaCidade) {
      limparCidadeUf();
      lerCompradorDoForm();
    }
    if (digitosCepAtual.length === 8) buscarViaCep();
    if (digitosCepAtual !== cepParaRecalcular) {
      cepParaRecalcular = "";
      assinaturaCotada = "";
      assinaturaEmVoo = "";
      cotacaoSeq += 1;
      freteRecalculando = false;
      opcoesFrete = [];
      if (freteEscolhido && freteEscolhido.id !== ID_RETIRADA) freteEscolhido = null;
      invalidarChave();
      if (dom.calc) {
        dom.calc.disabled = false;
        dom.calc.textContent = "Calcular";
      }
      if (dom.frete) dom.frete.removeAttribute("aria-busy");
      esconderStatus();
      desenharOpcoes();
      desenharTotaisVisiveis();
    }
    salvarEstado();
  }

  function aoCalcularFrete(evento) {
    if (evento) evento.preventDefault();
    if (!dom.cep) return;
    cepInformado = mascararCep(dom.cep.value);
    dom.cep.value = cepInformado;
    if (!cepValido(cepInformado)) {
      dom.cep.setAttribute("aria-invalid", "true");
      mostrarStatus("Confira o CEP. O formato é 00000-000.", true);
      dom.cep.focus();
      return;
    }
    dom.cep.setAttribute("aria-invalid", "false");
    cepParaRecalcular = digitosCep(cepInformado);
    assinaturaCotada = "";
    cotarFrete();
  }

  function aoEscolherFrete(evento) {
    var input = evento.target;
    if (!input || input.name !== "frete") return;
    if (input.value === ID_RETIRADA) {
      freteEscolhido = freteRetirada();
    } else {
      var achou = null;
      opcoesFrete.forEach(function (opcao) {
        if (opcao.id === input.value) achou = opcao;
      });
      if (!achou && freteEscolhido && freteEscolhido.id === input.value) achou = freteEscolhido;
      if (!achou) return;
      freteEscolhido = achou;
    }
    desenharTotaisVisiveis();
    sincronizarEndereco();
    invalidarChave();
    mostrarErroCheckout("");
    if (!entregaEhRetirada() && cepValido(cepInformado)) buscarViaCep();
    salvarEstado();
  }

  // ---- início ---------------------------------------------------------

  function iniciar() {
    var toggle = document.getElementById("cart-toggle");
    var drawer = document.getElementById("cart-drawer");
    if (!toggle || !drawer) return; // página sem sacola (feedback, privacidade, obrigado…)

    dom = {
      toggle: toggle,
      drawer: drawer,
      corpo: drawer.querySelector(".cart-drawer-body"),
      overlay: document.getElementById("cart-overlay"),
      close: document.getElementById("cart-drawer-close"),
      count: document.getElementById("cart-count"),
      itemsList: document.getElementById("cart-items"),
      empty: document.getElementById("cart-empty"),
      nudge: document.getElementById("cart-nudge"),
      foot: document.getElementById("cart-foot"),
      subtotal: document.getElementById("cart-subtotal"),
      discountRow: document.getElementById("cart-discount-row"),
      discount: document.getElementById("cart-discount"),
      total: document.getElementById("cart-total"),
      checkout: document.getElementById("cart-checkout"),
      erro: document.getElementById("cart-checkout-erro"),
      dados: document.getElementById("cart-dados"),
      endereco: document.getElementById("cart-endereco"),
      nome: document.getElementById("cart-nome"),
      email: document.getElementById("cart-email"),
      telefone: document.getElementById("cart-telefone"),
      logradouro: document.getElementById("cart-logradouro"),
      numero: document.getElementById("cart-numero"),
      complemento: document.getElementById("cart-complemento"),
      bairro: document.getElementById("cart-bairro"),
      cidade: document.getElementById("cart-cidade"),
      uf: document.getElementById("cart-uf"),
      frete: document.getElementById("cart-frete"),
      freteForm: document.getElementById("cart-frete-form"),
      cep: document.getElementById("cart-cep"),
      calc: document.getElementById("cart-frete-calc"),
      status: document.getElementById("cart-frete-status"),
      opcoes: document.getElementById("cart-frete-opcoes"),
      freight: document.getElementById("cart-freight")
    };

    catalogo = catalogoDoDom();
    var salvo = lerEstadoSalvo();
    carrinho = salvo.carrinho;
    cepInformado = salvo.cep;
    freteEscolhido = salvo.frete;
    comprador = salvo.comprador || compradorVazio();
    if (dom.cep && cepInformado) dom.cep.value = cepInformado;
    preencherComprador();
    if (cepValido(cepInformado)) {
      cepParaRecalcular = digitosCep(cepInformado);
      buscarViaCep();
    }

    document.addEventListener("click", tratarClique);
    document.addEventListener("keydown", tratarTeclado, true);
    if (dom.freteForm) dom.freteForm.addEventListener("submit", aoCalcularFrete);
    if (dom.cep) dom.cep.addEventListener("input", aoDigitarCep);
    if (dom.opcoes) dom.opcoes.addEventListener("change", aoEscolherFrete);
    if (dom.dados) {
      dom.dados.addEventListener("submit", tratarFinalizar);
      dom.dados.addEventListener("input", aoEditarComprador);
      dom.dados.addEventListener("change", aoEditarComprador);
    }

    document.addEventListener("foveo:catalogo", function (evento) {
      mesclarCatalogoAoVivo(evento.detail);
      render();
      recalcularFreteSePrecisar();
    });

    // catalog.js já pode ter iniciado a busca antes deste script carregar;
    // reaproveita a mesma promise memoizada em vez de buscar de novo.
    if (window.FoveoCatalog && typeof window.FoveoCatalog.obterCatalogo === "function") {
      window.FoveoCatalog.obterCatalogo().then(function (produtos) {
        mesclarCatalogoAoVivo(produtos);
        render();
        recalcularFreteSePrecisar();
      });
    }

    render();
    desenharOpcoes();
    salvarEstado();
    recalcularFreteSePrecisar();
    if (/(?:^|[?&])sacola=1(?:&|$)/.test(location.search)) abrir(dom.toggle);
  }

  iniciar();

  return {
    obterItens: function () {
      return estadoAtual.itens.slice();
    },
    obterTotalCentavos: function () {
      return estadoAtual.totalComFrete;
    },
    obterFrete: function () {
      return estadoAtual.frete ? Object.assign({}, estadoAtual.frete) : null;
    }
  };
})();
