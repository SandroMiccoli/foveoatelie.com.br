import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  EMAIL_ADMIN,
  caminhoDepois,
  emailEhAdmin,
  entrar,
  formatarData,
  formatarPreco,
  lerSessao,
  listarPedidos,
  mensagemDeEntrada,
  mensagemDePedidos,
  montarSessao,
  normalizarPedido,
  resumoPedidos,
  rotuloStatus,
  sessaoPrecisaRenovar,
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
  assert.equal(rotuloStatus("EXPIRADO"), "Expirado");
  assert.equal(rotuloStatus("outro"), "—");
  assert.equal(resumoPedidos([{ teste: false }, { teste: true }]), "2 pedidos, 1 de teste.");
  assert.equal(resumoPedidos([{ teste: false }]), "1 pedido.");
  assert.equal(resumoPedidos([]), "0 pedidos.");
});

test("pedido normalizado marca teste só quando é true", () => {
  const linha = normalizarPedido({
    codigo: "261119003",
    created_at: "2026-11-19T17:00:00.000Z",
    cliente_nome: "  Ana  ",
    total_centavos: 15000,
    status: "pago",
    teste: true,
  });
  assert.equal(linha.cliente_nome, "Ana");
  assert.equal(linha.teste, true);
  assert.equal(normalizarPedido({ teste: false }).teste, false);
  assert.equal(normalizarPedido({ teste: "true" }).teste, false);
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
      codigo: "261119009",
      created_at: "2026-11-19T17:00:00.000Z",
      cliente_nome: "Ana",
      total_centavos: 15000,
      status: "pago",
      teste: true,
    }]);
  };
  const lista = await listarPedidos({ url: "https://exemplo", anonKey: "chave" }, "token-da-sessao", fetchLista);
  assert.equal(lista.ok, true);
  assert.equal(lista.linhas[0].teste, true);
  assert.equal(autorizacao, "Bearer token-da-sessao");
});

test("mensagens não repetem o texto cru do servidor", () => {
  assert.equal(mensagemDeEntrada(400, { error_code: "invalid_credentials" }), "E-mail ou senha não conferem.");
  assert.equal(mensagemDePedidos(401, { code: "42501" }), "A leitura dos pedidos foi recusada. A migration do painel precisa estar aplicada.");
  assert.match(mensagemDePedidos(500, { message: "segredo interno" }), /Não foi possível carregar/);
  assert.doesNotMatch(mensagemDePedidos(500, { message: "segredo interno" }), /segredo/);
});

test("a migration não abre pedidos para a chave da loja", async () => {
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
