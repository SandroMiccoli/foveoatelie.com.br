// Etiquetas do Melhor Envio, chamadas pelo painel.
// JWT do admin. Carrinho e checkout só rodam depois da confirmação na tela.
// O saldo é lido antes; se não cobre, a função não compra.

import { jsonPainel, origemPainel, conferirAdminPainel } from "../_shared/painel.ts";
import {
  classificarPedido,
  fecharResumo,
  lerCarrinho,
  lerPedidoMe,
  lerRastreioGerado,
  lerRemetente,
  lerUrlImpressao,
  montarCarrinho,
  planoDepoisDoCheckout,
  situacaoCompraMe,
  responderPedidoAusente,
  tentarSoltarCarrinho,
  planoFolha,
  planoImpressao,
  precoCotado,
  saldoCentavos,
  type PedidoEtiqueta,
} from "../_shared/etiquetas.ts";
import { registrarSaldoBaixo } from "../_shared/avisos.ts";
import { baseUrlMelhorEnvio, cotarMelhorEnvio, montarPacotes } from "../_shared/frete.ts";
import { chamarMelhorEnvio, tokenMelhorEnvio } from "../_shared/token-me.ts";
import { emSegundoPlano } from "../_shared/segundo-plano.ts";

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
  em_compra: "Outra compra desta etiqueta já está em andamento.",
  sem_cotacao: "Não consegui o preço atual no Melhor Envio.",
};

