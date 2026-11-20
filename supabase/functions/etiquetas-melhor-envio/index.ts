// Etiquetas do Melhor Envio, chamadas pelo painel.
// JWT do admin. Carrinho e checkout só rodam depois da confirmação na tela.
// O saldo é lido antes; se não cobre, a função não compra.

import { jsonPainel, origemPainel, conferirAdminPainel } from "../_shared/painel.ts";
import {
  USER_AGENT,
  classificarPedido,
  fecharResumo,
  lerCarrinho,
  lerRastreioGerado,
  lerRemetente,
  lerUrlImpressao,
  montarCarrinho,
  planoFolha,
  planoImpressao,
  saldoCentavos,
  type PedidoEtiqueta,
} from "../_shared/etiquetas.ts";
import { baseUrlMelhorEnvio } from "../_shared/frete.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMITE = 40;

const MOTIVO: Record<string, string> = {
  teste: "Pedido de teste não entra na etiqueta.",
  retirada: "Retirada não tem etiqueta.",
  status: "Só pedido pago, ainda sem etiqueta.",
  sem_frete: "Sem o serviço de frete escolhido no checkout.",
  sem_cpf: "Falta o CPF.",
  sem_telefone: "Falta um telefone válido.",
  sem_destino: "Falta o nome ou o e-mail.",
  sem_endereco: "O endereço está incompleto.",
  sem_itens: "O pedido não tem velas.",
};

Deno.serve(async (req) => {
  const origin = origemPainel(req.headers.get("Origin"));
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cabecalhos(origin) });
  }
  if (req.method !== "POST") return jsonPainel(origin, 405, { ok: false, erro: "metodo" });

  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  const anonKey = (Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "").trim();
  const tokenMe = (Deno.env.get("MELHOR_ENVIO_TOKEN") ?? "").trim();
  const base = baseUrlMelhorEnvio();
  if (!supabaseUrl || !anonKey || !tokenMe || !base) {
    console.error("etiquetas: credencial ausente");
    return jsonPainel(origin, 503, { ok: false, erro: "indisponivel", mensagem: "Melhor Envio ainda não está configurado." });
  }

  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!jwt) return jsonPainel(origin, 401, { ok: false, erro: "sessao" });

  const admin = await conferirAdminPainel(supabaseUrl, anonKey, jwt);
  if (admin === "rede") return jsonPainel(origin, 503, { ok: false, erro: "indisponivel" });
  if (!admin) return jsonPainel(origin, 403, { ok: false, erro: "nao_autorizado" });

  let corpo: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object") throw new Error("corpo");
    corpo = parsed as Record<string, unknown>;
  } catch (_err) {
    return jsonPainel(origin, 400, { ok: false, erro: "pedido_invalido" });
  }

  const acao = typeof corpo.acao === "string" ? corpo.acao : "";
  const ids = lerIds(corpo.pedido_ids);
  if (ids === "invalido") return jsonPainel(origin, 400, { ok: false, erro: "pedido_invalido" });

  const remetente = lerRemetente({
    MELHOR_ENVIO_FROM_NAME: Deno.env.get("MELHOR_ENVIO_FROM_NAME"),
    MELHOR_ENVIO_FROM_EMAIL: Deno.env.get("MELHOR_ENVIO_FROM_EMAIL"),
    MELHOR_ENVIO_FROM_PHONE: Deno.env.get("MELHOR_ENVIO_FROM_PHONE"),
    MELHOR_ENVIO_FROM_DOCUMENT: Deno.env.get("MELHOR_ENVIO_FROM_DOCUMENT"),
    MELHOR_ENVIO_FROM_COMPANY_DOCUMENT: Deno.env.get("MELHOR_ENVIO_FROM_COMPANY_DOCUMENT"),
    MELHOR_ENVIO_FROM_ADDRESS: Deno.env.get("MELHOR_ENVIO_FROM_ADDRESS"),
    MELHOR_ENVIO_FROM_NUMBER: Deno.env.get("MELHOR_ENVIO_FROM_NUMBER"),
    MELHOR_ENVIO_FROM_COMPLEMENT: Deno.env.get("MELHOR_ENVIO_FROM_COMPLEMENT"),
    MELHOR_ENVIO_FROM_DISTRICT: Deno.env.get("MELHOR_ENVIO_FROM_DISTRICT"),
    MELHOR_ENVIO_FROM_CITY: Deno.env.get("MELHOR_ENVIO_FROM_CITY"),
    MELHOR_ENVIO_FROM_STATE: Deno.env.get("MELHOR_ENVIO_FROM_STATE"),
    MELHOR_ENVIO_FROM_POSTAL_CODE: Deno.env.get("MELHOR_ENVIO_FROM_POSTAL_CODE"),
    MELHOR_ENVIO_AGENCY_ID: Deno.env.get("MELHOR_ENVIO_AGENCY_ID"),
  });

  if (acao === "resumo") {
    return resumo(origin, supabaseUrl, anonKey, jwt, tokenMe, base, ids, remetente != null);
  }
  if (acao === "comprar") {
    if (!remetente) {
      return jsonPainel(origin, 503, {
        ok: false,
        erro: "remetente",
        mensagem: "Faltam os dados do remetente nos secrets do Melhor Envio.",
      });
    }
    return comprar(origin, supabaseUrl, anonKey, jwt, tokenMe, base, ids, remetente);
  }
  if (acao === "imprimir") {
    const formato = corpo.formato === "termica" ? "termica" : corpo.formato === "a4" ? "a4" : "";
    if (!formato) return jsonPainel(origin, 400, { ok: false, erro: "formato", mensagem: "Escolha A4 ou térmica." });
    return imprimir(origin, supabaseUrl, anonKey, jwt, tokenMe, base, ids, formato);
  }
  return jsonPainel(origin, 400, { ok: false, erro: "acao" });
});

