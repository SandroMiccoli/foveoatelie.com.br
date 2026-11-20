// Contas compartilhadas da página do pedido e do rastreio: tom da cor,
// rótulo, mensagem de contexto e data/hora em America/Sao_Paulo.
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.FoveoPedidoStatus = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
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

  var PAGOS = {
    pago: true,
    etiqueta_gerada: true,
    enviado: true,
    entregue: true,
    pronto_retirada: true,
    retirado: true
  };

  // ok = verde, espera = amarelo, processo = laranja, ruim = vermelho
  var TOM = {
    pago: "ok",
    etiqueta_gerada: "processo",
    enviado: "processo",
    entregue: "ok",
    pronto_retirada: "ok",
    retirado: "ok",
    pendente: "espera",
    expirado: "ruim",
    recusado: "ruim",
    cancelado: "ruim",
    reembolsado: "ruim"
  };

  var STOCK_LEVEL = {
    ok: "disponivel",
    espera: "baixo",
    processo: "processo",
    ruim: "critico"
  };

  function statusChave(status) {
    return String(status || "").trim().toLowerCase();
  }

  function tomDoStatus(status, opcoes) {
    var st = statusChave(status);
    var opts = opcoes || {};
    if (st === "pendente" && opts.retentativa) return "ruim";
    if (TOM[st]) return TOM[st];
    return "espera";
  }

  function nivelEstoqueDoTom(tom) {
    return STOCK_LEVEL[tom] || STOCK_LEVEL.espera;
  }

  function rotuloStatus(status, opcoes) {
    var st = statusChave(status);
    var opts = opcoes || {};
    if (st === "pendente" && opts.retentativa) return "Pagamento não aprovado";
    if (st === "pendente" && !opts.retentativa) return "Pagamento em análise";
    return ROTULO[st] || "Em andamento";
  }

  function pagoOuDepois(status) {
    return !!PAGOS[statusChave(status)];
  }

  function formatarDia(iso) {
    var p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || "").trim());
    if (!p) return "";
    return p[3] + "/" + p[2];
  }

  // dd/mm às HH:mm no fuso de São Paulo. Vazio se a data não der pra ler.
  function formatarQuando(iso) {
    if (!iso) return "";
    var data = new Date(iso);
    if (Number.isNaN(data.getTime())) return "";
    var partes = new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).formatToParts(data);
    var ler = function (tipo) {
      var achou = partes.find(function (parte) {
        return parte.type === tipo;
      });
      return achou ? achou.value : "";
    };
    var dia = ler("day");
    var mes = ler("month");
    var hora = ler("hour");
    var minuto = ler("minute");
    if (!dia || !mes || !hora || !minuto) return "";
    return dia + "/" + mes + " às " + hora + ":" + minuto;
  }

  // Só o próximo passo / detalhe útil. O status fica no ponto+rótulo (e no
  // título pessoal quando houver) — daí estas frases não repetem o rótulo.
  function mensagemContexto(dados, whatsappHref) {
    var st = statusChave(dados && dados.status);
    var opts = { retentativa: !!(dados && dados.retentativa) };
    var dia = formatarDia(dados && dados.data_postagem);
    var entrega = dados && dados.entrega_tipo === "retirada" ? "retirada" : "envio";

    if (st === "pendente" && opts.retentativa) {
      return "Dá pra tentar de novo com outro cartão ou com Pix enquanto a reserva estiver valendo.";
    }
    if (st === "pendente") {
      return "Pix e cartão podem levar alguns minutos. A página atualiza sozinha.";
    }
    if (st === "recusado") {
      return "Se quiser, a gente te ajuda a tentar de outro jeito.";
    }
    if (st === "expirado") {
      return "A reserva soltou. Monte de novo na sacola quando quiser.";
    }
    if (st === "cancelado") {
      return "Se precisar de algo, chama a gente no WhatsApp.";
    }
    if (st === "reembolsado") {
      return "Qualquer dúvida, fala com a gente.";
    }
    if (st === "entregue") {
      return "Esperamos que o toque da Foveō te faça bem.";
    }
    if (st === "retirado") {
      return "Obrigado por passar no ateliê.";
    }
    if (st === "pronto_retirada") {
      if (whatsappHref) {
        return "Chama a gente no WhatsApp pra combinar o horário.";
      }
      return "Chama a gente pra combinar o horário da retirada.";
    }
    if (st === "enviado") {
      return "Use o código na transportadora pra ver a previsão de entrega.";
    }
    if (st === "etiqueta_gerada") {
      return "Em breve o pedido é postado e o rastreio aparece aqui.";
    }
    if (pagoOuDepois(st) && entrega === "retirada") {
      var frase = dia
        ? "Suas velas ficam prontas a partir de quarta-feira, " + dia + "."
        : "Suas velas ficam prontas a partir da próxima quarta-feira.";
      if (whatsappHref) {
        return frase + " Chama a gente no WhatsApp pra combinar a retirada.";
      }
      return frase;
    }
    if (pagoOuDepois(st)) {
      return dia
        ? "Seu pedido será postado na quarta-feira, " + dia + "."
        : "Seu pedido será postado na próxima quarta-feira.";
    }
    return "";
  }

  return {
    ROTULO: ROTULO,
    PAGOS: PAGOS,
    tomDoStatus: tomDoStatus,
    nivelEstoqueDoTom: nivelEstoqueDoTom,
    rotuloStatus: rotuloStatus,
    pagoOuDepois: pagoOuDepois,
    formatarDia: formatarDia,
    formatarQuando: formatarQuando,
    mensagemContexto: mensagemContexto
  };
});
