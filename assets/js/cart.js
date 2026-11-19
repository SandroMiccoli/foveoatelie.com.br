// ── Sacola de compras (estágio 2 da store + frete) ─────────────────────
// Carrinho front-end: soma e persiste quantidades em localStorage, aplica
// a regra de combo a cada 3 velas via window.FoveoCatalog.calcularPrecoCentavos
// e revalida as quantidades contra o estoque ao vivo sempre que o
// catálogo (assets/js/catalog.js) responde. O frete é cotado na Edge
// Function cotar-frete (Melhor Envio). O preço aqui é só exibição; a
// confirmação e o pagamento continuam com a Foveō.
//
// CEP e a opção de frete ficam no mesmo localStorage da sacola.
// Se a função ainda não estiver publicada, a cotação falha com uma
// mensagem e a retirada em BH continua disponível.
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
  var freteEscolhido = null;
  var opcoesFrete = [];
  var freteRecalculando = false;
  var cotacaoSeq = 0;
  var assinaturaCotada = "";
  var assinaturaEmVoo = "";
  var estadoAtual = { itens: [], totalCentavos: 0, totalComFrete: 0, frete: null };
  var ultimoFoco = null;
  var dom = null;

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

  function lerEstadoSalvo() {
    var vazio = { carrinho: {}, cep: "", frete: null };
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
        return { carrinho: limparMapaQtd(obj), cep: "", frete: null };
      }
      return {
        carrinho: limparMapaQtd(obj.itens),
        cep: typeof obj.cep === "string" ? mascararCep(obj.cep) : "",
        frete: normalizarFrete(obj.frete)
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
          frete: freteEscolhido
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
    salvarEstado();
    render();
    recalcularFreteSePrecisar();
  }

  function remover(id) {
    delete carrinho[id];
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

    if (dom.checkoutNote) dom.checkoutNote.hidden = true;
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

  // ---- "Finalizar compra" (sem pagamento ainda) --------------------------

  function textoFreteWhatsapp(frete) {
    if (!frete) return "";
    if (frete.id === ID_RETIRADA) return " Frete: Retirar em BH (combinar), grátis.";
    var partes = [];
    if (frete.transportadora) partes.push(frete.transportadora);
    if (frete.servico) partes.push(frete.servico);
    var linha = " Frete: " + partes.join(" ") + ", " + formatarBRL(frete.preco_centavos);
    if (typeof frete.prazo_dias === "number") linha += ", " + textoPrazo(frete.prazo_dias);
    if (cepInformado) linha += ", CEP " + cepInformado;
    return linha + ".";
  }

  function montarMensagemWhatsapp(itens, totalCentavos, frete) {
    var linhas = itens
      .filter(function (i) {
        return !i.esgotado;
      })
      .map(function (i) {
        return i.qtd + "x " + i.nome;
      });
    if (!linhas.length) return null;
    var total = frete ? totalCentavos + (frete.preco_centavos || 0) : totalCentavos;
    return (
      "Olá! Quero fechar este pedido da coleção Foveō: " +
      linhas.join(", ") +
      "." +
      textoFreteWhatsapp(frete) +
      " Total " +
      formatarBRL(total) +
      " (a confirmar). Podemos combinar os detalhes?"
    );
  }

  function preencherWhatsapp() {
    if (!dom.checkoutWhatsapp) return;
    var numero = dom.drawer.getAttribute("data-whatsapp");
    var mensagem = montarMensagemWhatsapp(estadoAtual.itens, estadoAtual.totalCentavos, estadoAtual.frete);
    if (numero && mensagem) {
      dom.checkoutWhatsapp.href = "https://wa.me/" + numero + "?text=" + encodeURIComponent(mensagem);
      dom.checkoutWhatsapp.hidden = false;
    } else {
      dom.checkoutWhatsapp.hidden = true;
    }
  }

  function tratarFinalizar() {
    if (!dom.checkoutNote) return;
    dom.checkoutNote.hidden = false;
    preencherWhatsapp();
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

    if (dom.checkout && dom.checkout.contains(alvo)) {
      tratarFinalizar();
      if (typeof window.gtag === "function") window.gtag("event", "begin_checkout");
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
    if (dom.checkoutNote && !dom.checkoutNote.hidden) preencherWhatsapp();
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
    if (digitosCep(cepInformado) !== cepParaRecalcular) {
      cepParaRecalcular = "";
      assinaturaCotada = "";
      assinaturaEmVoo = "";
      cotacaoSeq += 1;
      freteRecalculando = false;
      opcoesFrete = [];
      if (freteEscolhido && freteEscolhido.id !== ID_RETIRADA) freteEscolhido = null;
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
    if (dom.checkoutNote && !dom.checkoutNote.hidden) preencherWhatsapp();
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
      checkoutNote: document.getElementById("cart-checkout-note"),
      checkoutWhatsapp: document.getElementById("cart-checkout-whatsapp"),
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
    if (dom.cep && cepInformado) dom.cep.value = cepInformado;
    if (cepValido(cepInformado)) cepParaRecalcular = digitosCep(cepInformado);

    document.addEventListener("click", tratarClique);
    document.addEventListener("keydown", tratarTeclado, true);
    if (dom.freteForm) dom.freteForm.addEventListener("submit", aoCalcularFrete);
    if (dom.cep) dom.cep.addEventListener("input", aoDigitarCep);
    if (dom.opcoes) dom.opcoes.addEventListener("change", aoEscolherFrete);

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
