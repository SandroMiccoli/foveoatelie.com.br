import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  EMAIL_ADMIN,
  alterarStatusPedido,
  apagarPedidoTeste,
  caminhoDepois,
  emailEhAdmin,
  entrar,
  filtrarPedidos,
  formatarData,
  formatarPreco,
  formatarVelas,
  lerSessao,
  linkWhatsApp,
  listarPedidos,
  mensagemApagarTeste,
  mensagemCancelar,
  mensagemDeAcao,
  mensagemDeEntrada,
  mensagemDePedidos,
  mensagemReembolsar,
  montarSessao,
  normalizarPedido,
  opcoesStatus,
  reembolsarPedido,
  resumoPedidos,
  rotuloEntrega,
  proximoRail,
  rotuloOrigem,
  rotuloRail,
  rotuloStatus,
  RAIL_ABERTO,
  RAIL_AUTO,
  RAIL_RECOLHIDO,
  sessaoPrecisaRenovar,
  METRICA_PEDIDOS,
  METRICA_REAIS,
  METRICA_VELAS,
  agruparClientes,
  agruparEstoque,
  ajusteEstoque,
  deslocarMes,
  entradaProducao,
  filtrarClientes,
  juntarEstoque,
  listarDias,
  mesAtualSp,
  pedidoContaVenda,
  periodoMes,
  podeAvancarMes,
  resumoInicio,
  rotuloMovimento,
  semanaQueContem,
  serieVendas,
  validarAjuste,
  validarEntrada,
  validarPeriodo,
} from "../admin/js/painel.mjs";

test("só o e-mail do ateliê administra", () => {
  assert.equal(emailEhAdmin("contato@foveoatelie.com.br"), true);
  assert.equal(emailEhAdmin("  Contato@FoveoAtelie.com.br "), true);
  assert.equal(emailEhAdmin("outra@foveoatelie.com.br"), false);
  assert.equal(emailEhAdmin(""), false);
});

test("caminho depois do login fica dentro do painel", () => {
  assert.equal(caminhoDepois("/pedidos"), "/pedidos");
  assert.equal(caminhoDepois("/pedidos/"), "/pedidos");
  assert.equal(caminhoDepois("/entrar"), "/");
  assert.equal(caminhoDepois("https://exemplo.com"), "/");
  assert.equal(caminhoDepois("/admin"), "/");
});

test("preço e data em português, no fuso de São Paulo", () => {
  assert.equal(formatarPreco(15000).replace(/\s/g, " "), "R$ 150,00");
  assert.equal(formatarPreco(5990).replace(/\s/g, " "), "R$ 59,90");
  assert.equal(formatarPreco(null), "—");
  const data = formatarData("2026-11-19T17:00:00.000Z");
  assert.ok(data);
  assert.match(data.texto, /19\/11\/2026/);
  assert.match(data.texto, /14:00/);
  assert.equal(formatarData("nao-e-data"), null);
});

test("status e resumo", () => {
  assert.equal(rotuloStatus("pago"), "Pago");
  assert.equal(rotuloStatus("pendente"), "Aguardando pagamento");
  assert.equal(rotuloStatus("etiqueta_gerada"), "Etiqueta gerada");
  assert.equal(rotuloStatus("pronto_retirada"), "Pronto para retirada");
  assert.equal(rotuloStatus("reembolsado"), "Reembolsado");
  assert.equal(rotuloStatus("EXPIRADO"), "Expirado");
  assert.equal(rotuloStatus("outro"), "—");
  assert.equal(resumoPedidos([{ teste: false }, { teste: true }]), "2 pedidos, 1 de teste.");
  assert.equal(resumoPedidos([{ teste: false }]), "1 pedido.");
  assert.equal(resumoPedidos([]), "0 pedidos.");
});

test("pedido normalizado marca teste só quando é true", () => {
  const linha = normalizarPedido({
    id: "11111111-1111-1111-1111-111111111111",
    codigo: "261119003",
    created_at: "2026-11-19T17:00:00.000Z",
    cliente_nome: "  Ana  ",
    cliente_email: "Ana@Exemplo.com",
    cliente_telefone: "31999990000",
    cliente_cpf: "12345678909",
    itens: [{ produto_id: "acolher", nome: "Acolher", qtd: 2, preco_unitario_centavos: 6000 }],
    entrega_tipo: "envio",
    endereco: { cidade: "Ilhéus", uf: "ba", cep: "45656552", logradouro: "Rua A", numero: "1", bairro: "Centro" },
    frete: { transportadora: "Jadlog", servico: "Package", preco_centavos: 2500 },
    frete_centavos: 2500,
    subtotal_centavos: 12000,
    desconto_centavos: 1000,
    total_centavos: 13500,
    status: "pago",
    teste: true,
  });
  assert.equal(linha.cliente_nome, "Ana");
  assert.equal(linha.cliente_email, "ana@exemplo.com");
  assert.equal(linha.teste, true);
  assert.equal(linha.itens[0].qtd, 2);
  assert.equal(linha.endereco.uf, "BA");
  assert.equal(normalizarPedido({ teste: false }).teste, false);
  assert.equal(normalizarPedido({ teste: "true" }).teste, false);
});

