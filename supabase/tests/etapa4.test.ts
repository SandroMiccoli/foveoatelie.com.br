import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  frasePosPagamento,
  htmlEmail,
  mensagemData,
  eventoCompativel,
  textoEmail,
} from "../functions/_shared/correio.ts";
import {
  assinaturaMelhorEnvio,
  classificarPedido,
  combinaRastreio,
  credencialRastreio,
  emailDoEvento,
  fecharResumo,
  lerEventoMe,
  lerRemetente,
  linhaDoTempo,
  linkRastreio,
  montarCarrinho,
  ipClienteRastreio,
  planoDepoisDoCheckout,
  planoImpressao,
  MENSAGEM_ETIQUETA_SUMIU,
  podeSoltarDepoisDoDelete,
  precoCotado,
  responderPedidoAusente,
  situacaoCompraMe,
  tentarSoltarCarrinho,
  urlMelhorEnvioConfiavel,
  type PedidoEtiqueta,
  type Remetente,
} from "../functions/_shared/etiquetas.ts";
import { abrirComPrazo, ioComPrazo, lerSmtp, REMETENTE_EMAIL, REMETENTE_NOME } from "../functions/_shared/smtp.ts";

function comoTexto(mod: { default: unknown }): string {
  return typeof mod.default === "string" ? mod.default : String(mod.default);
}

async function lerTexto(relativo: string): Promise<string> {
  if (typeof Deno === "undefined") {
    return await readFile(new URL(relativo, import.meta.url), "utf8");
  }
  switch (relativo) {
    case "../functions/_shared/etiquetas.ts":
      return comoTexto(await import("../functions/_shared/etiquetas.ts", { with: { type: "text" } }));
    case "../config.toml":
      return comoTexto(await import("../config.toml", { with: { type: "text" } }));
    case "../migrations/20261120180000_admin_etapa4_envio.sql":
      return comoTexto(await import("../migrations/20261120180000_admin_etapa4_envio.sql", { with: { type: "text" } }));
    case "../migrations/20261120200000_admin_etapa4_conferencia.sql":
      return comoTexto(await import("../migrations/20261120200000_admin_etapa4_conferencia.sql", { with: { type: "text" } }));
    case "../functions/etiquetas-melhor-envio/index.ts":
      return comoTexto(await import("../functions/etiquetas-melhor-envio/index.ts", { with: { type: "text" } }));
    case "../functions/webhook-melhor-envio/index.ts":
      return comoTexto(await import("../functions/webhook-melhor-envio/index.ts", { with: { type: "text" } }));
    case "../functions/_shared/aplicar-order.ts":
      return comoTexto(await import("../functions/_shared/aplicar-order.ts", { with: { type: "text" } }));
    case "../functions/rastrear-pedido/index.ts":
      return comoTexto(await import("../functions/rastrear-pedido/index.ts", { with: { type: "text" } }));
    default:
      throw new Error("arquivo_fora_da_lista");
  }
}

const remetente: Remetente = {
  name: "Foveō Ateliê",
  email: "contato@foveoatelie.com.br",
  phone: "31988887777",
  document: "12345678909",
  company_document: "",
  state_register: "ISENTO",
  address: "Rua do Teste",
  number: "10",
  complement: "",
  district: "Centro",
  city: "Belo Horizonte",
  state_abbr: "MG",
  postal_code: "30130100",
  agency: null,
};

function pedido(extra: Partial<PedidoEtiqueta> = {}): PedidoEtiqueta {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    codigo: "261120001",
    teste: false,
    status: "pago",
    entrega_tipo: "envio",
    cliente_nome: "Ana Silva",
    cliente_email: "ana@exemplo.com",
    cliente_telefone: "31999990000",
    cliente_cpf: "12345678909",
    endereco: {
      logradouro: "Rua da Cliente",
      numero: "20",
      complemento: "",
      bairro: "Centro",
      cidade: "Ilhéus",
      uf: "BA",
      cep: "45656552",
    },
    itens: [{ nome: "Acolher", qtd: 1, preco_unitario_centavos: 6000 }],
    subtotal_centavos: 6000,
    frete_centavos: 1890,
    frete: { id: "3", transportadora: "Correios", servico: "PAC" },
    me_order_id: "",
    me_status: "",
    rastreio: "",
    quando: "2026-11-23T12:00:00-03:00",
    ...extra,
  };
}

