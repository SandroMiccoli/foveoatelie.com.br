// Cria o pedido, reserva o estoque por 30 minutos e abre o Checkout Pro
// pela Orders API (POST /v1/orders). Não usa a Preferences API.
// O total é recalculado no banco. O frete é recotado aqui. Deploy: README.md.

import { credenciaisSupabase, cotarItens, type OpcaoFrete } from "../_shared/frete.ts";
import { json, origemDoPedido, origemPermitida, cabecalhosCors } from "../_shared/http.ts";
import {
  centavosParaReais,
  checkoutUrlConfiavel,
  itensPagamento,
  partirNome,
  somaItensCentavos,
  telefoneMp,
} from "../_shared/pedido.ts";

const LIMITE_CORPO = 16000;
const LIMITE_ITENS = 20;
const LIMITE_QTD = 99;
const UFS = new Set([
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS",
  "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC",
  "SP", "SE", "TO",
]);

type ItemCliente = { produto_id: string; qtd: number };

type PedidoValidado = {
  idempotency_key: string;
  cliente_nome: string;
  cliente_email: string;
  cliente_telefone: string;
  entrega_tipo: "envio" | "retirada";
  frete_id: string;
  cep: string;
  endereco: Record<string, string> | null;
};

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cabecalhosCors(origin) });
  }
  if (origin && !origemPermitida(origin)) return json(origin, 403, { erro: "origem" });
  if (req.method !== "POST") return json(origin, 405, { erro: "metodo" });

  const cred = credenciaisSupabase();
  const tokenMp = (Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN") ?? "").trim();
  if (!cred || !tokenMp) {
    console.error("criar-pedido: credencial ausente");
    return json(origin, 503, { erro: "pagamento_indisponivel" });
  }

  let bruto = "";
  try {
    bruto = await req.text();
  } catch (_err) {
    return json(origin, 400, { erro: "pedido_invalido" });
  }
  if (bruto.length > LIMITE_CORPO) return json(origin, 400, { erro: "pedido_invalido" });

  let corpo: unknown;
  try {
    corpo = JSON.parse(bruto);
  } catch (_err) {
    return json(origin, 400, { erro: "pedido_invalido" });
  }

  const pedido = lerPedido(corpo);
  if (!pedido) return json(origin, 400, { erro: "pedido_invalido" });

  const itens = lerItens(corpo);
  if (!itens) return json(origin, 400, { erro: "pedido_invalido" });

  let frete: OpcaoFrete;
  if (pedido.entrega_tipo === "retirada") {
    frete = {
      id: "retirada",
      transportadora: "",
      servico: "Retirar em BH (combinar)",
      preco_centavos: 0,
      prazo_dias: null,
    };
  } else {
    const cotacao = await cotarItens(pedido.cep, itens);
    if (!cotacao.ok) {
      const status = cotacao.erro === "pedido_invalido" ? 400 : 503;
      return json(origin, status, { erro: cotacao.erro });
    }
    const achou = cotacao.opcoes.find((opcao) => opcao.id === pedido.frete_id);
    if (!achou) return json(origin, 409, { erro: "frete_opcao" });
    frete = achou;
  }

  const reservado = await rpc(cred, "reservar_pedido", {
    payload: {
      idempotency_key: pedido.idempotency_key,
      cliente_nome: pedido.cliente_nome,
      cliente_email: pedido.cliente_email,
      cliente_telefone: pedido.cliente_telefone,
      entrega_tipo: pedido.entrega_tipo,
      endereco: pedido.endereco,
      itens: itens.map((item) => ({ produto_id: item.produto_id, qtd: item.qtd })),
      frete: {
        id: frete.id,
        transportadora: frete.transportadora,
        servico: frete.servico,
        preco_centavos: frete.preco_centavos,
        prazo_dias: frete.prazo_dias,
      },
    },
  });

  if (!reservado) return json(origin, 503, { erro: "pagamento_indisponivel" });
  if (reservado.ok !== true) {
    const erro = typeof reservado.erro === "string" ? reservado.erro : "pedido_invalido";
    const status = erro === "estoque" || erro === "idempotencia" ? 409 : 400;
    return json(origin, status, { erro });
  }

  const pedidoId = typeof reservado.id === "string" ? reservado.id : "";
  const total = typeof reservado.total_centavos === "number" ? reservado.total_centavos : -1;
  const freteCentavos = typeof reservado.frete_centavos === "number" ? reservado.frete_centavos : -1;
  if (!pedidoId || total < 0 || freteCentavos < 0) {
    return json(origin, 503, { erro: "pagamento_indisponivel" });
  }

  const checkoutSalvo = typeof reservado.mp_checkout_url === "string" ? reservado.mp_checkout_url : "";
  const orderSalva = typeof reservado.mp_order_id === "string" ? reservado.mp_order_id : "";
  if (checkoutSalvo && checkoutUrlConfiavel(checkoutSalvo, orderSalva)) {
    return json(origin, 200, { checkout_url: checkoutSalvo, pedido_id: pedidoId });
  }

  const linhas = lerLinhasReservadas(reservado.itens);
  if (!linhas) {
    await rpc(cred, "liberar_pedido", { p_pedido_id: pedidoId });
    return json(origin, 503, { erro: "pagamento_indisponivel" });
  }

  const produtoCentavos = total - freteCentavos;
  const tituloFrete = frete.transportadora
    ? `Frete ${frete.transportadora} ${frete.servico}`.replace(/\s+/g, " ").trim()
    : `Frete ${frete.servico}`;
  const items = itensPagamento(
    linhas,
    produtoCentavos,
    freteCentavos > 0 ? { titulo: tituloFrete, centavos: freteCentavos } : null,
  );
  if (somaItensCentavos(items) !== total) {
    console.error("criar-pedido: soma dos itens não fecha com o total");
    await rpc(cred, "liberar_pedido", { p_pedido_id: pedidoId });
    return json(origin, 503, { erro: "pagamento_indisponivel" });
  }

  const site = origemDoPedido(origin);
  const nome = partirNome(pedido.cliente_nome);
  const fone = telefoneMp(pedido.cliente_telefone);
  const payer: Record<string, unknown> = { email: pedido.cliente_email, first_name: nome.first_name };
  if (nome.last_name) payer.last_name = nome.last_name;
  if (fone) payer.phone = fone;
  if (pedido.endereco) {
    payer.address = {
      zip_code: pedido.endereco.cep,
      street_name: pedido.endereco.logradouro,
      street_number: pedido.endereco.numero,
      neighborhood: pedido.endereco.bairro,
      city: pedido.endereco.cidade,
      state: pedido.endereco.uf,
    };
  }

  const consulta = `pedido=${encodeURIComponent(pedidoId)}`;
  const orderBody = {
    type: "online",
    processing_mode: "manual",
    total_amount: centavosParaReais(total),
    external_reference: pedidoId,
    description: "Velas de massagem Foveō",
    expiration_time: "PT30M",
    payer,
    items,
    config: {
      statement_descriptor: "FOVEO",
      online: {
        success_url: `${site}/pedido/confirmado/?${consulta}`,
        failure_url: `${site}/pedido/recusado/?${consulta}`,
        pending_url: `${site}/pedido/pendente/?${consulta}`,
        auto_return: "all",
        callback_url: `${cred.url}/functions/v1/webhook-mercado-pago`,
      },
    },
  };

  const criado = await criarOrder(tokenMp, pedido.idempotency_key, orderBody);
  if (!criado.ok) {
    if (!criado.repetir) await rpc(cred, "liberar_pedido", { p_pedido_id: pedidoId });
    return json(origin, 502, { erro: "pagamento_indisponivel", repetir: criado.repetir });
  }

  const gravou = await rpc(cred, "registrar_order_mp", {
    p_pedido_id: pedidoId,
    p_mp_order_id: criado.id,
    p_checkout_url: criado.checkoutUrl,
  });
  if (!gravou || gravou.ok !== true) {
    console.error("criar-pedido: order criada e o id não foi gravado", criado.id);
  }

  return json(origin, 200, { checkout_url: criado.checkoutUrl, pedido_id: pedidoId });
});