test("velas, entrega e WhatsApp", () => {
  assert.equal(formatarVelas([{ nome: "Acolher", qtd: 1 }, { nome: "Despertar", qtd: 2 }]), "Acolher, 2× Despertar");
  assert.equal(
    rotuloEntrega({
      entrega_tipo: "envio",
      endereco: { cidade: "Ilhéus", uf: "BA" },
    }),
    "Envio · Ilhéus/BA",
  );
  assert.equal(rotuloEntrega({ entrega_tipo: "retirada" }), "Retirada");
  assert.equal(linkWhatsApp("31996099111"), "https://wa.me/5531996099111");
  assert.equal(linkWhatsApp("5531996099111"), "https://wa.me/5531996099111");
  assert.equal(linkWhatsApp(""), "");
});

test("filtros, busca e toggle de teste", () => {
  const base = [
    pedidoFixture({
      id: "a",
      codigo: "261119003",
      cliente_nome: "Ana Silva",
      cliente_email: "ana@exemplo.com",
      cliente_cpf: "12345678909",
      status: "pago",
      entrega_tipo: "envio",
      teste: true,
      created_at: "2026-11-19T17:00:00.000Z",
    }),
    pedidoFixture({
      id: "b",
      codigo: "261119012",
      cliente_nome: "Bia Costa",
      cliente_email: "bia@exemplo.com",
      status: "pendente",
      entrega_tipo: "retirada",
      teste: false,
      created_at: "2026-11-20T15:00:00.000Z",
    }),
    pedidoFixture({
      id: "c",
      codigo: "261118001",
      cliente_nome: "Carla",
      status: "enviado",
      entrega_tipo: "envio",
      teste: false,
      created_at: "2026-11-18T12:00:00.000Z",
    }),
  ];

  assert.equal(filtrarPedidos(base, { mostrarTestes: true, entrega: "todos", status: "", busca: "", de: "", ate: "" }).length, 3);
  assert.equal(filtrarPedidos(base, { mostrarTestes: false, entrega: "todos", status: "", busca: "", de: "", ate: "" }).length, 2);
  assert.equal(filtrarPedidos(base, { mostrarTestes: true, entrega: "retirada", status: "", busca: "", de: "", ate: "" }).map((p) => p.id).join(), "b");
  assert.equal(filtrarPedidos(base, { mostrarTestes: true, entrega: "todos", status: "pago", busca: "", de: "", ate: "" }).map((p) => p.id).join(), "a");
  assert.equal(filtrarPedidos(base, { mostrarTestes: true, entrega: "todos", status: "", busca: "261119012", de: "", ate: "" }).map((p) => p.id).join(), "b");
  assert.equal(filtrarPedidos(base, { mostrarTestes: true, entrega: "todos", status: "", busca: "#261119003", de: "", ate: "" }).map((p) => p.id).join(), "a");
  assert.equal(filtrarPedidos(base, { mostrarTestes: true, entrega: "todos", status: "", busca: "bia@", de: "", ate: "" }).map((p) => p.id).join(), "b");
  assert.equal(filtrarPedidos(base, { mostrarTestes: true, entrega: "todos", status: "", busca: "12345678909", de: "", ate: "" }).map((p) => p.id).join(), "a");
  assert.equal(filtrarPedidos(base, { mostrarTestes: true, entrega: "todos", status: "", busca: "", de: "2026-11-19", ate: "2026-11-19" }).map((p) => p.id).join(), "a");
  assert.equal(filtrarPedidos(base, { mostrarTestes: true, entrega: "todos", status: "", busca: "", de: "2026-11-19", ate: "2026-11-20" }).map((p) => p.id).sort().join(), "a,b");
});

test("opções de status seguem o tipo de entrega", () => {
  assert.ok(opcoesStatus("envio").includes("etiqueta_gerada"));
  assert.ok(!opcoesStatus("envio").includes("pronto_retirada"));
  assert.ok(opcoesStatus("retirada").includes("pronto_retirada"));
  assert.ok(opcoesStatus("retirada").includes("cancelado"));
  assert.ok(opcoesStatus("envio").includes("reembolsado"));
});

