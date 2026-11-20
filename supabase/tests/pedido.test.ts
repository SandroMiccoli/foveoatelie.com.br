import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  acaoDaOrder,
  retentativaDePagamento,
  assinaturaValida,
  diagnosticarAssinatura,
  centavosParaReais,
  checkoutUrlConfiavel,
  dataPostagem,
  proximaQuartaPostagem,
  itensPagamento,
  manifestos,
  codigoPedido,
  numeroCurto,
  primeiroNome,
  reaisParaCentavos,
  somaItensCentavos,
  telefoneMp,
} from "../functions/_shared/pedido.ts";

test("centavos viram reais com duas casas", () => {
  assert.equal(centavosParaReais(6000), "60.00");
  assert.equal(centavosParaReais(11000), "110.00");
  assert.equal(centavosParaReais(50), "0.50");
  assert.equal(centavosParaReais(0), "0.00");
  assert.equal(reaisParaCentavos("60.00"), 6000);
  assert.equal(reaisParaCentavos("18,90"), 1890);
});

test("itens do checkout fecham com o combo e o frete", () => {
  const casos = [
    { qtd: 1, centavos: 6000 },
    { qtd: 2, centavos: 11000 },
    { qtd: 3, centavos: 15000 },
    { qtd: 4, centavos: 21000 },
    { qtd: 5, centavos: 26000 },
    { qtd: 7, centavos: 36000 },
  ];
  for (const caso of casos) {
    const items = itensPagamento(
      [
        { nome: "Acolher", qtd: Math.ceil(caso.qtd / 2) },
        { nome: "Despertar", qtd: Math.floor(caso.qtd / 2) },
      ].filter((linha) => linha.qtd > 0),
      caso.centavos,
      { titulo: "Frete Correios PAC", centavos: 1890 },
    );
    assert.equal(somaItensCentavos(items), caso.centavos + 1890, `qtd ${caso.qtd}`);
  }
});

test("url de checkout só em host do Mercado Pago", () => {
  const id = "ORDTST01KS5AJ6HTK2HRQ3XJ3C2JCKP9";
  assert.equal(
    checkoutUrlConfiavel(`https://www.mercadopago.com.br/checkout/v1/redirect?order_id=${id}`, id),
    true,
  );
  assert.equal(checkoutUrlConfiavel("https://evil.example/checkout?order_id=" + id, id), false);
  assert.equal(checkoutUrlConfiavel("http://www.mercadopago.com.br/checkout?order_id=" + id, id), false);
  assert.equal(checkoutUrlConfiavel("https://evilmercadopago.com.br/checkout?order_id=" + id, id), false);
});

test("status da order vira ação do pedido", () => {
  assert.equal(acaoDaOrder("processed", "accredited"), "pago");
  assert.equal(acaoDaOrder("processed", "partially_refunded"), "pago");
  assert.equal(acaoDaOrder("failed", "rejected_by_issuer"), "recusado");
  assert.equal(acaoDaOrder("canceled", "expired"), "expirado");
  assert.equal(acaoDaOrder("canceled", "canceled"), "cancelado");
  assert.equal(acaoDaOrder("processing", "in_process"), "registrar");
  assert.equal(acaoDaOrder("action_required", "waiting_payment"), "registrar");
  assert.equal(acaoDaOrder("action_required", "waiting_retry"), "registrar");
  assert.equal(retentativaDePagamento("action_required", "waiting_retry"), true);
  assert.equal(retentativaDePagamento("action_required", "waiting_payment"), false);
  assert.equal(retentativaDePagamento("action_required", "waiting_capture"), false);
  assert.equal(retentativaDePagamento("processing", "in_process", "rejected"), true);
  assert.equal(retentativaDePagamento("processing", "in_process", "failed"), true);
  assert.equal(retentativaDePagamento("processing", "in_process"), false);
  assert.equal(retentativaDePagamento("failed", "rejected_by_issuer", "failed"), false);
  assert.equal(retentativaDePagamento("processed", "accredited"), false);
});

test("postagem cai na quarta depois da sexta de fechamento", () => {
  assert.equal(dataPostagem("2026-11-19T15:00:00-03:00"), "2026-11-25");
  assert.equal(dataPostagem("2026-11-20T23:30:00-03:00"), "2026-11-25");
  assert.equal(dataPostagem("2026-11-21T12:00:00-03:00"), "2026-12-02");
  assert.equal(dataPostagem("2026-11-22T12:00:00-03:00"), "2026-12-02");
  assert.equal(dataPostagem("2026-11-23T09:00:00-03:00"), "2026-12-02");
  assert.equal(numeroCurto("75b7d5ab-1111-4111-8111-111111111111"), "75B7D5");
  assert.equal(primeiroNome("Ana Lima"), "Ana");
  assert.equal(primeiroNome("SANDRO"), "Sandro");
  assert.equal(primeiroNome("ÂNGELA"), "Ângela");
  assert.equal(primeiroNome("íris"), "Íris");
});

