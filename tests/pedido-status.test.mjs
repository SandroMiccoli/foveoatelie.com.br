import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  formatarDia,
  formatarQuando,
  mensagemContexto,
  nivelEstoqueDoTom,
  pagoOuDepois,
  rotuloStatus,
  tomDoStatus,
} = require("../assets/js/pedido-status-lib.js");

test("tom do status: verde, amarelo, laranja e vermelho", () => {
  assert.equal(tomDoStatus("pago"), "ok");
  assert.equal(tomDoStatus("entregue"), "ok");
  assert.equal(tomDoStatus("pronto_retirada"), "ok");
  assert.equal(tomDoStatus("pendente"), "espera");
  assert.equal(tomDoStatus("etiqueta_gerada"), "processo");
  assert.equal(tomDoStatus("enviado"), "processo");
  assert.equal(tomDoStatus("recusado"), "ruim");
  assert.equal(tomDoStatus("cancelado"), "ruim");
  assert.equal(tomDoStatus("reembolsado"), "ruim");
  assert.equal(tomDoStatus("expirado"), "ruim");
  assert.equal(tomDoStatus("pendente", { retentativa: true }), "ruim");
});

test("nível do ponto reaproveita o CSS de estoque", () => {
  assert.equal(nivelEstoqueDoTom("ok"), "disponivel");
  assert.equal(nivelEstoqueDoTom("espera"), "baixo");
  assert.equal(nivelEstoqueDoTom("processo"), "processo");
  assert.equal(nivelEstoqueDoTom("ruim"), "critico");
});

test("pagoOuDepois só libera acompanhar depois da confirmação", () => {
  assert.equal(pagoOuDepois("pago"), true);
  assert.equal(pagoOuDepois("enviado"), true);
  assert.equal(pagoOuDepois("pendente"), false);
  assert.equal(pagoOuDepois("recusado"), false);
});

test("rótulo de status tem texto, não só cor", () => {
  assert.equal(rotuloStatus("pago"), "Pagamento confirmado");
  assert.equal(rotuloStatus("pendente"), "Pagamento em análise");
  assert.equal(rotuloStatus("pendente", { retentativa: true }), "Pagamento não aprovado");
  assert.equal(rotuloStatus("enviado"), "Enviado");
});

test("formatarQuando usa dd/mm às HH:mm em America/Sao_Paulo", () => {
  assert.equal(formatarQuando("2026-11-20T18:05:00.000Z"), "20/11 às 15:05");
  assert.equal(formatarQuando("2026-03-15T02:30:00.000Z"), "14/03 às 23:30");
  assert.equal(formatarQuando(""), "");
  assert.equal(formatarQuando("nao-e-data"), "");
  assert.equal(formatarDia("2026-12-02"), "02/12");
  assert.equal(formatarDia("quebrado"), "");
});

test("mensagem de contexto não repete o rótulo do status", () => {
  const envio = mensagemContexto({
    status: "pago",
    entrega_tipo: "envio",
    data_postagem: "2026-12-02",
  });
  assert.equal(envio, "Seu pedido será postado na quarta-feira, 02/12.");
  assert.doesNotMatch(envio, /pagamento confirmado/i);

  const retirada = mensagemContexto(
    { status: "pago", entrega_tipo: "retirada", data_postagem: "2026-12-02" },
    "https://wa.me/55",
  );
  assert.match(retirada, /Suas velas ficam prontas a partir de quarta-feira, 02\/12\. Chama a gente no WhatsApp/);
  assert.doesNotMatch(retirada, /pagamento confirmado/i);

  const postado = mensagemContexto({ status: "enviado", rastreio: "AA123456789BR" });
  assert.equal(postado, "Use o código na transportadora pra ver a previsão de entrega.");
  assert.doesNotMatch(postado, /enviado|pedido postado|AA123456789BR/i);

  const entregue = mensagemContexto({ status: "entregue" });
  assert.match(entregue, /toque da Foveō/);
  assert.doesNotMatch(entregue, /chegou|entregue/i);

  const pendente = mensagemContexto({ status: "pendente" });
  assert.match(pendente, /Pix e cartão/);
  assert.doesNotMatch(pendente, /em análise|confirmado/i);

  const recusado = mensagemContexto({ status: "recusado" });
  assert.match(recusado, /ajuda a tentar/);
  assert.doesNotMatch(recusado, /recusado/i);

  const reembolsado = mensagemContexto({ status: "reembolsado" });
  assert.match(reembolsado, /dúvida/i);
  assert.doesNotMatch(reembolsado, /reembolsado/i);
});