test("confirmações de cancelar, reembolsar e apagar teste", () => {
  const pago = pedidoFixture({
    codigo: "261119012",
    total_centavos: 6000,
    forma_pagamento: "Pix",
    teste: true,
  });
  assert.match(mensagemCancelar(pago), /#261119012/);
  assert.match(mensagemCancelar(pago), /estoque/);
  assert.match(mensagemReembolsar(pago).replace(/\s/g, " "), /R\$ 60,00/);
  assert.match(mensagemReembolsar(pago), /Mercado Pago/);
  assert.match(mensagemReembolsar(pago), /Pix/);
  assert.match(mensagemReembolsar(pago), /desfazer/);
  assert.match(mensagemApagarTeste(pago), /teste/);
  assert.match(mensagemApagarTeste(pago), /#261119012/);
});

test("sessão de outra conta não fica gravada", () => {
  const storage = memoria();
  storage.setItem("foveo.admin.sessao", JSON.stringify({
    access_token: "a",
    refresh_token: "r",
    expires_at: 2_000_000_000,
    email: "outra@exemplo.com",
  }));
  assert.equal(lerSessao(storage), null);

  const admin = montarSessao({
    access_token: "a",
    refresh_token: "r",
    expires_in: 3600,
    user: { email: EMAIL_ADMIN },
  }, 1_700_000_000_000);
  assert.ok(admin);
  assert.equal(admin.email, EMAIL_ADMIN);
  assert.equal(sessaoPrecisaRenovar(admin, 1_700_000_000_000), false);
  assert.equal(sessaoPrecisaRenovar(admin, admin.expires_at * 1000), true);
});

test("login recusa credencial errada e conta que não é do ateliê", async () => {
  const fetchRuim = async () => resposta(400, { error_code: "invalid_credentials", msg: "Invalid login credentials" });
  const ruim = await entrar({ url: "https://exemplo", anonKey: "k" }, "contato@foveoatelie.com.br", "x", fetchRuim, 0);
  assert.equal(ruim.ok, false);
  assert.equal(ruim.mensagem, "E-mail ou senha não conferem.");

  const chamadas = [];
  const fetchOutra = async (url, init) => {
    chamadas.push({ url, init });
    if (String(url).includes("grant_type=password")) {
      return resposta(200, {
        access_token: "tok",
        refresh_token: "ref",
        expires_in: 3600,
        user: { email: "outra@exemplo.com" },
      });
    }
    return resposta(204, {});
  };
  const outra = await entrar({ url: "https://exemplo", anonKey: "k" }, "outra@exemplo.com", "x", fetchOutra, 1_700_000_000_000);
  assert.equal(outra.ok, false);
  assert.match(outra.mensagem, /não administra/);
  assert.equal(chamadas.length, 2);
  assert.match(chamadas[1].url, /\/logout$/);
});

test("lista de pedidos usa o token da sessão, não a chave sozinha", async () => {
  let autorizacao = "";
  const fetchLista = async (_url, init) => {
    autorizacao = init.headers.Authorization;
    return resposta(200, [{
      id: "11111111-1111-1111-1111-111111111111",
      codigo: "261119009",
      created_at: "2026-11-19T17:00:00.000Z",
      cliente_nome: "Ana",
      total_centavos: 15000,
      status: "pago",
      teste: true,
      itens: [],
      entrega_tipo: "retirada",
    }]);
  };
  const lista = await listarPedidos({ url: "https://exemplo", anonKey: "chave" }, "token-da-sessao", fetchLista);
  assert.equal(lista.ok, true);
  assert.equal(lista.linhas[0].teste, true);
  assert.equal(autorizacao, "Bearer token-da-sessao");
});

test("alterar status, apagar teste e reembolso chamam os endpoints certos", async () => {
  const urls = [];
  const fetchSpy = async (url, init) => {
    urls.push({ url: String(url), method: init.method, body: init.body });
    if (String(url).includes("reembolsar-pedido")) {
      return resposta(200, { ok: true, status: "reembolsado" });
    }
    return resposta(200, { ok: true, status: "cancelado" });
  };
  const cfg = { url: "https://exemplo", anonKey: "chave" };
  const cancelar = await alterarStatusPedido(cfg, "tok", "11111111-1111-1111-1111-111111111111", "cancelado", fetchSpy);
  assert.equal(cancelar.ok, true);
  assert.match(urls[0].url, /rpc\/admin_alterar_status_pedido$/);
  assert.match(urls[0].body, /"p_status":"cancelado"/);

  const apagar = await apagarPedidoTeste(cfg, "tok", "11111111-1111-1111-1111-111111111111", fetchSpy);
  assert.equal(apagar.ok, true);
  assert.match(urls[1].url, /rpc\/admin_apagar_pedido_teste$/);

  const reembolso = await reembolsarPedido(cfg, "tok", "11111111-1111-1111-1111-111111111111", fetchSpy);
  assert.equal(reembolso.ok, true);
  assert.match(urls[2].url, /functions\/v1\/reembolsar-pedido$/);
  assert.match(urls[2].body, /pedido_id/);
});

test("reembolso recusado pelo Mercado Pago não inventa sucesso", async () => {
  const fetchMp = async () => resposta(409, {
    ok: false,
    erro: "mp_recusou",
    mensagem: "O Mercado Pago diz que esse pagamento já foi devolvido.",
  });
  const resultado = await reembolsarPedido(
    { url: "https://exemplo", anonKey: "k" },
    "tok",
    "11111111-1111-1111-1111-111111111111",
    fetchMp,
  );
  assert.equal(resultado.ok, false);
  assert.equal(
    mensagemDeAcao(resultado.body, "falhou"),
    "O Mercado Pago diz que esse pagamento já foi devolvido.",
  );
});

test("mensagens não repetem o texto cru do servidor", () => {
  assert.equal(mensagemDeEntrada(400, { error_code: "invalid_credentials" }), "E-mail ou senha não conferem.");
  assert.equal(mensagemDePedidos(401, { code: "42501" }), "A leitura dos pedidos foi recusada. A migration do painel precisa estar aplicada.");
  assert.match(mensagemDePedidos(500, { message: "segredo interno" }), /Não foi possível carregar/);
  assert.doesNotMatch(mensagemDePedidos(500, { message: "segredo interno" }), /segredo/);
  assert.equal(mensagemDeAcao({ erro: "nao_teste" }), "Pedido real não pode ser apagado.");
  assert.equal(mensagemDeAcao({ erro: "use_reembolso" }), "Reembolso passa pelo Mercado Pago, não pela troca de status.");
});

test("a migration do estágio 1 não abre pedidos para a chave da loja", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20261119230000_admin_acesso.sql", import.meta.url), "utf8");
  const semComentario = sql.replace(/--.*$/gm, "");
  assert.match(sql, /contato@foveoatelie\.com\.br/);
  assert.match(sql, /GRANT SELECT, UPDATE ON TABLE public\.pedidos TO authenticated/);
  assert.match(sql, /261119003/);
  assert.match(sql, /261119009/);
  assert.doesNotMatch(semComentario, /GRANT[^;]*TO anon/i);
  assert.doesNotMatch(sql, /DROP POLICY pedidos_sem_acesso_cliente/);
  assert.match(sql, /pedidos_admin_leitura/);
  assert.match(sql, /pedidos_admin_atualizacao/);
});

test("a migration da etapa 2 trava estoque, histórico e apagar teste", async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/20261120060000_admin_pedidos_etapa2.sql", import.meta.url),
    "utf8",
  );
  const semComentario = sql.replace(/--.*$/gm, "");
  assert.match(sql, /cliente_cpf/);
  assert.match(sql, /pedido_status_historico/);
  assert.match(sql, /admin_alterar_status_pedido/);
  assert.match(sql, /admin_confirmar_reembolso/);
  assert.match(sql, /admin_apagar_pedido_teste/);
  assert.match(sql, /estoque_restaurado_em/);
  assert.match(sql, /teste IS TRUE/);
  assert.match(sql, /SET search_path = pg_catalog/);
  assert.match(sql, /REVOKE UPDATE, DELETE, INSERT ON TABLE public\.pedidos FROM authenticated/);
  assert.doesNotMatch(semComentario, /GRANT[^;]*TO anon/i);
  assert.match(sql, /etiqueta_gerada/);
  assert.match(sql, /pronto_retirada/);
  assert.match(sql, /reembolsado/);
});

