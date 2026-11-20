import assert from "node:assert/strict";
import test from "node:test";

import {
  ESTOQUE_MINIMO,
  chaveDiaSp,
  chaveProblema,
  corpoWebhookAviso,
  deveAlertarEstoque,
  mensagemEstoque,
  mensagemProblema,
  mensagemSaldo,
  mensagemToken,
  papelDoJwt,
  podeRegistrarAviso,
  problemaEntrega,
  saldoAbaixo,
} from "../functions/_shared/avisos.ts";
import { USER_AGENT } from "../functions/_shared/frete.ts";
import {
  ANTECEDENCIA_MS,
  USER_AGENT_OAUTH,
  decidirRenovacao,
  lerRespostaOauth,
  precisaRenovar,
  opcoesDaTentativa,
  reservaDepoisDo401,
  resolverToken,
  type DepsToken,
  type EstadoToken,
} from "../functions/_shared/token-me.ts";

const AGORA = Date.parse("2026-11-20T15:00:00.000Z");
const ACCESS = "a".repeat(40);
const REFRESH = "r".repeat(40);
const NOVO_ACCESS = "n".repeat(40);
const NOVO_REFRESH = "s".repeat(40);

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function estado(extra: Partial<EstadoToken> = {}): EstadoToken {
  return {
    vazio: false,
    accessToken: ACCESS,
    temRefresh: true,
    expiresAt: iso(AGORA + ANTECEDENCIA_MS + 86_400_000),
    renovando: false,
    ...extra,
  };
}

test("renova quando falta 7 dias ou menos, e não quando a data é desconhecida", () => {
  assert.equal(precisaRenovar(null, AGORA), false);
  assert.equal(precisaRenovar("nao-e-data", AGORA), false);
  assert.equal(precisaRenovar(iso(AGORA + ANTECEDENCIA_MS + 1000), AGORA), false);
  assert.equal(precisaRenovar(iso(AGORA + ANTECEDENCIA_MS), AGORA), true);
  assert.equal(precisaRenovar(iso(AGORA + 60_000), AGORA), true);
});

test("a decisão não gira um token fresco nem um que está sendo renovado", () => {
  assert.deepEqual(decidirRenovacao(estado(), ACCESS, false, AGORA), { tipo: "usar", token: ACCESS });
  assert.deepEqual(
    decidirRenovacao(estado({ vazio: true, accessToken: "", temRefresh: false, expiresAt: null }), ACCESS, false, AGORA),
    { tipo: "usar", token: ACCESS },
  );
  assert.deepEqual(decidirRenovacao(estado({ renovando: true }), ACCESS, true, AGORA), { tipo: "esperar" });
  assert.equal(decidirRenovacao(estado({ expiresAt: iso(AGORA + 3 * 86_400_000) }), "", false, AGORA).tipo, "renovar");
  assert.deepEqual(
    decidirRenovacao(estado({ temRefresh: false, expiresAt: iso(AGORA + 1000) }), ACCESS, false, AGORA),
    { tipo: "sem_refresh", token: ACCESS },
  );
  assert.deepEqual(
    decidirRenovacao(estado({ vazio: true, accessToken: "", temRefresh: false, expiresAt: null }), "", false, AGORA),
    { tipo: "ausente" },
  );
  assert.deepEqual(
    decidirRenovacao(estado({ expiresAt: null }), ACCESS, false, AGORA),
    { tipo: "usar", token: ACCESS },
  );
  assert.equal(
    decidirRenovacao(estado({ expiresAt: null }), "", false, AGORA, true).tipo,
    "renovar",
  );
});

test("a resposta OAuth precisa dos dois tokens", () => {
  const ok = lerRespostaOauth(
    { access_token: NOVO_ACCESS, refresh_token: NOVO_REFRESH, expires_in: 3600 },
    AGORA,
  );
  assert.equal(ok?.accessToken, NOVO_ACCESS);
  assert.equal(ok?.expiresAt, iso(AGORA + 3600 * 1000));
  assert.equal(lerRespostaOauth({ access_token: NOVO_ACCESS }, AGORA), null);
  assert.equal(lerRespostaOauth({ access_token: "curto", refresh_token: NOVO_REFRESH }, AGORA), null);
  assert.equal(USER_AGENT_OAUTH, USER_AGENT);
  assert.equal(USER_AGENT_OAUTH, "Foveo Atelie (contato@foveoatelie.com.br)");
});