function cabecalhos(origin: string | null): Headers {
  const headers = new Headers({
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Max-Age": "86400",
  });
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

function lerIds(bruto: unknown): string[] | null | "invalido" {
  if (bruto == null) return null;
  if (!Array.isArray(bruto) || bruto.length > LIMITE) return "invalido";
  const ids: string[] = [];
  for (const item of bruto) {
    if (typeof item !== "string" || !UUID.test(item)) return "invalido";
    ids.push(item.toLowerCase());
  }
  return ids;
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function numero(valor: unknown): number | null {
  if (typeof valor === "number" && Number.isFinite(valor)) return Math.round(valor);
  if (typeof valor === "string" && /^-?\d+$/.test(valor)) return Number(valor);
  return null;
}

function pedidoDe(row: Record<string, unknown>): PedidoEtiqueta | null {
  const id = texto(row.id).toLowerCase();
  if (!UUID.test(id)) return null;
  const enderecoBruto = row.endereco && typeof row.endereco === "object" ? row.endereco as Record<string, unknown> : null;
  const freteBruto = row.frete && typeof row.frete === "object" ? row.frete as Record<string, unknown> : null;
  const itensBrutos = Array.isArray(row.itens) ? row.itens : [];
  return {
    id,
    codigo: texto(row.codigo),
    teste: row.teste === true,
    status: texto(row.status),
    entrega_tipo: row.entrega_tipo === "retirada" ? "retirada" : "envio",
    cliente_nome: texto(row.cliente_nome),
    cliente_email: texto(row.cliente_email).toLowerCase(),
    cliente_telefone: texto(row.cliente_telefone),
    cliente_cpf: texto(row.cliente_cpf),
    endereco: enderecoBruto
      ? {
        logradouro: texto(enderecoBruto.logradouro),
        numero: texto(enderecoBruto.numero),
        complemento: texto(enderecoBruto.complemento),
        bairro: texto(enderecoBruto.bairro),
        cidade: texto(enderecoBruto.cidade),
        uf: texto(enderecoBruto.uf),
        cep: texto(enderecoBruto.cep),
      }
      : null,
    itens: itensBrutos.map((item) => {
      if (!item || typeof item !== "object") return null;
      const linha = item as Record<string, unknown>;
      const qtd = numero(linha.qtd);
      return {
        nome: texto(linha.nome) || texto(linha.produto_id) || "Vela",
        qtd: qtd != null && qtd > 0 ? qtd : 0,
        preco_unitario_centavos: numero(linha.preco_unitario_centavos),
      };
    }).filter((item): item is PedidoEtiqueta["itens"][number] => item != null && item.qtd > 0),
    subtotal_centavos: numero(row.subtotal_centavos),
    frete_centavos: numero(row.frete_centavos),
    frete: freteBruto
      ? { id: texto(freteBruto.id), transportadora: texto(freteBruto.transportadora), servico: texto(freteBruto.servico) }
      : null,
    me_order_id: texto(row.me_order_id),
    rastreio: texto(row.rastreio),
  };
}

async function listarPedidos(
  url: string,
  anonKey: string,
  jwt: string,
  ids: string[] | null,
  recorte: "pagos" | "impressao",
): Promise<PedidoEtiqueta[] | "rede"> {
  const campos = [
    "id",
    "codigo",
    "teste",
    "status",
    "entrega_tipo",
    "cliente_nome",
    "cliente_email",
    "cliente_telefone",
    "cliente_cpf",
    "endereco",
    "itens",
    "subtotal_centavos",
    "frete_centavos",
    "frete",
    "me_order_id",
    "rastreio",
  ].join(",");
  const filtro = ids && ids.length
    ? "&id=in.(" + ids.join(",") + ")"
    : recorte === "impressao"
    ? "&entrega_tipo=eq.envio&me_order_id=not.is.null&status=in.(pago,etiqueta_gerada,enviado,entregue)"
    : "&entrega_tipo=eq.envio&status=eq.pago&teste=eq.false";
  let res: Response;
  try {
    res = await fetch(`${url}/rest/v1/pedidos?select=${campos}${filtro}&order=created_at.asc&limit=${LIMITE}`, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${jwt}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(12000),
    });
  } catch (_err) {
    return "rede";
  }
  if (!res.ok) return "rede";
  try {
    const data = await res.json();
    if (!Array.isArray(data)) return "rede";
    return data.map((row) => pedidoDe(row as Record<string, unknown>)).filter((p): p is PedidoEtiqueta => p != null);
  } catch (_err) {
    return "rede";
  }
}

async function meFetch(base: string, token: string, caminho: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("Authorization", "Bearer " + token);
  headers.set("User-Agent", USER_AGENT);
  if (init.body) headers.set("Content-Type", "application/json");
  return await fetch(base + caminho, { ...init, headers, signal: AbortSignal.timeout(20000) });
}

async function lerSaldo(base: string, token: string): Promise<number | null> {
  try {
    const res = await meFetch(base, token, "/api/v2/me/balance", { method: "GET" });
    if (!res.ok) return null;
    return saldoCentavos(await res.json());
  } catch (_err) {
    return null;
  }
}

async function resumo(
  origin: string | null,
  url: string,
  anonKey: string,
  jwt: string,
  token: string,
  base: string,
  ids: string[] | null,
  remetenteOk: boolean,
): Promise<Response> {
  const pedidos = await listarPedidos(url, anonKey, jwt, ids, "pagos");
  if (pedidos === "rede") {
    return jsonPainel(origin, 503, { ok: false, erro: "indisponivel", mensagem: "Não consegui ler os pedidos." });
  }
  const comprar: { id: string; codigo: string; custo_centavos: number }[] = [];
  const gerar: { id: string; codigo: string }[] = [];
  const fora: { codigo: string; motivo: string }[] = [];
  for (const pedido of pedidos) {
    const classe = classificarPedido(pedido);
    if (classe.tipo === "comprar") {
      comprar.push({ id: pedido.id, codigo: pedido.codigo, custo_centavos: classe.custo_centavos });
    } else if (classe.tipo === "gerar") {
      gerar.push({ id: pedido.id, codigo: pedido.codigo });
    } else if (
      classe.tipo === "fora" &&
      ((ids && ids.includes(pedido.id)) || (!ids && pedido.status === "pago"))
    ) {
      fora.push({ codigo: pedido.codigo || pedido.id.slice(0, 8), motivo: MOTIVO[classe.motivo] || classe.motivo });
    }
  }
  const saldo = await lerSaldo(base, token);
  if (saldo == null) {
    return jsonPainel(origin, 503, {
      ok: false,
      erro: "saldo",
      mensagem: "Não consegui ler o saldo do Melhor Envio.",
    });
  }
  const contas = fecharResumo(comprar.map((item) => item.custo_centavos), saldo);
  const pode = contas.pode_comprar || (comprar.length === 0 && gerar.length > 0);
  return jsonPainel(origin, 200, {
    ok: true,
    remetente_ok: remetenteOk,
    quantidade: comprar.length,
    gerar: gerar.length,
    total_centavos: contas.total_centavos,
    saldo_centavos: contas.saldo_centavos,
    falta_centavos: contas.falta_centavos,
    pode_comprar: pode && remetenteOk && contas.falta_centavos === 0,
    pedidos: comprar,
    ja_pagas: gerar,
    fora,
  });
}

async function rpcEtiqueta(
  url: string,
  anonKey: string,
  jwt: string,
  pedidoId: string,
  campos: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  let res: Response;
  try {
    res = await fetch(`${url}/rest/v1/rpc/admin_registrar_etiqueta`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${jwt}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_pedido_id: pedidoId,
        p_me_order_id: campos.me_order_id ?? null,
        p_protocolo: campos.protocolo ?? null,
        p_rastreio: campos.rastreio ?? null,
        p_me_status: campos.me_status ?? null,
        p_preco_centavos: campos.preco_centavos ?? null,
      }),
      signal: AbortSignal.timeout(12000),
    });
  } catch (_err) {
    return null;
  }
  try {
    const data = await res.json();
    return data && typeof data === "object" ? data as Record<string, unknown> : null;
  } catch (_err) {
    return null;
  }
}