test("proximaQuartaPostagem: corte na segunda 23:59 em São Paulo", () => {
  // Segunda 23:59 → quarta da mesma semana
  assert.equal(proximaQuartaPostagem("2026-11-23T23:59:00-03:00"), "25/11");
  // Terça 00:00 → quarta da semana seguinte
  assert.equal(proximaQuartaPostagem("2026-11-24T00:00:00-03:00"), "02/12");
  // Quarta em si → próxima quarta
  assert.equal(proximaQuartaPostagem("2026-11-25T12:00:00-03:00"), "02/12");
  // Domingo → quarta seguinte
  assert.equal(proximaQuartaPostagem("2026-11-29T18:00:00-03:00"), "02/12");
  // Fronteira de mês (terça 24/11 já cobre 02/12); ano novo
  assert.equal(proximaQuartaPostagem("2026-12-29T10:00:00-03:00"), "06/01");
  assert.equal(proximaQuartaPostagem("2026-12-28T23:59:00-03:00"), "30/12");
  // Instante em UTC que ainda é segunda em SP
  assert.equal(proximaQuartaPostagem("2026-11-24T02:59:00Z"), "25/11");
  // Instante em UTC que já é terça em SP
  assert.equal(proximaQuartaPostagem("2026-11-24T03:00:00Z"), "02/12");
  assert.equal(proximaQuartaPostagem("data-invalida"), null);
});

test("código do pedido é YYMMDDNNN no fuso de São Paulo", () => {
  assert.equal(codigoPedido("2026-11-19T15:00:00-03:00", 5), "261119005");
  assert.equal(codigoPedido("2026-11-19T15:00:00-03:00", 1), "261119001");
  assert.equal(codigoPedido("2026-11-19T23:30:00-03:00", 12), "261119012");
  assert.equal(codigoPedido("2026-11-19T02:30:00Z", 1), "261118001");
  assert.equal(codigoPedido("2026-11-19T03:00:00Z", 1), "261119001");
  assert.equal(codigoPedido("2026-11-19T15:00:00-03:00", 5).includes("-"), false);
  assert.match(codigoPedido("2026-11-19T15:00:00-03:00", 999), /^[0-9]{9}$/);
  assert.equal(codigoPedido("2026-11-19T15:00:00-03:00", 1000), "");
  assert.equal(codigoPedido("2026-11-19T15:00:00-03:00", 0), "");
});

test("telefone brasileiro vira DDD e número", () => {
  assert.deepEqual(telefoneMp("5531996099111"), { area_code: "31", number: "996099111" });
  assert.deepEqual(telefoneMp("(31) 3333-4444"), { area_code: "31", number: "33334444" });
  assert.equal(telefoneMp("123"), null);
});

test("assinatura do webhook confere o manifesto e o id em minúsculas", async () => {
  const secret = "segredo-teste";
  const ts = "1742505638683";
  const requestId = "2066ca19-c6f1-498a-be75-1923005edd06";
  const dataId = "ORD01JQ4S4KY8HWQ6NA5PXB65B3D3";
  const manifesto = manifestos(dataId, requestId, ts)[1];
  assert.equal(manifesto, `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`);
  const v1 = createHmac("sha256", secret).update(manifesto).digest("hex");

  const ok = await assinaturaValida({
    xSignature: `ts=${ts},v1=${v1}`,
    xRequestId: requestId,
    dataId,
    secret,
    agoraMs: Number(ts) + 1000,
  });
  assert.equal(ok, true);

  const fora = await assinaturaValida({
    xSignature: `ts=${ts},v1=${v1}`,
    xRequestId: requestId,
    dataId,
    secret,
    agoraMs: Number(ts) + 11 * 60 * 1000,
  });
  assert.equal(fora, false);

  const trocada = await assinaturaValida({
    xSignature: `ts=${ts},v1=${"ab".repeat(32)}`,
    xRequestId: requestId,
    dataId,
    secret,
    agoraMs: Number(ts),
  });
  assert.equal(trocada, false);

  const diag = await diagnosticarAssinatura({
    xSignature: `ts=${ts},v1=${"ab".repeat(32)}`,
    xRequestId: requestId,
    dataId,
    secret,
    agoraMs: Number(ts),
  });
  assert.equal(diag.motivo, "hmac");
  assert.equal(diag.v1Recebido8, "abababab");
  assert.equal(diag.variantes.length, 2);
  assert.equal(diag.calculados8.length, 2);
  assert.equal(JSON.stringify(diag).includes(secret), false);
});