function jwt(role: string): string {
  const payload = btoa(JSON.stringify({ role })).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return "aaa." + payload + ".bbb";
}

test("o papel sai do JWT e um token quebrado não passa", () => {
  assert.equal(papelDoJwt(jwt("service_role")), "service_role");
  assert.equal(papelDoJwt("sem-ponto"), "");
  assert.equal(papelDoJwt("a.???.c"), "");
});

type Linha = {
  access_token: string;
  refresh_token: string;
  expires_at: string | null;
  renovando: boolean;
};

function loja(inicial: Linha) {
  const linha = { ...inicial };
  const oauth: string[] = [];
  const alertas: string[] = [];
  const env: Record<string, string> = {
    SUPABASE_URL: "https://exemplo.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-de-teste",
    MELHOR_ENVIO_TOKEN: "segredo-antigo-com-vinte-chars",
    MELHOR_ENVIO_CLIENT_ID: "client-id",
    MELHOR_ENVIO_APP_SECRET: "app-secret",
    MELHOR_ENVIO_BASE_URL: "https://melhorenvio.com.br",
  };

  function leitura() {
    return {
      vazio: false,
      access_token: linha.access_token,
      tem_refresh: linha.refresh_token.length >= 20,
      expires_at: linha.expires_at,
      renovando: linha.renovando,
    };
  }

  const deps: DepsToken = {
    env: (nome) => env[nome],
    agora: () => AGORA,
    esperar: () => Promise.resolve(),
    alertar: async (motivo) => {
      alertas.push(motivo);
    },
    fetch: async (input, init) => {
      const url = String(input);
      if (url.endsWith("/oauth/token")) {
        oauth.push(String(init?.headers && new Headers(init.headers).get("User-Agent")));
        return Response.json({
          access_token: NOVO_ACCESS,
          refresh_token: NOVO_REFRESH,
          expires_in: 2_592_000,
        });
      }
      const nome = url.split("/").pop();
      const corpo = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      if (nome === "ler_oauth_melhor_envio") return Response.json(leitura());
      if (nome === "reivindicar_oauth_melhor_envio") {
        if (linha.renovando) return Response.json({ renovando: true, access_token: linha.access_token });
        if (!linha.refresh_token) return Response.json({ sem_refresh: true, access_token: linha.access_token });
        const fresco = linha.expires_at != null && Date.parse(linha.expires_at) - AGORA > ANTECEDENCIA_MS;
        if (corpo.p_forcar === true && fresco && linha.access_token) {
          return Response.json({ reivindicou: false, access_token: linha.access_token, renovando: false });
        }
        linha.renovando = true;
        return Response.json({
          reivindicou: true,
          refresh_token: linha.refresh_token,
          access_token: linha.access_token,
        });
      }
      if (nome === "gravar_oauth_melhor_envio") {
        if (corpo.p_refresh_usado !== linha.refresh_token && linha.refresh_token !== NOVO_REFRESH) {
          return Response.json({ ok: false });
        }
        linha.access_token = String(corpo.p_access_token);
        linha.refresh_token = String(corpo.p_refresh_token);
        linha.expires_at = String(corpo.p_expires_at);
        linha.renovando = false;
        return Response.json({ ok: true });
      }
      if (nome === "soltar_oauth_melhor_envio") {
        linha.renovando = false;
        return Response.json({ ok: true });
      }
      return new Response("nao", { status: 404 });
    },
  };

  return { deps, oauth, alertas, linha, env };
}

test("token fresco não chama o OAuth", async () => {
  const { deps, oauth } = loja({
    access_token: ACCESS,
    refresh_token: REFRESH,
    expires_at: iso(AGORA + 20 * 86_400_000),
    renovando: false,
  });
  assert.equal(await resolverToken(deps), ACCESS);
  assert.deepEqual(oauth, []);
});

test("token a vencer renova uma vez e duas chamadas juntas não renovam duas", async () => {
  const caixa = loja({
    access_token: ACCESS,
    refresh_token: REFRESH,
    expires_at: iso(AGORA + 2 * 86_400_000),
    renovando: false,
  });
  const [um, dois] = await Promise.all([
    resolverToken(caixa.deps),
    resolverToken(caixa.deps),
  ]);
  assert.equal(um, NOVO_ACCESS);
  assert.equal(dois, NOVO_ACCESS);
  assert.equal(caixa.oauth.length, 1);
  assert.equal(caixa.oauth[0], USER_AGENT_OAUTH);
  assert.equal(caixa.linha.refresh_token, NOVO_REFRESH);
  assert.deepEqual(caixa.alertas, []);
});