test("saldo curto não libera a compra", () => {
  const curto = fecharResumo([1890, 2100], 1000);
  assert.equal(curto.quantidade, 2);
  assert.equal(curto.total_centavos, 3990);
  assert.equal(curto.falta_centavos, 2990);
  assert.equal(curto.pode_comprar, false);
  const ok = fecharResumo([1890], 5000);
  assert.equal(ok.pode_comprar, true);
  assert.equal(ok.falta_centavos, 0);
  assert.equal(fecharResumo([], 5000).pode_comprar, false);
});

test("só envio pago e completo entra no carrinho", () => {
  assert.equal(classificarPedido(pedido()).tipo, "comprar");
  assert.equal(classificarPedido(pedido({ teste: true })).tipo, "fora");
  assert.equal(classificarPedido(pedido({ entrega_tipo: "retirada" })).tipo, "fora");
  assert.equal(classificarPedido(pedido({ cliente_cpf: "123" })).tipo, "fora");
  const gerado = classificarPedido(pedido({
    me_order_id: "abc12345-6789-aaaa",
    status: "pago",
  }));
  assert.equal(gerado.tipo, "gerar");
  const impresso = classificarPedido(pedido({
    me_order_id: "abc12345-6789-aaaa",
    status: "enviado",
    rastreio: "AA123456789BR",
  }));
  assert.equal(impresso.tipo, "imprimir");
  assert.equal(classificarPedido(pedido({
    me_order_id: "abc12345-6789-aaaa",
    me_status: "precisa_conferir",
  })).tipo, "conferir");
  assert.equal(classificarPedido(pedido({
    me_order_id: "abc12345-6789-aaaa",
    me_status: "pendente",
  })).tipo, "conferir");
  assert.equal(classificarPedido(pedido({ me_status: "comprando" })).tipo, "fora");
  assert.equal(classificarPedido(pedido({
    me_order_id: "abc12345-6789-aaaa",
    me_status: "pending",
    status: "pago",
  })).tipo, "conferir");
  assert.equal(classificarPedido(pedido({
    me_order_id: "abc12345-6789-aaaa",
    me_status: "canceled",
    status: "pago",
  })).tipo, "conferir");
  assert.equal(classificarPedido(pedido({
    me_order_id: "abc12345-6789-aaaa",
    me_status: "cancelled",
    status: "pago",
  })).tipo, "conferir");
});

test("só solta a compra se o DELETE deu certo e a etiqueta segue sem pagamento", async () => {
  assert.equal(podeSoltarDepoisDoDelete(false, { situacao: "nao_pago", ausente: false }), false);
  assert.equal(podeSoltarDepoisDoDelete(true, { situacao: "pago", ausente: false }), false);
  assert.equal(podeSoltarDepoisDoDelete(true, { situacao: "incerto", ausente: false }), false);
  assert.equal(podeSoltarDepoisDoDelete(true, { situacao: "nao_pago", ausente: false }), true);
  assert.equal(podeSoltarDepoisDoDelete(true, { situacao: "incerto", ausente: true }), true);

  const meId = "abc12345-6789-aaaa";
  assert.equal(await tentarSoltarCarrinho(meId, async () => false, async () => ({ situacao: "nao_pago", ausente: false })), "conferir");
  assert.equal(
    await tentarSoltarCarrinho(meId, async () => true, async () => ({ situacao: "pago", ausente: false })),
    "conferir",
  );
  assert.equal(
    await tentarSoltarCarrinho(meId, async () => {
      throw new Error("rede");
    }, async () => ({ situacao: "nao_pago", ausente: false })),
    "conferir",
  );
  assert.equal(
    await tentarSoltarCarrinho(meId, async () => true, async () => ({ situacao: "nao_pago", ausente: false })),
    "soltar",
  );
  assert.equal(
    await tentarSoltarCarrinho(meId, async () => true, async () => ({ situacao: "incerto", ausente: true })),
    "soltar",
  );
});