function lerPedido(corpo: unknown): PedidoValidado | null {
  if (!corpo || typeof corpo !== "object") return null;
  const dados = corpo as Record<string, unknown>;
  const chave = dados.idempotency_key;
  if (typeof chave !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chave)) {
    return null;
  }

  const comprador = dados.comprador;
  if (!comprador || typeof comprador !== "object") return null;
  const c = comprador as Record<string, unknown>;
  const nome = limparTexto(c.nome, 120);
  const email = limparTexto(c.email, 120).toLowerCase();
  const telefone = String(c.telefone ?? "").replace(/\D/g, "");
  if (nome.length < 2 || !/[A-Za-zÀ-ÿ]/.test(nome)) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const fone = telefone.startsWith("55") && telefone.length > 11 ? telefone.slice(2) : telefone;
  if (!/^\d{10,11}$/.test(fone)) return null;

  const entrega = dados.entrega;
  if (!entrega || typeof entrega !== "object") return null;
  const e = entrega as Record<string, unknown>;
  if (e.tipo === "retirada") {
    return {
      idempotency_key: chave.toLowerCase(),
      cliente_nome: nome,
      cliente_email: email,
      cliente_telefone: fone,
      entrega_tipo: "retirada",
      frete_id: "retirada",
      cep: "",
      endereco: null,
    };
  }
  if (e.tipo !== "envio") return null;

  const freteId = typeof e.frete_id === "string" ? e.frete_id.trim() : "";
  if (!freteId || freteId === "retirada" || freteId.length > 40) return null;
  const cep = String(e.cep ?? "").replace(/\D/g, "");
  if (!/^\d{8}$/.test(cep) || cep === "00000000") return null;

  const end = e.endereco;
  if (!end || typeof end !== "object") return null;
  const a = end as Record<string, unknown>;
  const logradouro = limparTexto(a.logradouro, 120);
  const numero = limparTexto(a.numero, 20);
  const complemento = limparTexto(a.complemento, 80);
  const bairro = limparTexto(a.bairro, 80);
  const cidade = limparTexto(a.cidade, 80);
  const uf = limparTexto(a.uf, 2).toUpperCase();
  if (logradouro.length < 2 || numero.length < 1 || bairro.length < 1 || cidade.length < 2) return null;
  if (!UFS.has(uf)) return null;

  const endereco: Record<string, string> = { cep, logradouro, numero, bairro, cidade, uf };
  if (complemento) endereco.complemento = complemento;

  return {
    idempotency_key: chave.toLowerCase(),
    cliente_nome: nome,
    cliente_email: email,
    cliente_telefone: fone,
    entrega_tipo: "envio",
    frete_id: freteId,
    cep,
    endereco,
  };
}