test("a Edge Function de reembolso não expõe o token e exige o admin", async () => {
  const src = await readFile(
    new URL("../supabase/functions/reembolsar-pedido/index.ts", import.meta.url),
    "utf8",
  );
  assert.match(src, /MERCADO_PAGO_ACCESS_TOKEN/);
  assert.match(src, /contato@foveoatelie\.com\.br/);
  assert.match(src, /\/v1\/orders\/.*\/refund/);
  assert.match(src, /admin_confirmar_reembolso/);
  assert.doesNotMatch(src, /jsonPainel\([^)]*tokenMp/);
  assert.doesNotMatch(src, /mensagem:.*tokenMp/);
});

test("a tela de login mostra só a marca e o formulário", async () => {
  const app = await readFile(new URL("../admin/js/app.mjs", import.meta.url), "utf8");
  const tela = app.slice(app.indexOf("function telaEntrar"), app.indexOf("function telaSumida"));
  assert.match(tela, /class:\s*"sr-only"/);
  assert.match(tela, /text:\s*"Entrar"/);
  assert.match(tela, /id:\s*"form-entrar"/);
  assert.match(tela, /marca-entrada/);
  assert.doesNotMatch(tela, /titulo\("Entrar"\)/);
  assert.doesNotMatch(tela, /Use a conta do ateliê/);
  assert.doesNotMatch(tela, /class:\s*"lede"/);
});