async function apagarCarrinho(base: string, token: string, ids: string[]): Promise<void> {
  for (const id of ids) {
    try {
      await meFetch(base, token, "/api/v2/me/cart/" + encodeURIComponent(id), { method: "DELETE" });
    } catch (_err) {
      console.error("etiquetas: não saiu do carrinho");
    }
  }
}

async function comprar(
  origin: string | null,
  url: string,
  anonKey: string,
  jwt: string,
  token: string,
  base: string,
  ids: string[] | null,
  remetente: NonNullable<ReturnType<typeof lerRemetente>>,
): Promise<Response> {
  const pedidos = await listarPedidos(url, anonKey, jwt, ids, "pagos");
  if (pedidos === "rede") {
    return jsonPainel(origin, 503, { ok: false, erro: "indisponivel", mensagem: "Não consegui ler os pedidos." });
  }
  const novos: { pedido: PedidoEtiqueta; custo: number }[] = [];
  const gerar: PedidoEtiqueta[] = [];
  const fora: { codigo: string; motivo: string }[] = [];
  for (const pedido of pedidos) {
    const classe = classificarPedido(pedido);
    if (classe.tipo === "comprar") novos.push({ pedido, custo: classe.custo_centavos });
    else if (classe.tipo === "gerar") gerar.push(pedido);
    else if (classe.tipo === "fora" && (ids == null || ids.includes(pedido.id))) {
      fora.push({ codigo: pedido.codigo || pedido.id.slice(0, 8), motivo: MOTIVO[classe.motivo] || classe.motivo });
    }
  }
  if (!novos.length && !gerar.length) {
    return jsonPainel(origin, 409, {
      ok: false,
      erro: "vazio",
      mensagem: "Nenhum pedido pago de envio está sem etiqueta.",
      fora,
    });
  }

  const saldo = await lerSaldo(base, token);
  if (saldo == null) {
    return jsonPainel(origin, 503, { ok: false, erro: "saldo", mensagem: "Não consegui ler o saldo do Melhor Envio." });
  }
  const contas = fecharResumo(novos.map((item) => item.custo), saldo);
  if (novos.length && !contas.pode_comprar) {
    return jsonPainel(origin, 409, {
      ok: false,
      erro: "saldo_insuficiente",
      mensagem: "Falta saldo no Melhor Envio. Não comprei nada.",
      falta_centavos: contas.falta_centavos,
      saldo_centavos: contas.saldo_centavos,
      total_centavos: contas.total_centavos,
    });
  }

  const carrinho: { pedido: PedidoEtiqueta; meId: string; protocolo: string; preco: number | null }[] = [];
  for (const item of novos) {
    const corpo = montarCarrinho(item.pedido, remetente);
    if (!corpo) {
      await apagarCarrinho(base, token, carrinho.map((c) => c.meId));
      return jsonPainel(origin, 409, { ok: false, erro: "carrinho", mensagem: "Não montei a etiqueta de " + (item.pedido.codigo || "um pedido") + "." });
    }
    let res: Response;
    try {
      res = await meFetch(base, token, "/api/v2/me/cart", { method: "POST", body: JSON.stringify(corpo) });
    } catch (_err) {
      await apagarCarrinho(base, token, carrinho.map((c) => c.meId));
      return jsonPainel(origin, 502, { ok: false, erro: "me_rede", mensagem: "O Melhor Envio não respondeu. Nada foi comprado." });
    }
    if (!res.ok) {
      await apagarCarrinho(base, token, carrinho.map((c) => c.meId));
      console.error("etiquetas: carrinho", res.status);
      return jsonPainel(origin, 502, { ok: false, erro: "carrinho", mensagem: "O Melhor Envio recusou o carrinho. Nada foi comprado." });
    }
    const lido = lerCarrinho(await res.json().catch(() => null));
    if (!lido) {
      await apagarCarrinho(base, token, carrinho.map((c) => c.meId));
      return jsonPainel(origin, 502, { ok: false, erro: "carrinho", mensagem: "A resposta do carrinho veio sem id. Nada foi comprado." });
    }
    carrinho.push({ pedido: item.pedido, meId: lido.id, protocolo: lido.protocolo, preco: lido.preco_centavos });
  }

  if (carrinho.length) {
    let checkout: Response;
    try {
      checkout = await meFetch(base, token, "/api/v2/me/shipment/checkout", {
        method: "POST",
        body: JSON.stringify({ orders: carrinho.map((c) => c.meId) }),
      });
    } catch (_err) {
      await apagarCarrinho(base, token, carrinho.map((c) => c.meId));
      return jsonPainel(origin, 502, { ok: false, erro: "me_rede", mensagem: "O checkout não respondeu. Tirei as etiquetas do carrinho." });
    }
    if (!checkout.ok) {
      await apagarCarrinho(base, token, carrinho.map((c) => c.meId));
      console.error("etiquetas: checkout", checkout.status);
      return jsonPainel(origin, 502, { ok: false, erro: "checkout", mensagem: "O Melhor Envio não comprou. Nada foi gravado." });
    }
    for (const item of carrinho) {
      const gravado = await rpcEtiqueta(url, anonKey, jwt, item.pedido.id, {
        me_order_id: item.meId,
        protocolo: item.protocolo,
        me_status: "released",
        preco_centavos: item.preco ?? item.pedido.frete_centavos,
      });
      if (!gravado || gravado.ok !== true) {
        console.error("etiquetas: pago e não gravou", item.pedido.id);
      }
    }
  }

  const paraGerar = [
    ...carrinho.map((item) => ({ pedido: item.pedido, meId: item.meId })),
    ...gerar.map((pedido) => ({ pedido, meId: pedido.me_order_id })),
  ];
  let geracao: unknown = null;
  try {
    const res = await meFetch(base, token, "/api/v2/me/shipment/generate", {
      method: "POST",
      body: JSON.stringify({ orders: paraGerar.map((item) => item.meId) }),
    });
    if (res.ok) geracao = await res.json();
    else console.error("etiquetas: gerar", res.status);
  } catch (err) {
    console.error("etiquetas: gerar", err instanceof Error ? err.name : "erro");
  }

  const rastros = lerRastreioGerado(geracao, paraGerar.map((item) => item.meId));
  const faltam = paraGerar.map((item) => item.meId).filter((id) => !rastros.has(id));
  if (faltam.length) {
    try {
      const res = await meFetch(base, token, "/api/v2/me/shipment/tracking", {
        method: "POST",
        body: JSON.stringify({ orders: faltam }),
      });
      if (res.ok) {
        const extra = lerRastreioGerado(await res.json(), faltam);
        for (const [id, code] of extra) rastros.set(id, code);
      }
    } catch (_err) {
      // O rastreio pode chegar no webhook.
    }
  }

  const geradas: { id: string; codigo: string; me_order_id: string; rastreio: string; status: string }[] = [];
  const falhas: { codigo: string; motivo: string }[] = [];
  for (const item of paraGerar) {
    const rastreio = rastros.get(item.meId) ?? "";
    const gravado = await rpcEtiqueta(url, anonKey, jwt, item.pedido.id, {
      me_order_id: item.meId,
      rastreio: rastreio || null,
      me_status: rastreio ? "generated" : "released",
    });
    if (!gravado || gravado.ok !== true) {
      falhas.push({ codigo: item.pedido.codigo, motivo: "Comprei, mas o painel não gravou a etiqueta." });
      continue;
    }
    geradas.push({
      id: item.pedido.id,
      codigo: item.pedido.codigo,
      me_order_id: item.meId,
      rastreio,
      status: typeof gravado.status === "string" ? gravado.status : item.pedido.status,
    });
  }

  return jsonPainel(origin, 200, {
    ok: falhas.length === 0,
    geradas,
    falhas,
    fora,
    imprimir_ids: geradas.map((item) => item.me_order_id),
    mensagem: falhas.length
      ? "Parte das etiquetas ficou sem gravar. Não compre de novo: tente gerar outra vez."
      : geradas.every((item) => item.rastreio)
      ? "Etiquetas geradas."
      : "Etiquetas compradas. O rastreio ainda não voltou.",
  });
}