Deno.serve(async (req) => {
  const origin = origemPainel(req.headers.get("Origin"));
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cabecalhos(origin) });
  }
  if (req.method !== "POST") return jsonPainel(origin, 405, { ok: false, erro: "metodo" });

  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  const anonKey = (Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "").trim();
  const tokenMe = await tokenMelhorEnvio();
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
  if (acao === "reconciliar") {
    if (!ids || !ids.length) {
      return jsonPainel(origin, 400, { ok: false, erro: "pedido_invalido", mensagem: "Escolha o pedido para conferir." });
    }
    return reconciliar(origin, supabaseUrl, anonKey, jwt, tokenMe, base, ids);
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
    me_status: texto(row.me_status).toLowerCase(),
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
    "me_status",
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

async function meFetch(base: string, _token: string, caminho: string, init: RequestInit): Promise<Response> {
  const res = await chamarMelhorEnvio(base + caminho, { ...init, signal: AbortSignal.timeout(20000) });
  if (!res) return new Response(null, { status: 503 });
  return res;
}

async function lerSaldo(base: string, token: string): Promise<number | null> {
  try {
    const res = await meFetch(base, token, "/api/v2/me/balance", { method: "GET" });
    if (!res.ok) return null;
    const centavos = saldoCentavos(await res.json());
    if (centavos != null) emSegundoPlano(registrarSaldoBaixo(centavos));
    return centavos;
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
  const conferir: { id: string; codigo: string }[] = [];
  const candidatos: PedidoEtiqueta[] = [];
  const fora: { codigo: string; motivo: string }[] = [];
  for (const pedido of pedidos) {
    const classe = classificarPedido(pedido);
    if (classe.tipo === "comprar") candidatos.push(pedido);
    else if (classe.tipo === "gerar") gerar.push({ id: pedido.id, codigo: pedido.codigo });
    else if (classe.tipo === "conferir") conferir.push({ id: pedido.id, codigo: pedido.codigo });
    else if (
      classe.tipo === "fora" &&
      ((ids && ids.includes(pedido.id)) || (!ids && pedido.status === "pago"))
    ) {
      fora.push({ codigo: pedido.codigo || pedido.id.slice(0, 8), motivo: MOTIVO[classe.motivo] || classe.motivo });
    }
  }
  for (const pedido of candidatos) {
    const preco = await cotarPedido(pedido);
    if (preco == null) {
      fora.push({
        codigo: pedido.codigo || pedido.id.slice(0, 8),
        motivo: MOTIVO.sem_cotacao,
      });
      continue;
    }
    comprar.push({ id: pedido.id, codigo: pedido.codigo, custo_centavos: preco });
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
    conferir,
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

async function rpcAdmin(
  url: string,
  anonKey: string,
  jwt: string,
  nome: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  let res: Response;
  try {
    res = await fetch(`${url}/rest/v1/rpc/${nome}`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${jwt}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
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

async function cotarPedido(pedido: PedidoEtiqueta): Promise<number | null> {
  const cep = (pedido.endereco?.cep || "").replace(/\D/g, "");
  const qtd = pedido.itens.reduce((soma, item) => soma + item.qtd, 0);
  const servico = (pedido.frete?.id || "").trim();
  if (cep.length !== 8 || qtd < 1 || !servico) return null;
  const opcoes = await cotarMelhorEnvio(cep, montarPacotes(qtd, pedido.subtotal_centavos ?? 0));
  const achou = opcoes?.find((opcao) => opcao.id === servico);
  return achou && achou.preco_centavos > 0 ? achou.preco_centavos : null;
}

async function lerPedidoNaMe(
  base: string,
  token: string,
  meId: string,
): Promise<{ situacao: "pago" | "nao_pago" | "incerto"; ausente: boolean; preco_centavos: number | null; rastreio: string; protocolo: string }> {
  try {
    const res = await meFetch(base, token, "/api/v2/me/orders/" + encodeURIComponent(meId), { method: "GET" });
    if (res.status === 404) {
      return { situacao: "incerto", ausente: true, preco_centavos: null, rastreio: "", protocolo: "" };
    }
    if (!res.ok) return { situacao: "incerto", ausente: false, preco_centavos: null, rastreio: "", protocolo: "" };
    const lido = lerPedidoMe(await res.json());
    if (!lido) return { situacao: "incerto", ausente: false, preco_centavos: null, rastreio: "", protocolo: "" };
    return {
      situacao: situacaoCompraMe(lido.status),
      ausente: false,
      preco_centavos: lido.preco_centavos,
      rastreio: lido.rastreio,
      protocolo: lido.protocolo,
    };
  } catch (_err) {
    return { situacao: "incerto", ausente: false, preco_centavos: null, rastreio: "", protocolo: "" };
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
  if (!ids?.length) {
    return jsonPainel(origin, 400, { ok: false, erro: "pedido_invalido", mensagem: "Escolha os pedidos da compra." });
  }
  const tentativa = crypto.randomUUID();
  const reserva = await rpcAdmin(url, anonKey, jwt, "admin_reservar_compra_etiqueta", {
    p_pedido_ids: ids,
    p_tentativa: tentativa,
  });
  if (!reserva || reserva.ok !== true) {
    return jsonPainel(origin, 503, {
      ok: false,
      erro: "reserva",
      mensagem: "Não reservei a compra. Nada foi para o carrinho.",
    });
  }
  const reservados = new Set(
    Array.isArray(reserva.reservados) ? reserva.reservados.filter((id): id is string => typeof id === "string") : [],
  );

  const pedidos = await listarPedidos(url, anonKey, jwt, ids, "pagos");
  if (pedidos === "rede") {
    let soltas = true;
    for (const id of reservados) {
      const soltou = await soltarCompra(url, anonKey, jwt, id, tentativa, true);
      if (!soltou) soltas = false;
    }
    return jsonPainel(origin, 503, {
      ok: false,
      erro: "indisponivel",
      mensagem: soltas
        ? "Não consegui ler os pedidos. Soltei a reserva."
        : "Não consegui ler os pedidos. A reserva pode continuar. Não compre outra agora.",
    });
  }
  const novos: PedidoEtiqueta[] = [];
  const gerar: PedidoEtiqueta[] = [];
  const fora: { codigo: string; motivo: string }[] = [];
  for (const pedido of pedidos) {
    const classe = classificarPedido(reservados.has(pedido.id) ? { ...pedido, me_status: "" } : pedido);
    if (reservados.has(pedido.id) && classe.tipo === "comprar") novos.push(pedido);
    else if (classe.tipo === "gerar") gerar.push(pedido);
    else if (classe.tipo === "fora" || classe.tipo === "conferir") {
      fora.push({ codigo: pedido.codigo || pedido.id.slice(0, 8), motivo: classe.tipo === "conferir" ? "Essa etiqueta precisa de conferência. Não compre outra." : (MOTIVO[classe.motivo] || classe.motivo) });
    }
    if (reservados.has(pedido.id) && classe.tipo !== "comprar") {
      await soltarCompra(url, anonKey, jwt, pedido.id, tentativa, true);
      reservados.delete(pedido.id);
    }
  }
  for (const id of reservados) {
    if (!novos.some((pedido) => pedido.id === id)) await soltarCompra(url, anonKey, jwt, id, tentativa, true);
  }
  if (!novos.length && !gerar.length) {
    return jsonPainel(origin, 409, {
      ok: false,
      erro: "vazio",
      mensagem: "Nenhum pedido pago de envio está sem etiqueta.",
      fora,
    });
  }

  const carrinho: { pedido: PedidoEtiqueta; meId: string; protocolo: string; preco: number | null }[] = [];
  const falhas: { codigo: string; motivo: string; conferir?: boolean }[] = [];
  for (const pedido of novos) {
    const corpo = montarCarrinho(pedido, remetente);
    if (!corpo) {
      await soltarCompra(url, anonKey, jwt, pedido.id, tentativa, true);
      falhas.push({ codigo: pedido.codigo, motivo: "Não montei a etiqueta. Nada foi comprado." });
      continue;
    }
    let res: Response;
    try {
      res = await meFetch(base, token, "/api/v2/me/cart", { method: "POST", body: JSON.stringify(corpo) });
    } catch (_err) {
      await soltarCompra(url, anonKey, jwt, pedido.id, tentativa, true);
      falhas.push({ codigo: pedido.codigo, motivo: "O Melhor Envio não respondeu. Nada foi comprado." });
      continue;
    }
    if (!res.ok) {
      await soltarCompra(url, anonKey, jwt, pedido.id, tentativa, true);
      falhas.push({ codigo: pedido.codigo, motivo: "O Melhor Envio recusou o carrinho. Nada foi comprado." });
      continue;
    }
    const lido = lerCarrinho(await res.json().catch(() => null));
    if (!lido || lido.preco_centavos == null) {
      if (lido) await decidirCarrinho(url, anonKey, jwt, base, token, pedido.id, tentativa, lido.id);
      else await soltarCompra(url, anonKey, jwt, pedido.id, tentativa, true);
      falhas.push({ codigo: pedido.codigo, motivo: "A resposta do carrinho veio sem preço. Conferi antes de seguir.", conferir: Boolean(lido) });
      continue;
    }
    const gravado = await gravarPendente(url, anonKey, jwt, pedido.id, tentativa, lido);
    if (!gravado) {
      const destino = await decidirCarrinho(url, anonKey, jwt, base, token, pedido.id, tentativa, lido.id);
      falhas.push({
        codigo: pedido.codigo,
        motivo: destino === "conferir"
          ? "Entrou no carrinho, mas o painel não gravou. Não compre outra. Use Conferir etiqueta."
          : "Não gravei o carrinho. Tirei o item porque o Melhor Envio ainda não cobrou.",
        conferir: destino === "conferir",
      });
      continue;
    }
    carrinho.push({ pedido, meId: lido.id, protocolo: lido.protocolo, preco: lido.preco_centavos });
  }

  let checkoutConfirmado = false;
  if (carrinho.length) {
    const saldo = await lerSaldo(base, token);
    const total = carrinho.reduce((soma, item) => soma + (item.preco ?? 0), 0);
    const contas = saldo == null ? null : fecharResumo([total], saldo);
    if (saldo == null || !contas?.pode_comprar) {
      for (const item of carrinho) {
        const destino = await decidirCarrinho(url, anonKey, jwt, base, token, item.pedido.id, tentativa, item.meId);
        if (destino === "conferir") {
          falhas.push({ codigo: item.pedido.codigo, motivo: "O saldo não cobre o preço do carrinho e não deu para tirar. Use Conferir etiqueta.", conferir: true });
        }
      }
      return jsonPainel(origin, 409, {
        ok: false,
        erro: saldo == null ? "saldo" : "saldo_insuficiente",
        mensagem: saldo == null
          ? "Não li o saldo. Não fiz o checkout."
          : "O preço do carrinho passa do saldo. Não fiz o checkout.",
        falta_centavos: contas?.falta_centavos ?? null,
        saldo_centavos: saldo,
        total_centavos: total,
        falhas,
        fora,
      });
    }

    let checkoutOk = false;
    try {
      const checkout = await meFetch(base, token, "/api/v2/me/shipment/checkout", {
        method: "POST",
        body: JSON.stringify({ orders: carrinho.map((item) => item.meId) }),
      });
      checkoutOk = checkout.ok;
      if (!checkout.ok) console.error("etiquetas: checkout", checkout.status);
    } catch (_err) {
      checkoutOk = false;
    }
    if (!checkoutOk) {
      const pagos: typeof carrinho = [];
      for (const item of carrinho) {
        const visto = await lerPedidoNaMe(base, token, item.meId);
        const plano = planoDepoisDoCheckout(visto.situacao);
        if (plano === "seguir") pagos.push(item);
        else if (plano === "remover") {
          const destino = await confirmarRemocao(url, anonKey, jwt, base, token, item.pedido.id, tentativa, item.meId);
          falhas.push(destino === "removido"
            ? { codigo: item.pedido.codigo, motivo: "O checkout não pagou. Tirei do carrinho." }
            : {
              codigo: item.pedido.codigo,
              motivo: "O checkout não pagou, mas não deu para tirar do carrinho. Não compre outra. Use Conferir etiqueta.",
              conferir: true,
            });
        } else {
          await rpcAdmin(url, anonKey, jwt, "admin_marcar_conferencia_etiqueta", {
            p_pedido_id: item.pedido.id,
            p_me_order_id: item.meId,
          });
          falhas.push({
            codigo: item.pedido.codigo,
            motivo: "O checkout não respondeu e não deu para saber se pagou. Não compre outra. Use Conferir etiqueta.",
            conferir: true,
          });
        }
      }
      carrinho.length = 0;
      carrinho.push(...pagos);
    } else {
      checkoutConfirmado = true;
    }
  }

  const candidatos = [
    ...carrinho.map((item) => ({ pedido: item.pedido, meId: item.meId, recemPago: checkoutConfirmado })),
    ...gerar.map((pedido) => ({ pedido, meId: pedido.me_order_id, recemPago: false })),
  ];
  const paraGerar: { pedido: PedidoEtiqueta; meId: string }[] = [];
  for (const item of candidatos) {
    const visto = await lerPedidoNaMe(base, token, item.meId);
    if (planoDepoisDoCheckout(visto.situacao) !== "seguir") {
      if (planoDepoisDoCheckout(visto.situacao) === "remover" && !item.recemPago) {
        const destino = await confirmarRemocao(url, anonKey, jwt, base, token, item.pedido.id, tentativa, item.meId);
        falhas.push(destino === "removido"
          ? { codigo: item.pedido.codigo, motivo: "A etiqueta não está paga. Tirei do carrinho." }
          : {
            codigo: item.pedido.codigo,
            motivo: "Não confirmei o pagamento e não tirei do carrinho. Não compre outra. Use Conferir etiqueta.",
            conferir: true,
          });
      } else {
        await rpcAdmin(url, anonKey, jwt, "admin_marcar_conferencia_etiqueta", {
          p_pedido_id: item.pedido.id,
          p_me_order_id: item.meId,
        });
        falhas.push({
          codigo: item.pedido.codigo,
          motivo: "Não confirmei que a etiqueta foi paga. Não compre outra. Use Conferir etiqueta.",
          conferir: true,
        });
      }
      continue;
    }
    paraGerar.push(item);
  }
  const rastros = await gerarRastreios(base, token, paraGerar.map((item) => item.meId));
  const geradas: { id: string; codigo: string; me_order_id: string; rastreio: string; status: string }[] = [];
  for (const item of paraGerar) {
    const rastreio = rastros.get(item.meId) ?? "";
    const gravado = await rpcEtiqueta(url, anonKey, jwt, item.pedido.id, {
      me_order_id: item.meId,
      rastreio: rastreio || null,
      me_status: rastreio ? "generated" : "released",
    });
    if (!gravado || gravado.ok !== true) {
      await rpcAdmin(url, anonKey, jwt, "admin_marcar_conferencia_etiqueta", {
        p_pedido_id: item.pedido.id,
        p_me_order_id: item.meId,
      });
      falhas.push({
        codigo: item.pedido.codigo,
        motivo: "A etiqueta pode já estar paga. Não compre outra. Use Conferir etiqueta.",
        conferir: true,
      });
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

  const precisa = falhas.some((item) => item.conferir);
  return jsonPainel(origin, 200, {
    ok: falhas.length === 0,
    geradas,
    falhas,
    fora,
    imprimir_ids: geradas.map((item) => item.me_order_id),
    mensagem: precisa
      ? "Alguma etiqueta pode já estar paga. Não compre outra. Abra o pedido e use Conferir etiqueta."
      : falhas.length
      ? "Alguma etiqueta não foi comprada. As outras seguiram."
      : geradas.every((item) => item.rastreio)
      ? "Etiquetas geradas."
      : "Etiquetas compradas. O rastreio ainda não voltou.",
  });
}

async function soltarCompra(
  url: string,
  anonKey: string,
  jwt: string,
  pedidoId: string,
  tentativa: string | null,
  nadaComprado: boolean,
): Promise<boolean> {
  const gravado = await rpcAdmin(url, anonKey, jwt, "admin_liberar_compra_etiqueta", {
    p_pedido_id: pedidoId,
    p_tentativa: tentativa,
    p_nada_comprado: nadaComprado,
  });
  return gravado?.ok === true;
}

async function gravarPendente(
  url: string,
  anonKey: string,
  jwt: string,
  pedidoId: string,
  tentativa: string,
  lido: { id: string; protocolo: string; preco_centavos: number | null },
): Promise<boolean> {
  for (let i = 0; i < 2; i++) {
    const gravado = await rpcAdmin(url, anonKey, jwt, "admin_gravar_carrinho_etiqueta", {
      p_pedido_id: pedidoId,
      p_tentativa: tentativa,
      p_me_order_id: lido.id,
      p_protocolo: lido.protocolo,
      p_preco_centavos: lido.preco_centavos,
    });
    if (gravado?.ok === true) return true;
  }
  return false;
}

async function apagarSeLivre(base: string, token: string, meId: string): Promise<boolean> {
  try {
    const res = await meFetch(base, token, "/api/v2/me/cart/" + encodeURIComponent(meId), { method: "DELETE" });
    if (!res.ok) console.error("etiquetas: não saiu do carrinho", res.status);
    return res.ok;
  } catch (_err) {
    console.error("etiquetas: não saiu do carrinho");
    return false;
  }
}

async function confirmarRemocao(
  url: string,
  anonKey: string,
  jwt: string,
  base: string,
  token: string,
  pedidoId: string,
  tentativa: string | null,
  meId: string,
): Promise<"removido" | "conferir"> {
  const plano = await tentarSoltarCarrinho(
    meId,
    (id) => apagarSeLivre(base, token, id),
    async (id) => {
      const lido = await lerPedidoNaMe(base, token, id);
      return { situacao: lido.situacao, ausente: lido.ausente };
    },
  );
  if (plano === "soltar") {
    const soltou = await soltarCompra(url, anonKey, jwt, pedidoId, tentativa, true);
    if (soltou) return "removido";
  }
  await rpcAdmin(url, anonKey, jwt, "admin_marcar_conferencia_etiqueta", {
    p_pedido_id: pedidoId,
    p_me_order_id: meId,
  });
  return "conferir";
}

async function decidirCarrinho(
  url: string,
  anonKey: string,
  jwt: string,
  base: string,
  token: string,
  pedidoId: string,
  tentativa: string,
  meId: string,
): Promise<"removido" | "conferir"> {
  const visto = await lerPedidoNaMe(base, token, meId);
  if (planoDepoisDoCheckout(visto.situacao) !== "remover") {
    await rpcAdmin(url, anonKey, jwt, "admin_marcar_conferencia_etiqueta", {
      p_pedido_id: pedidoId,
      p_me_order_id: meId,
    });
    return "conferir";
  }
  return confirmarRemocao(url, anonKey, jwt, base, token, pedidoId, tentativa, meId);
}

async function gerarRastreios(base: string, token: string, meIds: string[]): Promise<Map<string, string>> {
  const rastros = new Map<string, string>();
  if (!meIds.length) return rastros;
  let geracao: unknown = null;
  try {
    const res = await meFetch(base, token, "/api/v2/me/shipment/generate", {
      method: "POST",
      body: JSON.stringify({ orders: meIds }),
    });
    if (res.ok) geracao = await res.json();
    else console.error("etiquetas: gerar", res.status);
  } catch (err) {
    console.error("etiquetas: gerar", err instanceof Error ? err.name : "erro");
  }
  for (const [id, code] of lerRastreioGerado(geracao, meIds)) rastros.set(id, code);
  const faltam = meIds.filter((id) => !rastros.has(id));
  if (faltam.length) {
    try {
      const res = await meFetch(base, token, "/api/v2/me/shipment/tracking", {
        method: "POST",
        body: JSON.stringify({ orders: faltam }),
      });
      if (res.ok) {
        for (const [id, code] of lerRastreioGerado(await res.json(), faltam)) rastros.set(id, code);
      }
    } catch (_err) {
      // O rastreio pode chegar no webhook.
    }
  }
  return rastros;
}

async function reconciliar(
  origin: string | null,
  url: string,
  anonKey: string,
  jwt: string,
  token: string,
  base: string,
  ids: string[],
): Promise<Response> {
  const pedidos = await listarPedidos(url, anonKey, jwt, ids, "impressao");
  if (pedidos === "rede") {
    return jsonPainel(origin, 503, { ok: false, erro: "indisponivel", mensagem: "Não consegui ler o pedido." });
  }
  const geradas: { id: string; codigo: string; me_order_id: string; rastreio: string; status: string }[] = [];
  const falhas: { codigo: string; motivo: string }[] = [];
  for (const pedido of pedidos) {
    if (!pedido.me_order_id) {
      falhas.push({ codigo: pedido.codigo, motivo: "Esse pedido não tem etiqueta no Melhor Envio." });
      continue;
    }
    const visto = await lerPedidoNaMe(base, token, pedido.me_order_id);
    const plano = planoDepoisDoCheckout(visto.situacao);
    if (visto.ausente) {
      const resposta = await responderPedidoAusente(pedido.me_order_id, (id) =>
        confirmarRemocao(url, anonKey, jwt, base, token, pedido.id, null, id));
      if (!resposta.soltou) {
        await rpcAdmin(url, anonKey, jwt, "admin_marcar_conferencia_etiqueta", {
          p_pedido_id: pedido.id,
          p_me_order_id: pedido.me_order_id,
        });
      }
      falhas.push({ codigo: pedido.codigo, motivo: resposta.mensagem });
      continue;
    }
    if (plano === "remover") {
      const destino = await confirmarRemocao(url, anonKey, jwt, base, token, pedido.id, null, pedido.me_order_id);
      falhas.push(destino === "removido"
        ? { codigo: pedido.codigo, motivo: "O Melhor Envio não cobrou. Soltei o pedido para uma compra nova." }
        : { codigo: pedido.codigo, motivo: "Não deu para tirar do carrinho. Não compre outra. Use Conferir etiqueta." });
      continue;
    }
    if (plano === "conferir") {
      await rpcAdmin(url, anonKey, jwt, "admin_marcar_conferencia_etiqueta", {
        p_pedido_id: pedido.id,
        p_me_order_id: pedido.me_order_id,
      });
      falhas.push({ codigo: pedido.codigo, motivo: "Ainda não deu para saber se a etiqueta foi paga. Não compre outra." });
      continue;
    }
    const rastros = await gerarRastreios(base, token, [pedido.me_order_id]);
    const rastreio = rastros.get(pedido.me_order_id) || visto.rastreio || pedido.rastreio;
    const gravado = await rpcEtiqueta(url, anonKey, jwt, pedido.id, {
      me_order_id: pedido.me_order_id,
      protocolo: visto.protocolo || null,
      rastreio: rastreio || null,
      me_status: rastreio ? "generated" : "released",
      preco_centavos: visto.preco_centavos,
    });
    if (!gravado || gravado.ok !== true) {
      await rpcAdmin(url, anonKey, jwt, "admin_marcar_conferencia_etiqueta", {
        p_pedido_id: pedido.id,
        p_me_order_id: pedido.me_order_id,
      });
      falhas.push({ codigo: pedido.codigo, motivo: "A etiqueta está paga, mas o painel não gravou. Não compre outra." });
      continue;
    }
    geradas.push({
      id: pedido.id,
      codigo: pedido.codigo,
      me_order_id: pedido.me_order_id,
      rastreio,
      status: typeof gravado.status === "string" ? gravado.status : pedido.status,
    });
  }
  return jsonPainel(origin, 200, {
    ok: falhas.length === 0,
    geradas,
    falhas,
    mensagem: falhas.length
      ? falhas[0].motivo
      : "Etiqueta conferida.",
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