test("404 no conferir não solta a compra sem o DELETE confirmado", async () => {
  let confirmou = false;
  const parado = await responderPedidoAusente("abc12345-6789-aaaa", async () => "conferir");
  assert.equal(parado.soltou, false);
  assert.equal(parado.mensagem, MENSAGEM_ETIQUETA_SUMIU);
  assert.doesNotMatch(parado.mensagem, /Soltei/);

  const sumiu = await responderPedidoAusente("abc12345-6789-aaaa", async () => {
    throw new Error("rede");
  });
  assert.equal(sumiu.soltou, false);
  assert.equal(sumiu.mensagem, MENSAGEM_ETIQUETA_SUMIU);

  const semDelete = await tentarSoltarCarrinho(
    "abc12345-6789-aaaa",
    async () => false,
    async () => ({ situacao: "incerto", ausente: true }),
  );
  assert.equal(semDelete, "conferir");

  const solto = await responderPedidoAusente("abc12345-6789-aaaa", async (id) => {
    confirmou = id === "abc12345-6789-aaaa";
    const plano = await tentarSoltarCarrinho(
      id,
      async () => true,
      async () => ({ situacao: "nao_pago", ausente: false }),
    );
    return plano === "soltar" ? "removido" : "conferir";
  });
  assert.equal(confirmou, true);
  assert.equal(solto.soltou, true);
  assert.match(solto.mensagem, /Soltei/);
});

test("o IP do rastreio não usa o primeiro salto forjado", () => {
  assert.equal(ipClienteRastreio({
    get(nome) {
      if (nome === "x-forwarded-for") return "1.2.3.4, 203.0.113.9";
      return null;
    },
  }), "203.0.113.9");
  assert.equal(ipClienteRastreio({
    get(nome) {
      if (nome === "x-forwarded-for") return "1.2.3.4";
      if (nome === "x-real-ip") return "198.51.100.10";
      return null;
    },
  }), "198.51.100.10");
  assert.equal(ipClienteRastreio({
    get(nome) {
      if (nome === "cf-connecting-ip") return "192.0.2.20";
      if (nome === "x-real-ip") return "198.51.100.10";
      return null;
    },
  }), "192.0.2.20");
  assert.equal(ipClienteRastreio({ get() { return null; } }), "sem-ip");
});

test("preço da compra é o do Melhor Envio, e o status decide se tira do carrinho", () => {
  assert.equal(precoCotado([
    { id: 1, price: "20.00", error: "sem rota" },
    { id: 3, custom_price: "18.90" },
  ], "3"), 1890);
  assert.equal(precoCotado([{ id: 3, price: "0.00" }], "3"), null);
  assert.equal(situacaoCompraMe("released"), "pago");
  assert.equal(situacaoCompraMe("pending"), "nao_pago");
  assert.equal(situacaoCompraMe("canceled"), "nao_pago");
  assert.equal(situacaoCompraMe("mystery"), "incerto");
  assert.equal(planoDepoisDoCheckout("pago"), "seguir");
  assert.equal(planoDepoisDoCheckout("nao_pago"), "remover");
  assert.equal(planoDepoisDoCheckout("incerto"), "conferir");
  assert.equal(
    urlMelhorEnvioConfiavel("https://melhorenvio.s3.sa-east-1.amazonaws.com/etiqueta.pdf"),
    "https://melhorenvio.s3.sa-east-1.amazonaws.com/etiqueta.pdf",
  );
  assert.equal(urlMelhorEnvioConfiavel("https://evil.s3.amazonaws.com/etiqueta.pdf"), null);
  assert.equal(urlMelhorEnvioConfiavel("https://melhorenvio.com.br/imprimir/1"), "https://melhorenvio.com.br/imprimir/1");
});