function lerItens(corpo: unknown): ItemCliente[] | null {
  if (!corpo || typeof corpo !== "object") return null;
  const lista = (corpo as { itens?: unknown }).itens;
  if (!Array.isArray(lista) || lista.length < 1 || lista.length > LIMITE_ITENS) return null;
  const mapa = new Map<string, number>();
  for (const bruto of lista) {
    if (!bruto || typeof bruto !== "object") return null;
    const item = bruto as Record<string, unknown>;
    const id = item.produto_id;
    const qtd = item.qtd;
    if (typeof id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) return null;
    if (typeof qtd !== "number" || !Number.isInteger(qtd) || qtd < 1 || qtd > LIMITE_QTD) return null;
    mapa.set(id, (mapa.get(id) ?? 0) + qtd);
  }
  const itens: ItemCliente[] = [];
  let total = 0;
  for (const [produto_id, qtd] of mapa) {
    if (qtd > LIMITE_QTD) return null;
    total += qtd;
    itens.push({ produto_id, qtd });
  }
  if (total < 1 || total > LIMITE_QTD) return null;
  return itens;
}

function lerLinhasReservadas(bruto: unknown): { nome: string; qtd: number }[] | null {
  if (!Array.isArray(bruto) || bruto.length < 1) return null;
  const linhas: { nome: string; qtd: number }[] = [];
  for (const item of bruto) {
    if (!item || typeof item !== "object") return null;
    const row = item as Record<string, unknown>;
    const nome = typeof row.nome === "string" ? row.nome.trim() : "";
    const qtd = row.qtd;
    if (!nome || typeof qtd !== "number" || !Number.isInteger(qtd) || qtd < 1) return null;
    linhas.push({ nome, qtd });
  }
  return linhas;
}

