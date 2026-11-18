// ── Catálogo ao vivo (estoque 2026, estágio 1) ──────────────────────────
// Lê a view pública `catalogo` no Supabase via fetch simples (sem o
// bundle do supabase-js) e atualiza estoque e preço nos cards da
// coleção. Só leitura: nenhuma escrita acontece daqui.
//
// Desenhado para crescer: o carrinho (estágio 2) deve poder reaproveitar
// window.FoveoCatalog.obterCatalogo() e window.FoveoCatalog.calcularPrecoCentavos()
// em vez de refazer o fetch. Quando o catálogo carrega, este módulo
// dispara o evento "foveo:catalogo" em document, com os dados no detail —
// o carrinho pode escutar esse evento sem tocar neste arquivo.
//
// Falha sempre em silêncio: se o Supabase não responder, ou a página não
// tiver coleção, os cards continuam exatamente como o HTML sem JS os
// deixa. Nunca lança erro nem escreve no console.
window.FoveoCatalog = (function () {
  "use strict";

  var SELECT = "id,nome,descricao_curta,preco_unitario_centavos,ordem,disponivel_real";
  var catalogoPromise = null;

  function configAtual() {
    var root = document.querySelector("[data-supabase-url]");
    if (!root) return null;
    var url = root.getAttribute("data-supabase-url");
    var key = root.getAttribute("data-supabase-key");
    if (!url || !key) return null;
    return { url: url, key: key };
  }

  // R$ 60 (sem casas quando a quantia é redonda) / R$ 59,90 quando não é.
  function formatarPrecoBRL(centavos) {
    if (typeof centavos !== "number" || !isFinite(centavos)) return null;
    var reais = centavos / 100;
    if (centavos % 100 === 0) return "R$ " + Math.round(reais);
    return "R$ " + reais.toFixed(2).replace(".", ",");
  }

  // Espelha a RPC calcular_preco_centavos (1=6000, 2=11000, 3=15000,
  // a cada 3 soma 15000 + o resto). Hoje só documenta a regra para o
  // texto de combo; o carrinho (estágio 2) deve chamar a RPC de verdade
  // em vez de confiar nesta cópia, para não divergir do banco.
  function calcularPrecoCentavos(qtd) {
    if (typeof qtd !== "number" || qtd < 1) return 0;
    var trios = Math.floor(qtd / 3);
    var resto = qtd % 3;
    var porResto = resto === 0 ? 0 : resto === 1 ? 6000 : 11000;
    return trios * 15000 + porResto;
  }

  // nivel só escolhe a cor da pontinha ao lado do rótulo (ver main.css);
  // o texto em si é sempre o que carrega a informação.
  function rotuloEstoque(qtd) {
    if (typeof qtd !== "number" || !isFinite(qtd) || qtd < 0) return null;
    if (qtd === 0) return { texto: "Esgotado", nivel: "esgotado" };
    if (qtd === 1) return { texto: "Última unidade", nivel: "critico" };
    if (qtd <= 3) return { texto: "Últimas " + qtd + " unidades", nivel: "baixo" };
    return { texto: "Disponível", nivel: "disponivel" };
  }

  function aplicarNoCard(produto) {
    var card = document.getElementById(produto.id);
    if (!card) return;

    var precoEl = card.querySelector("[data-price]");
    if (precoEl) {
      var preco = formatarPrecoBRL(produto.preco_unitario_centavos);
      if (preco) precoEl.textContent = preco;
    }

    var estoqueEl = card.querySelector("[data-stock]");
    if (estoqueEl) {
      var rotulo = rotuloEstoque(produto.disponivel_real);
      var labelEl = estoqueEl.querySelector("[data-stock-label]");
      if (rotulo && labelEl) {
        labelEl.textContent = rotulo.texto;
        estoqueEl.hidden = false;
        estoqueEl.setAttribute("data-stock-level", rotulo.nivel);
      }
    }
  }

  function buscarCatalogo() {
    if (catalogoPromise) return catalogoPromise;

    catalogoPromise = (function () {
      var config = configAtual();
      if (!config || typeof fetch !== "function") return Promise.resolve(null);

      var endpoint =
        config.url + "/rest/v1/catalogo?select=" + SELECT + "&order=ordem.asc";

      try {
        return fetch(endpoint, {
          headers: { apikey: config.key, Authorization: "Bearer " + config.key }
        })
          .then(function (res) {
            if (!res.ok) throw new Error("catalogo: " + res.status);
            return res.json();
          })
          .catch(function () {
            return null;
          });
      } catch (err) {
        return Promise.resolve(null);
      }
    })();

    return catalogoPromise;
  }

  function iniciar() {
    if (!document.querySelector(".products")) return;

    buscarCatalogo().then(function (produtos) {
      if (!produtos || !produtos.length) return;
      produtos.forEach(aplicarNoCard);
      try {
        document.dispatchEvent(
          new CustomEvent("foveo:catalogo", { detail: produtos })
        );
      } catch (err) {}
    });
  }

  iniciar();

  return {
    obterCatalogo: buscarCatalogo,
    formatarPrecoBRL: formatarPrecoBRL,
    calcularPrecoCentavos: calcularPrecoCentavos,
    rotuloEstoque: rotuloEstoque
  };
})();