test("falha na renovação avisa e devolve o token antigo, ou nada se foi um 401", async () => {
  const caixa = loja({
    access_token: ACCESS,
    refresh_token: REFRESH,
    expires_at: iso(AGORA + 1000),
    renovando: false,
  });
  caixa.env.MELHOR_ENVIO_CLIENT_ID = "";
  assert.equal(await resolverToken(caixa.deps), ACCESS);
  assert.deepEqual(caixa.alertas, ["sem_credencial"]);

  caixa.alertas.length = 0;
  caixa.env.MELHOR_ENVIO_CLIENT_ID = "client-id";
  const original = caixa.deps.fetch;
  caixa.deps.fetch = async (input, init) => {
    if (String(input).endsWith("/oauth/token")) return new Response("nao", { status: 401 });
    return original(input, init);
  };
  assert.equal(await resolverToken(caixa.deps, { forcar: true }), null);
  assert.deepEqual(caixa.alertas, ["recusado"]);
});

test("validade nula só renova na manutenção, não no checkout", async () => {
  const caixa = loja({
    access_token: ACCESS,
    refresh_token: REFRESH,
    expires_at: null,
    renovando: false,
  });
  assert.equal(await resolverToken(caixa.deps), ACCESS);
  assert.deepEqual(caixa.oauth, []);
  assert.equal(await resolverToken(caixa.deps, { agendado: true }), NOVO_ACCESS);
  assert.equal(caixa.oauth.length, 1);
  assert.equal(caixa.linha.refresh_token, NOVO_REFRESH);
});

test("gravar que falha depois da rotação tenta de novo e não solta a trava", async () => {
  const caixa = loja({
    access_token: ACCESS,
    refresh_token: REFRESH,
    expires_at: iso(AGORA + 2 * 86_400_000),
    renovando: false,
  });
  let gravadas = 0;
  let soltas = 0;
  const original = caixa.deps.fetch;
  caixa.deps.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("gravar_oauth_melhor_envio")) {
      gravadas += 1;
      if (gravadas < 3) return new Response("nao", { status: 500 });
    }
    if (url.includes("soltar_oauth_melhor_envio")) soltas += 1;
    return original(input, init);
  };
  assert.equal(await resolverToken(caixa.deps), NOVO_ACCESS);
  assert.equal(gravadas, 3);
  assert.equal(soltas, 0);
  assert.deepEqual(caixa.alertas, []);
  assert.equal(caixa.linha.refresh_token, NOVO_REFRESH);
});

test("par novo que não entra na tabela pede nova autorização e não solta", async () => {
  const caixa = loja({
    access_token: ACCESS,
    refresh_token: REFRESH,
    expires_at: iso(AGORA + 2 * 86_400_000),
    renovando: false,
  });
  let gravadas = 0;
  let soltas = 0;
  const original = caixa.deps.fetch;
  caixa.deps.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("gravar_oauth_melhor_envio")) {
      gravadas += 1;
      return new Response("nao", { status: 500 });
    }
    if (url.includes("soltar_oauth_melhor_envio")) soltas += 1;
    return original(input, init);
  };
  assert.equal(await resolverToken(caixa.deps), NOVO_ACCESS);
  assert.equal(gravadas, 3);
  assert.equal(soltas, 0);
  assert.deepEqual(caixa.alertas, ["reautorizar"]);
  assert.equal(caixa.linha.refresh_token, REFRESH);
  assert.match(mensagemToken("reautorizar"), /autorizar o aplicativo de novo/);
});

test("reserva pessoal só entra quando a renovação forçada não devolve token", () => {
  const pessoal = "p".repeat(40);
  assert.equal(reservaDepoisDo401(pessoal, ACCESS, null), pessoal);
  assert.equal(reservaDepoisDo401(pessoal, ACCESS, NOVO_ACCESS), null);
  assert.equal(reservaDepoisDo401(ACCESS, ACCESS, null), null);
  assert.equal(reservaDepoisDo401("", ACCESS, null), null);
});