function limparTexto(valor: unknown, max: number): string {
  if (typeof valor !== "string") return "";
  return valor.replace(/[\u0000-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

async function rpc(
  cred: { url: string; key: string },
  nome: string,
  corpo: unknown,
): Promise<Record<string, unknown> | null> {
  let res: Response;
  try {
    res = await fetch(`${cred.url}/rest/v1/rpc/${nome}`, {
      method: "POST",
      headers: {
        apikey: cred.key,
        Authorization: `Bearer ${cred.key}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    console.error("criar-pedido: rpc", nome, err instanceof Error ? err.message : err);
    return null;
  }
  if (!res.ok) {
    console.error("criar-pedido: rpc", nome, res.status);
    return null;
  }
  try {
    const data = await res.json();
    return data && typeof data === "object" ? data as Record<string, unknown> : null;
  } catch (_err) {
    return null;
  }
}

async function criarOrder(
  token: string,
  idempotencyKey: string,
  corpo: unknown,
): Promise<{ ok: true; id: string; checkoutUrl: string } | { ok: false; repetir: boolean }> {
  let res: Response;
  try {
    res = await fetch("https://api.mercadopago.com/v1/orders", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(12000),
    });
  } catch (err) {
    console.error("criar-pedido: Mercado Pago sem resposta", err instanceof Error ? err.message : err);
    return { ok: false, repetir: true };
  }

  let data: unknown = null;
  try {
    data = await res.json();
  } catch (_err) {
    data = null;
  }

  if (!res.ok) {
    console.error("criar-pedido: Mercado Pago", res.status, codigoErro(data));
    const repetir = res.status === 409 || res.status === 423 || res.status >= 500;
    return { ok: false, repetir };
  }

  if (!data || typeof data !== "object") return { ok: false, repetir: true };
  const row = data as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id : "";
  const checkoutUrl = typeof row.checkout_url === "string" ? row.checkout_url : "";
  const referencia = typeof row.external_reference === "string" ? row.external_reference : "";
  const corpoRef = (corpo as { external_reference?: string }).external_reference;
  if (!id || !checkoutUrl || referencia !== corpoRef || !checkoutUrlConfiavel(checkoutUrl, id)) {
    console.error("criar-pedido: resposta da order sem checkout utilizável");
    return { ok: false, repetir: false };
  }
  if (row.type !== "online" || row.processing_mode !== "manual") {
    console.error("criar-pedido: order fora do Checkout Pro");
    return { ok: false, repetir: false };
  }
  return { ok: true, id, checkoutUrl };
}

function codigoErro(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const erros = (data as { errors?: unknown }).errors;
  if (!Array.isArray(erros)) {
    const message = (data as { message?: unknown }).message;
    return typeof message === "string" ? message.slice(0, 160) : "";
  }
  return erros
    .map((erro) => erro && typeof erro === "object" ? String((erro as { code?: unknown }).code ?? "") : "")
    .filter(Boolean)
    .join(",")
    .slice(0, 180);
}
