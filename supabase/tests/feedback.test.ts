import assert from "node:assert/strict";
import test from "node:test";

import { podeRegistrarAviso } from "../functions/_shared/avisos.ts";
import {
  camposDoFormulario,
  detalheFeedback,
  hashIp,
  honeypotCheio,
  lerFeedback,
  mensagemFeedback,
  primeiraLinha,
} from "../functions/_shared/feedback.ts";

const ID = "11111111-1111-4111-8111-111111111111";

test("o formulário aceita as velas, a nota e o compartilhar", () => {
  const leitura = lerFeedback({
    velas: ["Permanecer", "Acolher", "Acolher"],
    nota: "4",
    sensacao: "  morna  ",
    mudaria: "",
    depoimento: "",
    compartilhar: "Sim, com meu nome",
    novidades: "Não",
    nome: "  ",
    contato: "",
  });
  assert.equal(leitura.ok, true);
  if (!leitura.ok) return;
  assert.deepEqual(leitura.feedback.candles, ["Acolher", "Permanecer"]);
  assert.equal(leitura.feedback.rating, 4);
  assert.equal(leitura.feedback.sensacao, "morna");
  assert.equal(leitura.feedback.nome, "");
  assert.equal(lerFeedback({ candles: ["Outra"], rating: 5, instagram_share: "Não" }).ok, false);
  assert.equal(lerFeedback({ candles: ["Acolher"], rating: 0, instagram_share: "Não" }).ok, false);
  assert.equal(
    lerFeedback({ candles: ["Acolher"], rating: 5, instagram_share: "Não", sensacao: "x".repeat(2001) }).erro,
    "longo",
  );
});

test("o honeypot e o formulário urlencoded entram no mesmo leitor", () => {
  assert.equal(honeypotCheio({ bot: "  " }), false);
  assert.equal(honeypotCheio({ "bot-field": "http://spam" }), true);
  const campos = camposDoFormulario(
    "vela[]=Despertar&vela[]=Não+lembro&nota=3&compartilhar=Não&bot-field=",
  );
  const leitura = lerFeedback(campos);
  assert.equal(leitura.ok, true);
  if (!leitura.ok) return;
  assert.deepEqual(leitura.feedback.candles, ["Despertar", "Não lembro"]);
  assert.equal(leitura.feedback.rating, 3);
  assert.equal(honeypotCheio(camposDoFormulario("nota=1&bot-field=preenchido")), true);
});

test("o aviso cabe em 500 caracteres e leva o começo de cada texto", () => {
  const longo = "primeira linha do relato\nsegunda linha que não entra";
  assert.equal(primeiraLinha(longo, 12), "primeira li…");
  const feedback = lerFeedback({
    candles: ["Acolher"],
    rating: 5,
    sensacao: longo,
    mudaria: "x".repeat(400),
    depoimento: "y".repeat(400),
    instagram_share: "Sim, anônimo",
    novidades: "Sim",
  });
  assert.equal(feedback.ok, true);
  if (!feedback.ok) return;
  const mensagem = mensagemFeedback(feedback.feedback);
  assert.ok(mensagem.length <= 500);
  assert.match(mensagem, /Velas: Acolher/);
  assert.match(mensagem, /Nota 5/);
  assert.match(mensagem, /Compartilhar: Sim, anônimo/);
  assert.match(mensagem, /Na pele: primeira linha do relato/);
  assert.doesNotMatch(mensagem, /segunda linha/);
  assert.equal(detalheFeedback(feedback.feedback).nota, 5);
  assert.equal(
    podeRegistrarAviso([], "feedback_novo", ID),
    true,
  );
  assert.equal(podeRegistrarAviso([{ tipo: "feedback_novo", chave: ID }], "feedback_novo", ID), false);
});

test("o hash do IP é estável e não é o IP cru", async () => {
  const hash = await hashIp("203.0.113.8");
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash.includes("203.0.113.8"), false);
  assert.equal(await hashIp("203.0.113.8"), hash);
});