test("o detalhe e as confirmações existem na interface", async () => {
  const app = await readFile(new URL("../admin/js/app.mjs", import.meta.url), "utf8");
  assert.match(app, /painel-detalhe/);
  assert.match(app, /data-fechar-detalhe/);
  assert.match(app, /Escape/);
  assert.match(app, /notas-pedido/);
  assert.match(app, /data-apagar-teste/);
  assert.match(app, /data-confirmar-sim/);
  assert.match(app, /filtros-pedidos/);
  assert.match(app, /data-toggle-testes/);
});

test("origem do histórico fica em português", () => {
  assert.equal(rotuloOrigem("mercado_pago"), "Mercado Pago");
  assert.equal(rotuloOrigem("checkout"), "Checkout");
  assert.equal(rotuloOrigem("admin"), "Ajuste manual");
  assert.equal(rotuloOrigem("manual"), "Ajuste manual");
  assert.equal(rotuloOrigem("webhook"), "Mercado Pago");
  assert.equal(rotuloOrigem("reembolso"), "Reembolso");
  assert.equal(rotuloOrigem("sistema"), "Sistema");
  assert.equal(rotuloOrigem("melhor_envio"), "Melhor Envio");
  assert.equal(rotuloOrigem("fonte_desconhecida"), "Fonte Desconhecida");
  assert.equal(rotuloOrigem(""), "");
});

