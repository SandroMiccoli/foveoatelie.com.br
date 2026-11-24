import assert from "node:assert/strict";
import test from "node:test";

import { podeRegistrarAviso } from "../functions/_shared/avisos.ts";
import {
  camposDoFormulario,
  detalheFeedback,
  emailFeedbackValido,
  hashIp,
  honeypotCheio,
  lerFeedback,
  mensagemFeedback,
  normalizarWhatsapp,
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
  assert.equal(leitura.feedback.contato_novo, false);
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

test("contato novo pede WhatsApp ou e-mail e aceita o formato antigo", () => {
  const base = {
    candles: ["Acolher"],
    rating: 5,
    instagram_share: "Não",
    novidades: "Sim",
  };
  const antigo = lerFeedback({ ...base, nome: "Ana", contato: "ana no instagram" });
  assert.equal(antigo.ok, true);
  if (!antigo.ok) return;
  assert.equal(antigo.feedback.contato_novo, false);
  assert.equal(antigo.feedback.contato, "ana no instagram");
  assert.equal(antigo.feedback.whatsapp, "");

  const novo = lerFeedback({
    ...base,
    nome_completo: "  Maria Silva  ",
    whatsapp: "+55 (11) 98888-7777",
    email: "Maria@Exemplo.com",
  });
  assert.equal(novo.ok, true);
  if (!novo.ok) return;
  assert.equal(novo.feedback.contato_novo, true);
  assert.equal(novo.feedback.nome_completo, "Maria Silva");
  assert.equal(novo.feedback.whatsapp, "5511988887777");
  assert.equal(novo.feedback.email, "Maria@Exemplo.com");
  assert.equal(mensagemFeedback(novo.feedback).includes("5511988887777"), false);

  const soEmail = lerFeedback({ ...base, nome_completo: "", whatsapp: "", email: "oi@foveoatelie.com.br" });
  assert.equal(soEmail.ok, true);
  const semContato = lerFeedback({ ...base, nome_completo: "Maria", whatsapp: "", email: "" });
  assert.equal(semContato.ok, false);
  if (semContato.ok) return;
  assert.equal(semContato.erro, "invalido");
  const zapRuim = lerFeedback({ ...base, whatsapp: "9999", email: "oi@foveoatelie.com.br" });
  assert.equal(zapRuim.ok, false);
  const emailRuim = lerFeedback({ ...base, whatsapp: "11988887777", email: "sem-arroba" });
  assert.equal(emailRuim.ok, false);

  const recusou = lerFeedback({
    ...base,
    novidades: "Não",
    nome_completo: "Maria",
    whatsapp: "não é telefone",
    email: "também não",
  });
  assert.equal(recusou.ok, true);
  if (!recusou.ok) return;
  assert.equal(recusou.feedback.nome_completo, "");
  assert.equal(recusou.feedback.whatsapp, "");
  assert.equal(recusou.feedback.email, "");

  const url = camposDoFormulario(
    "vela[]=Acolher&nota=5&compartilhar=Não&novidades=Sim&nome_completo=Lia&whatsapp=11988887777&email=lia@exemplo.com",
  );
  const lido = lerFeedback(url);
  assert.equal(lido.ok, true);
  if (!lido.ok) return;
  assert.equal(lido.feedback.whatsapp, "5511988887777");
  assert.equal(lido.feedback.email, "lia@exemplo.com");
});

test("telefone brasileiro e e-mail aceitam o jeito que a pessoa digita", () => {
  assert.equal(normalizarWhatsapp("(11) 98888-7777"), "5511988887777");
  assert.equal(normalizarWhatsapp("+55 11 98888-7777"), "5511988887777");
  assert.equal(normalizarWhatsapp("011 3333-4444"), "551133334444");
  assert.equal(normalizarWhatsapp("5511988887777"), "5511988887777");
  assert.equal(normalizarWhatsapp(""), "");
  assert.equal(normalizarWhatsapp("988887777"), null);
  assert.equal(normalizarWhatsapp("abc"), null);
  assert.equal(emailFeedbackValido(""), true);
  assert.equal(emailFeedbackValido("Oi@Exemplo.com"), true);
  assert.equal(emailFeedbackValido("sem-arroba"), false);
  assert.equal(emailFeedbackValido("a@b"), false);
});

test("o hash do IP é estável e não é o IP cru", async () => {
  const hash = await hashIp("203.0.113.8");
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash.includes("203.0.113.8"), false);
  assert.equal(await hashIp("203.0.113.8"), hash);
});