test("leitura e escrita SMTP estouram o prazo e fecham o socket", async () => {
  let fechou = false;
  await assert.rejects(
    () => ioComPrazo(new Promise(() => {}), 20, () => {
      fechou = true;
    }),
    /smtp_timeout/,
  );
  assert.equal(fechou, true);

  let tarde = false;
  let soltar: (socket: { close: () => void }) => void = () => {};
  const abertura = new Promise<{ close: () => void }>((resolve) => {
    soltar = resolve;
  });
  const corrida = abrirComPrazo(abertura, 20);
  await assert.rejects(corrida, /smtp_timeout/);
  soltar({
    close() {
      tarde = true;
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(tarde, true);
});

test("o carrinho usa o remetente do secret, não um endereço fixo", async () => {
  const src = await lerTexto("../functions/_shared/etiquetas.ts");
  assert.doesNotMatch(src, /31030285/);
  assert.doesNotMatch(src, /Rua do Teste/);
  const lido = lerRemetente({
    MELHOR_ENVIO_FROM_NAME: "Foveō Ateliê",
    MELHOR_ENVIO_FROM_EMAIL: "contato@foveoatelie.com.br",
    MELHOR_ENVIO_FROM_PHONE: "31 98888-7777",
    MELHOR_ENVIO_FROM_DOCUMENT: "",
    MELHOR_ENVIO_FROM_COMPANY_DOCUMENT: "12345678000199",
    MELHOR_ENVIO_FROM_ADDRESS: "Rua do Teste",
    MELHOR_ENVIO_FROM_NUMBER: "10",
    MELHOR_ENVIO_FROM_DISTRICT: "Centro",
    MELHOR_ENVIO_FROM_CITY: "Belo Horizonte",
    MELHOR_ENVIO_FROM_STATE: "mg",
    MELHOR_ENVIO_FROM_POSTAL_CODE: "30130-100",
  });
  assert.ok(lido);
  assert.equal(lido.postal_code, "30130100");
  assert.equal(lido.company_document, "12345678000199");
  assert.equal(lido.document, "");
  assert.equal(lerRemetente({}), null);

  const corpo = montarCarrinho(pedido(), remetente);
  assert.ok(corpo);
  const from = corpo.from as { postal_code: string; address: string; name: string };
  assert.equal(from.postal_code, remetente.postal_code);
  assert.equal(from.address, "Rua do Teste");
  assert.equal(from.name, "Foveō Ateliê");
  assert.equal(corpo.service, 3);
  assert.equal((corpo.options as { insurance_value: number }).insurance_value, 60);
});

test("impressão pede um PDF só, A4 ou térmica", () => {
  const ids = ["abc12345-6789-aaaa", "def12345-6789-bbbb"];
  const a4 = planoImpressao("a4", ids);
  assert.ok(a4 && a4.metodo === "POST");
  if (a4 && a4.metodo === "POST") assert.deepEqual(a4.corpo.orders, ids);
  const termica = planoImpressao("termica", ids);
  assert.ok(termica && termica.metodo === "GET");
  if (termica && termica.metodo === "GET") {
    assert.equal(termica.caminho, "/api/v2/me/imprimir/pdf/" + ids.join(","));
    assert.equal(termica.fallback, "print");
  }
  assert.equal(planoImpressao("carta", ids), null);
});

test("assinatura do webhook aceita base64 e hex e recusa corpo trocado", async () => {
  const corpo = "{\"event\":\"order.posted\",\"data\":{\"id\":\"abc12345\"}}";
  const secret = "segredo-do-app";
  const mac = createHmac("sha256", secret).update(corpo).digest();
  const b64 = mac.toString("base64");
  const hex = mac.toString("hex");
  assert.equal(await assinaturaMelhorEnvio(secret, corpo, b64), true);
  assert.equal(await assinaturaMelhorEnvio(secret, corpo, "sha256=" + b64), true);
  assert.equal(await assinaturaMelhorEnvio(secret, corpo, hex), true);
  assert.equal(await assinaturaMelhorEnvio(secret, corpo + " ", b64), false);
  assert.equal(await assinaturaMelhorEnvio("", corpo, b64), false);
  assert.equal(await assinaturaMelhorEnvio(secret, corpo, null), false);
});

test("postagem vira enviado e entrega vira entregue", () => {
  const evento = lerEventoMe({
    event: "order.posted",
    data: { id: "abc12345-6789-aaaa", status: "posted", tracking: "AA123456789BR", protocol: "ORD-1" },
  });
  assert.ok(evento);
  assert.equal(evento.rastreio, "AA123456789BR");
  assert.equal(emailDoEvento(evento.evento), "enviado");
  assert.equal(emailDoEvento("order.delivered"), "entregue");
  assert.equal(emailDoEvento("order.generated"), null);
  assert.equal(linkRastreio("Correios", "AA123456789BR"), "https://rastreamento.correios.com.br/app/index.php?objetos=AA123456789BR");
  assert.match(linkRastreio("Outra", "XYZ1234") || "", /melhorrastreio\.com\.br/);
});

test("rastreio público exige código e e-mail ou CPF, e os dois quando os dois vêm", () => {
  assert.equal(credencialRastreio("261120001", "", ""), null);
  assert.equal(credencialRastreio("26112000", "ana@exemplo.com", ""), null);
  const soEmail = credencialRastreio("261120001", "Ana@Exemplo.com", "");
  assert.ok(soEmail);
  assert.equal(combinaRastreio(soEmail, "ana@exemplo.com", "12345678909"), true);
  assert.equal(combinaRastreio(soEmail, "outra@exemplo.com", "12345678909"), false);
  const osDois = credencialRastreio("261120001", "ana@exemplo.com", "123.456.789-09");
  assert.ok(osDois);
  assert.equal(combinaRastreio(osDois, "ana@exemplo.com", "12345678909"), true);
  assert.equal(combinaRastreio(osDois, "ana@exemplo.com", "00000000000"), false);
  const linha = linhaDoTempo([
    { status: "pago", created_at: "2026-11-20T12:00:00.000Z" },
    { status: "pago", created_at: "2026-11-20T12:01:00.000Z" },
    { status: "segredo", created_at: "2026-11-20T12:02:00.000Z" },
    { status: "enviado", created_at: "2026-11-21T12:00:00.000Z" },
  ]);
  assert.deepEqual(linha.map((passo) => passo.status), ["pago", "enviado"]);
});

test("e-mail usa a paleta, o rastreio, e não sai sem SMTP", () => {
  const html = htmlEmail({
    evento: "enviado",
    codigo: "261120001",
    nome: "Ana Silva",
    email: "ana@exemplo.com",
    entrega_tipo: "envio",
    itens: [],
    subtotal_centavos: 6000,
    desconto_centavos: 0,
    frete_centavos: 1890,
    total_centavos: 7890,
    transportadora: "Correios",
    servico: "PAC",
    rastreio: "AA123456789BR",
  });
  assert.match(html, /#0e0b09/);
  assert.match(html, /#ede6d9/);
  assert.match(html, /#c87431/);
  assert.match(html, /Foveō/);
  assert.match(html, /AA123456789BR/);
  assert.match(html, /correios\.com\.br/);
  assert.doesNotMatch(html, /Rua da Cliente/);
  assert.match(textoEmail({
    evento: "pagamento_confirmado",
    codigo: "261120001",
    nome: "Ana",
    email: "ana@exemplo.com",
    entrega_tipo: "envio",
    itens: [{ nome: "Acolher", qtd: 1, preco_unitario_centavos: 6000 }],
    subtotal_centavos: 6000,
    desconto_centavos: 0,
    frete_centavos: 1890,
    total_centavos: 7890,
    transportadora: "Correios",
    servico: "PAC",
    rastreio: "",
    quando: "2026-11-23T23:59:00-03:00",
  }), /Acolher[\s\S]*A postagem sai na quarta-feira, 25\/11/);

  assert.equal(
    frasePosPagamento({
      evento: "pagamento_confirmado",
      codigo: "261120001",
      nome: "Ana",
      email: "ana@exemplo.com",
      entrega_tipo: "envio",
      itens: [],
      subtotal_centavos: 6000,
      desconto_centavos: 0,
      frete_centavos: 1890,
      total_centavos: 7890,
      transportadora: "Correios",
      servico: "PAC",
      rastreio: "",
      quando: "2026-11-24T00:00:00-03:00",
    }),
    "A postagem sai na quarta-feira, 02/12. O código de rastreio chega neste e-mail.",
  );
  assert.equal(
    frasePosPagamento({
      evento: "pagamento_confirmado",
      codigo: "261120001",
      nome: "Ana",
      email: "ana@exemplo.com",
      entrega_tipo: "retirada",
      itens: [],
      subtotal_centavos: 6000,
      desconto_centavos: 0,
      frete_centavos: 0,
      total_centavos: 6000,
      transportadora: "",
      servico: "",
      rastreio: "",
      quando: "2026-11-23T23:59:00-03:00",
    }),
    "Avisamos por aqui quando o pedido estiver pronto pra retirada.",
  );
  assert.doesNotMatch(
    textoEmail({
      evento: "pagamento_confirmado",
      codigo: "261120001",
      nome: "Ana",
      email: "ana@exemplo.com",
      entrega_tipo: "retirada",
      itens: [],
      subtotal_centavos: 6000,
      desconto_centavos: 0,
      frete_centavos: 0,
      total_centavos: 6000,
      transportadora: "",
      servico: "",
      rastreio: "",
      quando: "2026-11-23T23:59:00-03:00",
    }),
    /postagem|rastreio/i,
  );

  const carta = mensagemData({
    fromName: REMETENTE_NOME,
    from: REMETENTE_EMAIL,
    to: "ana@exemplo.com",
    replyTo: REMETENTE_EMAIL,
    subject: "Pedido a caminho",
    text: "Olá.",
    html: "<p>Olá.</p>",
  });
  const nomeCodificado = carta.match(/From: =\?UTF-8\?B\?([^?]+)\?=/);
  assert.ok(nomeCodificado);
  assert.equal(Buffer.from(nomeCodificado[1], "base64").toString("utf8"), "Foveō Ateliê");
  assert.match(carta, /Reply-To: <contato@foveoatelie\.com\.br>/);
  assert.equal(lerSmtp({ SMTP_HOST: "smtp.gmail.com", SMTP_PORT: "465", SMTP_USER: "a", SMTP_PASS: "" }), null);
  assert.equal(eventoCompativel("enviado", "enviado", "envio"), true);
  assert.equal(eventoCompativel("enviado", "pago", "envio"), false);
  assert.equal(eventoCompativel("pronto_retirada", "pronto_retirada", "envio"), false);
});

test("webhook e rastreio público não exigem JWT, e o e-mail não repete", async () => {
  const toml = await lerTexto("../config.toml");
  assert.match(toml, /\[functions\.webhook-melhor-envio\][\s\S]*verify_jwt = false/);
  assert.match(toml, /\[functions\.rastrear-pedido\][\s\S]*verify_jwt = false/);
  assert.match(toml, /\[functions\.etiquetas-melhor-envio\][\s\S]*verify_jwt = true/);
  assert.match(toml, /\[functions\.notificar-cliente\][\s\S]*verify_jwt = true/);

  const sql = await lerTexto("../migrations/20261120180000_admin_etapa4_envio.sql");
  assert.match(sql, /enviado_em IS NOT NULL/);
  assert.match(sql, /ON CONFLICT \(pedido_id, evento\) DO NOTHING/);
  assert.match(sql, /order\.posted/);
  assert.match(sql, /order\.delivered/);
  assert.match(sql, /'melhor_envio'/);

  const extra = await lerTexto("../migrations/20261120200000_admin_etapa4_conferencia.sql");
  const semComentario = extra.replace(/--.*$/gm, "");
  assert.match(extra, /admin_reservar_compra_etiqueta/);
  assert.match(extra, /FOR UPDATE/);
  assert.match(extra, /'comprando'/);
  assert.match(extra, /'precisa_conferir'/);
  assert.match(extra, /'pendente'/);
  assert.match(extra, /interval '15 minutes'/);
  assert.match(extra, /falhou_em/);
  assert.match(extra, /rastreio_falhas/);
  assert.match(extra, /ped\.me_status IN \('comprando', 'pendente', 'precisa_conferir'\)/);
  assert.match(extra, /v_prova/);
  assert.match(extra, /'released', 'generated', 'posted', 'delivered', 'received', 'undelivered'/);
  assert.match(extra, /falhas_codigo >= 5/);
  assert.match(extra, /falhas_ip >= 20/);
  assert.match(extra, /ENABLE ROW LEVEL SECURITY/);
  assert.match(extra, /GRANT EXECUTE ON FUNCTION public\.bloqueio_rastreio\(text, text\) TO service_role/);
  assert.doesNotMatch(semComentario, /GRANT[^;]*TO anon/i);
  assert.doesNotMatch(semComentario, /GRANT[^;]*bloqueio_rastreio[^;]*TO authenticated/i);
  assert.doesNotMatch(semComentario, /GRANT[^;]*rastreio_falhas[^;]*TO authenticated/i);

  const compra = await lerTexto("../functions/etiquetas-melhor-envio/index.ts");
  const reserva = compra.indexOf("admin_reservar_compra_etiqueta");
  const carrinho = compra.indexOf('"/api/v2/me/cart"');
  const checkout = compra.indexOf('"/api/v2/me/shipment/checkout"');
  assert.ok(reserva > 0 && reserva < carrinho && carrinho < checkout);
  assert.match(compra, /admin_gravar_carrinho_etiqueta/);
  assert.match(compra, /planoDepoisDoCheckout/);
  assert.match(compra, /responderPedidoAusente/);
  assert.doesNotMatch(compra, /Não compre de novo/);
  const ausente = compra.indexOf("if (visto.ausente)");
  assert.ok(ausente > 0);
  const trechoAusente = compra.slice(ausente, compra.indexOf("if (plano === \"remover\")", ausente));
  assert.match(trechoAusente, /confirmarRemocao/);
  assert.doesNotMatch(trechoAusente, /soltarCompra/);

  const webhook = await lerTexto("../functions/webhook-melhor-envio/index.ts");
  assert.match(webhook, /emSegundoPlano\(enviarEmailCliente/);
  assert.doesNotMatch(webhook, /mudou === true/);

  const aplicar = await lerTexto("../functions/_shared/aplicar-order.ts");
  assert.match(aplicar, /emSegundoPlano\(enviarEmailCliente/);
  assert.doesNotMatch(aplicar, /await enviarEmailCliente/);

  const rastreio = await lerTexto("../functions/rastrear-pedido/index.ts");
  assert.match(rastreio, /bloqueio_rastreio/);
  assert.match(rastreio, /anotar_falha_rastreio/);
  assert.doesNotMatch(rastreio, /erro: "limite"/);
});