test("a lista no computador não espreme nem quebra palavra no meio", async () => {
  const css = await readFile(new URL("../admin/css/admin.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(css, /word-break:\s*break-all/);
  assert.doesNotMatch(css, /min-width:\s*56rem/);
  assert.match(css, /td\[data-campo="velas"\][\s\S]*?white-space:\s*normal/);
  assert.match(css, /td\[data-campo="entrega"\][\s\S]*?white-space:\s*normal/);
  assert.match(css, /pedidos-com-detalhe \.detalhe-camada[\s\S]*position:\s*fixed/);
  assert.match(css, /\.detalhe\s*\{[\s\S]*27\.5rem/);
  assert.doesNotMatch(css, /pedidos-com-detalhe \.pedidos-miolo[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*min\(/);
  assert.match(css, /\.detalhe-campo\s*\{[\s\S]*column-gap:\s*1\.25rem/);
  assert.match(css, /\.detalhe-campo\s*\{[\s\S]*9\.5rem/);
});

test("o menu lateral no computador recolhe e fixa o estado", async () => {
  assert.equal(proximoRail(RAIL_AUTO), RAIL_ABERTO);
  assert.equal(proximoRail(RAIL_ABERTO), RAIL_RECOLHIDO);
  assert.equal(proximoRail(RAIL_RECOLHIDO), RAIL_AUTO);
  assert.match(rotuloRail(RAIL_AUTO), /Fixar/);
  const css = await readFile(new URL("../admin/css/admin.css", import.meta.url), "utf8");
  assert.match(css, /--rail-w:\s*4rem/);
  assert.match(css, /\.casca\.rail-aberta \.rail/);
  assert.match(css, /\.casca\.rail-hover \.rail/);
  const app = await readFile(new URL("../admin/js/app.mjs", import.meta.url), "utf8");
  assert.match(app, /data-rail-fixar/);
  assert.match(app, /RAIL_HOVER_MS\s*=\s*300/);
  assert.match(app, /iconeWhatsApp|wa-icone/);
  assert.match(app, /nav-icone/);
  assert.match(app, /text:\s*"WhatsApp"/);
  assert.match(app, /Abrir WhatsApp de/);
  assert.match(app, /viewBox:\s*"142 85 796 910"/);
  assert.match(app, /fill:\s*"currentColor"/);
});

test("início ignora teste e separa envio, pagamento, semana, mês e liberação", () => {
  const agora = new Date("2026-11-20T15:00:00.000Z");
  assert.deepEqual(mesAtualSp(agora), { ano: 2026, mes: 11 });
  assert.deepEqual(semanaQueContem("2026-11-20"), { de: "2026-11-16", ate: "2026-11-22" });
  assert.equal(podeAvancarMes(2026, 11, agora), false);
  assert.equal(podeAvancarMes(2026, 10, agora), true);
  assert.deepEqual(deslocarMes(2026, 1, -1), { ano: 2025, mes: 12 });

  const pedidos = [
    pedidoFixture({
      id: "envio",
      status: "pago",
      total_centavos: 8900,
      mp_liquido_centavos: 8500,
      mp_liberacao_em: "2026-12-05T12:00:00.000Z",
      pago_em: "2026-11-18T15:00:00.000Z",
      created_at: "2026-11-18T14:00:00.000Z",
    }),
    pedidoFixture({
      id: "etiqueta",
      status: "etiqueta_gerada",
      total_centavos: 17800,
      mp_liquido_centavos: 17000,
      mp_liberacao_em: "2026-11-10T12:00:00.000Z",
      pago_em: "2026-11-20T18:00:00.000Z",
      created_at: "2026-11-20T17:00:00.000Z",
    }),
    pedidoFixture({
      id: "retirada",
      status: "pronto_retirada",
      entrega_tipo: "retirada",
      total_centavos: 8900,
      pago_em: "2026-11-02T15:00:00.000Z",
      created_at: "2026-11-02T14:00:00.000Z",
    }),
    pedidoFixture({
      id: "pendente",
      status: "pendente",
      total_centavos: 8900,
      created_at: "2026-11-19T15:00:00.000Z",
    }),
    pedidoFixture({
      id: "enviado",
      status: "enviado",
      total_centavos: 6000,
      pago_em: "2026-10-28T15:00:00.000Z",
      created_at: "2026-10-28T14:00:00.000Z",
    }),
    pedidoFixture({
      id: "teste",
      status: "pago",
      teste: true,
      total_centavos: 50000,
      mp_liquido_centavos: 48000,
      mp_liberacao_em: "2026-12-01T12:00:00.000Z",
      pago_em: "2026-11-19T15:00:00.000Z",
      created_at: "2026-11-19T14:00:00.000Z",
    }),
    pedidoFixture({
      id: "reembolso",
      status: "reembolsado",
      total_centavos: 8900,
      pago_em: "2026-11-17T15:00:00.000Z",
      created_at: "2026-11-17T14:00:00.000Z",
    }),
  ];

  const resumo = resumoInicio(pedidos, agora);
  assert.equal(resumo.aguardandoEnvio, 3);
  assert.equal(resumo.aguardandoPagamento, 1);
  assert.equal(resumo.vendasSemanaCentavos, 8900 + 17800);
  assert.equal(resumo.vendasMesCentavos, 8900 + 17800 + 8900);
  assert.equal(resumo.aLiberarCentavos, 8500);
  assert.equal(pedidoContaVenda(pedidos[5]), false);
  assert.equal(pedidoContaVenda(pedidos[6]), false);
});

test("gráfico do mês soma reais, pedidos e velas, e o acumulado ignora teste", () => {
  const agora = new Date("2026-11-20T15:00:00.000Z");
  const mes = periodoMes(2026, 11);
  assert.equal(mes.de, "2026-11-01");
  assert.equal(mes.ate, "2026-11-30");
  assert.equal(listarDias("2026-11-01", "2026-11-30").length, 30);
  assert.equal(validarPeriodo("2026-11-20", "2026-11-01"), "A data inicial precisa ser antes da final.");
  assert.match(validarPeriodo("2026-01-01", "2026-06-01"), /120/);

  const pedidos = [
    pedidoFixture({
      status: "pago",
      total_centavos: 8900,
      pago_em: "2026-11-18T15:00:00.000Z",
      created_at: "2026-11-18T14:00:00.000Z",
      itens: [
        { produto_id: "acolher", nome: "Acolher", qtd: 1, preco_unitario_centavos: 8900 },
        { produto_id: "permanecer", nome: "Permanecer", qtd: 1, preco_unitario_centavos: 8900 },
      ],
    }),
    pedidoFixture({
      id: "b",
      status: "entregue",
      total_centavos: 17800,
      pago_em: "2026-11-18T18:00:00.000Z",
      created_at: "2026-11-18T17:00:00.000Z",
      itens: [{ produto_id: "despertar", nome: "Despertar", qtd: 2, preco_unitario_centavos: 8900 }],
    }),
    pedidoFixture({
      id: "teste",
      status: "pago",
      teste: true,
      total_centavos: 99900,
      pago_em: "2026-11-18T19:00:00.000Z",
      created_at: "2026-11-18T19:00:00.000Z",
    }),
  ];

  const reais = serieVendas(pedidos, mes.de, mes.ate, METRICA_REAIS);
  const dia = reais.pontos.find((ponto) => ponto.dia === "2026-11-18");
  assert.equal(dia.valor, 8900 + 17800);
  assert.equal(dia.reais, 8900 + 17800);
  assert.equal(reais.totalReais, 8900 + 17800);
  assert.equal(reais.pontos.at(-1).acumulado, reais.totalReais);
  assert.equal(reais.pontos[0].dia, "2026-11-01");

  const contagem = serieVendas(pedidos, mes.de, mes.ate, METRICA_PEDIDOS);
  assert.equal(contagem.pontos.find((ponto) => ponto.dia === "2026-11-18").valor, 2);
  const velas = serieVendas(pedidos, mes.de, mes.ate, METRICA_VELAS);
  assert.equal(velas.pontos.find((ponto) => ponto.dia === "2026-11-18").valor, 4);
  assert.equal(reais.metrica, METRICA_REAIS);
});

test("estoque agrupa a coleção e marca menos de 3 como baixo", () => {
  const velas = juntarEstoque(
    [
      { id: "permanecer", nome: "Permanecer", colecao: "Coleção 2026", ordem: 3, ativo: true },
      { id: "acolher", nome: "Acolher", colecao: "Coleção 2026", ordem: 1, ativo: true },
      { id: "despertar", nome: "Despertar", ordem: 2, ativo: true },
    ],
    [
      { produto_id: "acolher", disponivel: 2, reservado: 1 },
      { produto_id: "despertar", disponivel: 3, reservado: 0 },
      { produto_id: "permanecer", disponivel: 1, reservado: 0 },
    ],
  );
  const grupos = agruparEstoque(velas);
  assert.equal(grupos.length, 1);
  assert.equal(grupos[0].colecao, "Coleção 2026");
  assert.deepEqual(grupos[0].itens.map((vela) => vela.id), ["acolher", "despertar", "permanecer"]);
  assert.equal(grupos[0].itens[0].baixo, true);
  assert.equal(grupos[0].itens[1].baixo, false);
  assert.equal(grupos[0].itens[2].baixo, true);
  assert.equal(grupos[0].itens[0].reservado, 1);
  assert.equal(rotuloMovimento("ajuste"), "Ajuste manual");
  assert.equal(rotuloMovimento("producao"), "Entrada de produção");
  assert.equal(validarEntrada("10"), "");
  assert.match(validarEntrada("0"), /maior que zero/);
  assert.match(validarAjuste("-1"), /zero/);
  assert.equal(validarAjuste("0"), "");
});

test("clientes agrupam por CPF, senão por e-mail, e o total deixa teste e reembolso de fora", () => {
  const pedidos = [
    pedidoFixture({
      id: "1",
      codigo: "261118001",
      cliente_nome: "Marina Alves",
      cliente_email: "marina@exemplo.com",
      cliente_telefone: "31988887777",
      cliente_cpf: "12345678909",
      status: "entregue",
      total_centavos: 17800,
      created_at: "2026-11-08T15:00:00.000Z",
      pago_em: "2026-11-08T15:00:00.000Z",
    }),
    pedidoFixture({
      id: "2",
      codigo: "261120004",
      cliente_nome: "Marina A.",
      cliente_email: "marina.nova@exemplo.com",
      cliente_telefone: "31988887777",
      cliente_cpf: "123.456.789-09",
      status: "pago",
      total_centavos: 8900,
      created_at: "2026-11-20T15:00:00.000Z",
      pago_em: "2026-11-20T15:00:00.000Z",
    }),
    pedidoFixture({
      id: "3",
      codigo: "261119002",
      cliente_nome: "Marina Alves",
      cliente_email: "marina@exemplo.com",
      cliente_cpf: "12345678909",
      status: "reembolsado",
      total_centavos: 8900,
      created_at: "2026-11-12T15:00:00.000Z",
    }),
    pedidoFixture({
      id: "4",
      codigo: "261119009",
      cliente_nome: "Marina Alves",
      cliente_email: "marina@exemplo.com",
      cliente_cpf: "12345678909",
      status: "pago",
      teste: true,
      total_centavos: 50000,
      created_at: "2026-11-19T15:00:00.000Z",
    }),
    pedidoFixture({
      id: "5",
      codigo: "261116003",
      cliente_nome: "Helena Duarte",
      cliente_email: "helena@exemplo.com",
      cliente_telefone: "31977776666",
      cliente_cpf: "",
      status: "retirado",
      entrega_tipo: "retirada",
      total_centavos: 8900,
      created_at: "2026-11-16T18:00:00.000Z",
      pago_em: "2026-11-16T18:00:00.000Z",
    }),
  ];
  // CPF com máscara não passa no normalizar (só dígitos). O fixture usa normalizarPedido.
  pedidos[1] = pedidoFixture({
    id: "2",
    codigo: "261120004",
    cliente_nome: "Marina A.",
    cliente_email: "marina.nova@exemplo.com",
    cliente_telefone: "31988887777",
    cliente_cpf: "12345678909",
    status: "pago",
    total_centavos: 8900,
    created_at: "2026-11-20T15:00:00.000Z",
    pago_em: "2026-11-20T15:00:00.000Z",
  });

  const clientes = agruparClientes(pedidos);
  assert.equal(clientes.length, 2);
  assert.equal(clientes[0].nome, "Marina A.");
  assert.equal(clientes[0].quantidade, 3);
  assert.equal(clientes[0].totalCentavos, 17800 + 8900);
  assert.equal(clientes[1].nome, "Helena Duarte");
  assert.equal(clientes[1].chave.startsWith("email:"), true);
  assert.equal(filtrarClientes(clientes, "helena@").length, 1);
  assert.equal(filtrarClientes(clientes, "123.456.789-09").length, 1);
  assert.equal(filtrarClientes(clientes, "ninguém").length, 0);
});

test("entrada e ajuste chamam as funções admin, sem update direto", async () => {
  const urls = [];
  const fetchSpy = async (url, init) => {
    urls.push({ url: String(url), body: init.body });
    return resposta(200, { ok: true, disponivel: 12, reservado: 1 });
  };
  const cfg = { url: "https://exemplo", anonKey: "chave" };
  const entrada = await entradaProducao(cfg, "tok", "acolher", 10, "Fiz 10 Acolher", fetchSpy);
  assert.equal(entrada.ok, true);
  assert.match(urls[0].url, /rpc\/admin_entrada_producao$/);
  assert.match(urls[0].body, /"p_quantidade":10/);
  const ajuste = await ajusteEstoque(cfg, "tok", "permanecer", 4, "Contagem da prateleira", fetchSpy);
  assert.equal(ajuste.ok, true);
  assert.match(urls[1].url, /rpc\/admin_ajuste_estoque$/);
  assert.match(urls[1].body, /"p_disponivel":4/);
});

test("a migration da etapa 3 não abre escrita nem o anon", async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/20261120120000_admin_etapa3.sql", import.meta.url),
    "utf8",
  );
  const semComentario = sql.replace(/--.*$/gm, "");
  assert.match(sql, /colecao/);
  assert.match(sql, /Coleção 2026/);
  assert.match(sql, /estoque_movimentos/);
  assert.match(sql, /admin_entrada_producao/);
  assert.match(sql, /admin_ajuste_estoque/);
  assert.match(sql, /SET search_path = pg_catalog/);
  assert.match(sql, /public\.is_admin\(\)/);
  assert.match(sql, /estoque_disponivel_nao_negativo/);
  assert.match(sql, /estoque_registra_movimento/);
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE ON TABLE public\.estoque FROM authenticated/);
  assert.match(sql, /GRANT SELECT ON TABLE public\.estoque_movimentos TO authenticated/);
  assert.doesNotMatch(semComentario, /GRANT[^;]*TO anon/i);
  assert.doesNotMatch(semComentario, /GRANT INSERT[^;]*estoque/i);
  assert.doesNotMatch(semComentario, /GRANT UPDATE[^;]*estoque/i);
  assert.doesNotMatch(semComentario, /GRANT DELETE[^;]*estoque/i);
});

test("as telas novas cabem no computador sem cortar coluna", async () => {
  const css = await readFile(new URL("../admin/css/admin.css", import.meta.url), "utf8");
  const telas = await readFile(new URL("../admin/js/telas.mjs", import.meta.url), "utf8");
  assert.match(telas, /Aguardando envio/);
  assert.match(telas, /Entrada de produção/);
  assert.match(telas, /Ajuste rápido/);
  assert.match(telas, /Saldo depois/);
  assert.match(telas, /Última compra/);
  assert.match(telas, /data-abrir-pedido/);
  assert.doesNotMatch(telas, /Foveo(?!ō)/);
  assert.match(css, /td\[data-campo="obs"\][\s\S]*white-space:\s*normal/);
  assert.match(css, /word-break:\s*normal/);
  assert.doesNotMatch(css, /overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(css, /word-break:\s*break-all/);
  assert.match(telas, /class:\s*"th-num"/);
  assert.match(css, /\.lista-clientes th\.th-num[\s\S]*text-align:\s*right/);
  assert.match(css, /\.marca-entrada\s*\{[\s\S]*max-width:\s*calc\(100vw - 3rem\)/);
  assert.match(css, /max-width:\s*59\.99rem\)[\s\S]*\.nav\s*\{[\s\S]*position:\s*static/);
});

function pedidoFixture(extra) {
  return normalizarPedido({
    id: "00000000-0000-0000-0000-000000000000",
    codigo: "261119000",
    created_at: "2026-11-19T17:00:00.000Z",
    cliente_nome: "Cliente",
    cliente_email: "cliente@exemplo.com",
    cliente_telefone: "31999990000",
    itens: [{ produto_id: "acolher", nome: "Acolher", qtd: 1, preco_unitario_centavos: 6000 }],
    entrega_tipo: "envio",
    endereco: { cidade: "BH", uf: "MG" },
    frete_centavos: 0,
    subtotal_centavos: 6000,
    desconto_centavos: 0,
    total_centavos: 6000,
    status: "pago",
    teste: false,
    ...extra,
  });
}

function memoria() {
  const dados = new Map();
  return {
    getItem: (chave) => (dados.has(chave) ? dados.get(chave) : null),
    setItem: (chave, valor) => dados.set(chave, String(valor)),
    removeItem: (chave) => dados.delete(chave),
  };
}

function resposta(status, corpo) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => corpo,
  };
}
