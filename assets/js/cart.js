// ── Sacola de compras (estágio 2 da store) ──────────────────────────────
// Carrinho front-end: soma e persiste quantidades em localStorage, aplica
// a regra de combo a cada 3 velas via window.FoveoCatalog.calcularPrecoCentavos
// e revalida as quantidades contra o estoque ao vivo sempre que o
// catálogo (assets/js/catalog.js) responde. Sem pagamento e sem frete —
// isso fica para os próximos estágios. O preço aqui é só exibição; a
// validação de verdade vem com o pagamento.
//
// Só entra em ação quando os elementos do carrinho existem na página
// (hoje, só a home) — nas demais páginas este arquivo não faz nada,
// mesma filosofia de falha silenciosa do catalog.js.
window.FoveoCart = (function () {
  "use strict";

  var STORAGE_KEY = "foveo-carrinho-v1";
  // Cautela otimista enquanto o estoque ao vivo de um produto ainda não
  // respondeu — não bloqueia quem está adicionando, a revalidação ajusta
  // depois. 99 é só um teto de sanidade, não uma meta de venda.
  var LIMITE_SEM_ESTOQUE = 99;
  // R$ 60 — só usado se nem o catálogo ao vivo nem o HTML tiverem o preço.
  var PRECO_UNITARIO_PADRAO = 6000;

  var catalogo = {}; // id -> { nome, precoUnitarioCentavos, disponivelReal }
  var carrinho = {}; // id -> quantidade
  var estadoAtual = { itens: [], totalCentavos: 0 };
  var ultimoFoco = null;
  var dom = null;

  // ---- armazenamento ----------------------------------------------------

  function lerCarrinhoSalvo() {
    var bruto = null;
    try {
      bruto = localStorage.getItem(STORAGE_KEY);
    } catch (e) {}
    if (!bruto) return {};
    try {
      var obj = JSON.parse(bruto);
      var limpo = {};
      if (obj && typeof obj === "object") {
        Object.keys(obj).forEach(function (id) {
          var qtd = Math.floor(Number(obj[id]));
          if (qtd > 0) limpo[id] = qtd;
        });
      }
      return limpo;
    } catch (e) {
      return {};
    }
  }

  function salvarCarrinho() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(carrinho));
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
    salvarCarrinho();
    render();
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
    salvarCarrinho();
    render();
  }

  function remover(id) {
    delete carrinho[id];
    salvarCarrinho();
    render();
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

    if (sujo) salvarCarrinho();

    var totalCentavos = precoTotal(totalAtivo);
    var descontoCentavos = Math.max(0, subtotal - totalCentavos);

    estadoAtual = { itens: itens, totalCentavos: totalCentavos };

    desenharItens(itens);
    desenharTotais(subtotal, descontoCentavos, totalCentavos, totalAtivo > 0);
    desenharNudge(totalAtivo);
    atualizarContador(totalAtivo);
    sincronizarBotoesAdicionar();

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

  function desenharTotais(subtotal, desconto, total, temAlgoAComprar) {
    dom.foot.hidden = !temAlgoAComprar;
    dom.subtotal.textContent = formatarBRL(subtotal);
    if (desconto > 0) {
      dom.discountRow.hidden = false;
      dom.discount.textContent = "– " + formatarBRL(desconto);
    } else {
      dom.discountRow.hidden = true;
    }
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

  function montarMensagemWhatsapp(itens, totalCentavos) {
    var linhas = itens
      .filter(function (i) {
        return !i.esgotado;
      })
      .map(function (i) {
        return i.qtd + "x " + i.nome;
      });
    if (!linhas.length) return null;
    return (
      "Olá! Quero fechar este pedido da coleção Foveō: " +
      linhas.join(", ") +
      ". Total " +
      formatarBRL(totalCentavos) +
      " (a confirmar). Podemos combinar os detalhes?"
    );
  }

  function tratarFinalizar() {
    if (!dom.checkoutNote) return;
    dom.checkoutNote.hidden = false;
    var numero = dom.drawer.getAttribute("data-whatsapp");
    var mensagem = montarMensagemWhatsapp(estadoAtual.itens, estadoAtual.totalCentavos);
    if (dom.checkoutWhatsapp) {
      if (numero && mensagem) {
        dom.checkoutWhatsapp.href = "https://wa.me/" + numero + "?text=" + encodeURIComponent(mensagem);
        dom.checkoutWhatsapp.hidden = false;
      } else {
        dom.checkoutWhatsapp.hidden = true;
      }
    }
  }

  // ---- abrir/fechar + foco --------------------------------------------

  function elementosFocaveis(raiz) {
    return Array.prototype.filter.call(
      raiz.querySelectorAll("a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])"),
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
      checkoutWhatsapp: document.getElementById("cart-checkout-whatsapp")
    };

    catalogo = catalogoDoDom();
    carrinho = lerCarrinhoSalvo();

    document.addEventListener("click", tratarClique);
    document.addEventListener("keydown", tratarTeclado, true);

    document.addEventListener("foveo:catalogo", function (evento) {
      mesclarCatalogoAoVivo(evento.detail);
      render();
    });

    // catalog.js já pode ter iniciado a busca antes deste script carregar;
    // reaproveita a mesma promise memoizada em vez de buscar de novo.
    if (window.FoveoCatalog && typeof window.FoveoCatalog.obterCatalogo === "function") {
      window.FoveoCatalog.obterCatalogo().then(function (produtos) {
        mesclarCatalogoAoVivo(produtos);
        render();
      });
    }

    render();
  }

  iniciar();

  return {
    obterItens: function () {
      return estadoAtual.itens.slice();
    },
    obterTotalCentavos: function () {
      return estadoAtual.totalCentavos;
    }
  };
})();