async function imprimir(
  origin: string | null,
  url: string,
  anonKey: string,
  jwt: string,
  token: string,
  base: string,
  ids: string[] | null,
  formato: "a4" | "termica",
): Promise<Response> {
  const pedidos = await listarPedidos(url, anonKey, jwt, ids, "impressao");
  if (pedidos === "rede") {
    return jsonPainel(origin, 503, { ok: false, erro: "indisponivel", mensagem: "Não consegui ler os pedidos." });
  }
  const meIds = pedidos
    .filter((pedido) => classificarPedido(pedido).tipo === "imprimir" || (pedido.me_order_id && pedido.status === "pago"))
    .map((pedido) => pedido.me_order_id);
  const plano = planoImpressao(formato, meIds);
  if (!plano) {
    return jsonPainel(origin, 409, { ok: false, erro: "vazio", mensagem: "Não há etiqueta gerada para imprimir." });
  }

  const pedir = async (qual: NonNullable<ReturnType<typeof planoImpressao>>): Promise<string | null> => {
    const res = qual.metodo === "GET"
      ? await meFetch(base, token, qual.caminho, { method: "GET" })
      : await meFetch(base, token, qual.caminho, { method: "POST", body: JSON.stringify(qual.corpo) });
    if (!res.ok) return null;
    return lerUrlImpressao(await res.json().catch(() => null));
  };

  try {
    let urlPdf = await pedir(plano);
    let formatoEfetivo = formato;
    if (!urlPdf && plano.fallback === "print") {
      const folha = planoFolha(meIds);
      if (folha) {
        urlPdf = await pedir(folha);
        formatoEfetivo = "a4";
      }
    }
    if (!urlPdf) {
      return jsonPainel(origin, 502, { ok: false, erro: "impressao", mensagem: "O Melhor Envio não devolveu o PDF." });
    }
    return jsonPainel(origin, 200, {
      ok: true,
      url: urlPdf,
      formato: formatoEfetivo,
      quantidade: meIds.length,
      mensagem: formatoEfetivo === formato
        ? "PDF pronto."
        : "A térmica não veio em um arquivo só. Abri o PDF da folha.",
    });
  } catch (_err) {
    return jsonPainel(origin, 502, { ok: false, erro: "me_rede", mensagem: "O Melhor Envio não respondeu." });
  }
}