test("cada tentativa do Melhor Envio ganha um AbortSignal novo", () => {
  const vencido = AbortSignal.timeout(1);
  const uma = opcoesDaTentativa({ method: "POST", body: "{}", signal: vencido });
  const outra = opcoesDaTentativa({ method: "POST", body: "{}", signal: vencido });
  assert.notEqual(uma.signal, vencido);
  assert.notEqual(uma.signal, outra.signal);
  assert.equal(uma.signal?.aborted, false);
  assert.equal(outra.signal?.aborted, false);
});

test("estoque alerta só na descida abaixo de 3, e a recuperação rearma", () => {
  assert.equal(ESTOQUE_MINIMO, 3);
  assert.equal(deveAlertarEstoque("venda", 5, 2, false), "alertar");
  assert.equal(deveAlertarEstoque("venda", 2, 1, true), "nada");
  assert.equal(deveAlertarEstoque("producao", 1, 4, true), "rearmar");
  assert.equal(deveAlertarEstoque("ajuste", 4, 0, false), "alertar");
  assert.equal(deveAlertarEstoque("reserva", 6, 1, false), "nada");
  assert.equal(deveAlertarEstoque("venda", 5, 3, false), "nada");
  assert.equal(deveAlertarEstoque("ajuste", 3, 2, false), "alertar");
  assert.equal(mensagemEstoque("Acolher", 2), "Acolher está com 2 velas no estoque.");
  assert.equal(mensagemEstoque("Acolher", 1), "Acolher está com 1 vela no estoque.");
});

test("saldo e token não repetem no mesmo dia de São Paulo", () => {
  assert.equal(saldoAbaixo(5000), false);
  assert.equal(saldoAbaixo(4999), true);
  assert.equal(saldoAbaixo(-1), false);
  assert.equal(chaveDiaSp(new Date("2026-11-21T02:30:00.000Z")), "2026-11-20");
  const chave = chaveDiaSp(new Date("2026-11-21T02:30:00.000Z"));
  const ocupadas = [{ tipo: "saldo_baixo", chave }];
  assert.equal(podeRegistrarAviso(ocupadas, "saldo_baixo", chave), false);
  assert.equal(podeRegistrarAviso(ocupadas, "saldo_baixo", "2026-11-21"), true);
  assert.equal(podeRegistrarAviso(ocupadas, "token_melhor_envio", chave), true);
  assert.match(mensagemSaldo(4999), /R\$ 49,99/);
  assert.match(mensagemToken("recusado"), /recusou a renovação/);
});

test("problema de entrega ignora o caminho feliz e diferencia a situação", () => {
  assert.equal(problemaEntrega("order.posted", "posted"), null);
  assert.equal(problemaEntrega("order.pending", "pending"), null);
  assert.equal(problemaEntrega("order.delivered", "delivered"), null);
  assert.equal(problemaEntrega("order.cancelled", "released")?.situacao, "cancelada");
  assert.equal(problemaEntrega("order.updated", "undelivered")?.situacao, "nao_entregue");
  assert.equal(problemaEntrega("order.paused", "")?.situacao, "pausada");
  assert.equal(problemaEntrega("order.suspended", "")?.situacao, "suspensa");
  assert.equal(problemaEntrega("order.returned", "")?.situacao, "devolucao");
  assert.equal(chaveProblema("ord-1", "cancelada"), "ord-1:cancelada");
  assert.equal(
    podeRegistrarAviso([{ tipo: "problema_entrega", chave: "ord-1:cancelada" }], "problema_entrega", "ord-1:cancelada"),
    false,
  );
  assert.equal(
    podeRegistrarAviso([{ tipo: "problema_entrega", chave: "ord-1:cancelada" }], "problema_entrega", "ord-1:devolucao"),
    true,
  );
  const problema = problemaEntrega("order.undelivered", "")!;
  assert.match(mensagemProblema(problema, "261120001", ""), /pedido #261120001/);
  const corpo = corpoWebhookAviso({
    tipo: "problema_entrega",
    mensagem: mensagemProblema(problema, "261120001", ""),
    quando: "2026-11-20T15:00:00.000Z",
    detalhe: { situacao: "não entregue", pedido: "261120001" },
  });
  assert.equal(corpo.tipo, "problema_entrega");
  assert.equal(corpo.pedido, "261120001");
});
