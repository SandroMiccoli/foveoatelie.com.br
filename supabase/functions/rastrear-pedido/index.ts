// Consulta pública do pedido pelo código (YYMMDDNNN) mais o e-mail da compra
// ou o CPF — ou pelo UUID do pedido (deep-link pós-pagamento). Não devolve
// endereço, telefone, notas nem ids de pagamento. anon não lê a tabela: a
// função usa a service role e responde só o que cabe.

import { json, cabecalhosCors, origemPermitida } from "../_shared/http.ts";
import { dataPostagem } from "../_shared/pedido.ts";
import {
  combinaRastreio,
  credencialRastreio,
  historicoComTimestamps,
  linhaDoTempo,
  ipClienteRastreio,
  linkRastreio,
  statusPublico,
  uuidPedido,
  type PassoRastreio,
} from "../_shared/etiquetas.ts";

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cabecalhosCors(origin) });
  if (origin && !origemPermitida(origin)) return json(origin, 403, { erro: "origem" });
  if (req.method !== "POST") return json(origin, 405, { erro: "metodo" });

  const ip = ipClienteRastreio(req.headers);

  const url = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  const key = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  if (!url || !key) return json(origin, 503, { erro: "consulta_indisponivel" });

  let bruto = "";
  try {
    bruto = await req.text();
  } catch (_err) {
    return json(origin, 400, { erro: "pedido_invalido" });
  }
  if (bruto.length > 2000) return json(origin, 400, { erro: "pedido_invalido" });

  let corpo: Record<string, unknown>;
  try {
    const parsed = JSON.parse(bruto);
    if (!parsed || typeof parsed !== "object") throw new Error("corpo");
    corpo = parsed as Record<string, unknown>;
  } catch (_err) {
    return json(origin, 400, { erro: "pedido_invalido" });
  }

  const pedidoUuid = typeof corpo.pedido_id === "string" ? uuidPedido(corpo.pedido_id) : null;
  if (pedidoUuid) {
    const limiteUuid = await rpcRastreio(url, key, "bloqueio_rastreio", {
      p_codigo: "000000000",
      p_ip: ip,
    });
    if (!limiteUuid || limiteUuid.ok !== true) return json(origin, 503, { erro: "consulta_indisponivel" });
    if (limiteUuid.bloqueado === true) return json(origin, 404, { erro: "nao_encontrado" });

    const pedido = await buscarPorId(url, key, pedidoUuid);
    if (pedido === "rede") return json(origin, 503, { erro: "consulta_indisponivel" });
    if (!pedido) return json(origin, 404, { erro: "nao_encontrado" });
    return json(origin, 200, await respostaPublica(url, key, pedido));
  }

  const credencial = credencialRastreio(
    typeof corpo.codigo === "string" ? corpo.codigo : "",
    typeof corpo.email === "string" ? corpo.email : "",
    typeof corpo.cpf === "string" ? corpo.cpf : "",
  );
  if (!credencial) return json(origin, 400, { erro: "pedido_invalido" });

  const limite = await rpcRastreio(url, key, "bloqueio_rastreio", {
    p_codigo: credencial.codigo,
    p_ip: ip,
  });
  if (!limite || limite.ok !== true) return json(origin, 503, { erro: "consulta_indisponivel" });
  if (limite.bloqueado === true) return json(origin, 404, { erro: "nao_encontrado" });

  const pedido = await buscarPorCodigo(url, key, credencial.codigo);
  if (pedido === "rede") return json(origin, 503, { erro: "consulta_indisponivel" });
  if (!pedido || !combinaRastreio(credencial, pedido.email, pedido.cpf)) {
    await rpcRastreio(url, key, "anotar_falha_rastreio", {
      p_codigo: credencial.codigo,
      p_ip: ip,
    });
    return json(origin, 404, { erro: "nao_encontrado" });
  }

  return json(origin, 200, await respostaPublica(url, key, pedido));
});

async function respostaPublica(
  url: string,
  key: string,
  pedido: PedidoSeguro,
): Promise<Record<string, unknown>> {
  const brutoHistorico = await buscarHistorico(url, key, pedido.id);
  const status = statusPublico(pedido.status);
  const marcas = marcasDoPedido(pedido, status);
  const historico = historicoComTimestamps(brutoHistorico, marcas);
  const rastreio = pedido.rastreio;
  const quando = pedido.pago_em || pedido.created_at || "";
  return {
    codigo: pedido.codigo,
    status,
    entrega_tipo: pedido.entrega,
    transportadora: pedido.transportadora,
    servico: pedido.servico,
    rastreio: rastreio || null,
    rastreio_url: rastreio ? linkRastreio(pedido.transportadora, rastreio) : null,
    data_postagem: quando ? dataPostagem(quando) : null,
    email: pedido.email || null,
    historico,
  };
}

function marcasDoPedido(pedido: PedidoSeguro, status: string): { status: string; em: string }[] {
  const marcas: { status: string; em: string }[] = [];
  if (pedido.created_at) marcas.push({ status: "pendente", em: pedido.created_at });
  if (pedido.pago_em) marcas.push({ status: "pago", em: pedido.pago_em });
  if (status !== "pendente" && status !== "pago") {
    const em = pedido.pago_em || pedido.created_at || "";
    if (em) marcas.push({ status, em });
  }
  return marcas;
}

async function rpcRastreio(
  url: string,
  key: string,
  nome: string,
  args: Record<string, string>,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${url}/rest/v1/rpc/${nome}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data && typeof data === "object" ? data as Record<string, unknown> : null;
  } catch (_err) {
    return null;
  }
}

type PedidoSeguro = {
  id: string;
  codigo: string;
  status: string;
  entrega: "envio" | "retirada";
  email: string;
  cpf: string;
  transportadora: string;
  servico: string;
  rastreio: string;
  pago_em: string;
  created_at: string;
};

const CAMPOS_PEDIDO =
  "id,codigo,status,entrega_tipo,cliente_email,cliente_cpf,frete,rastreio,pago_em,created_at";

function montarPedido(row: Record<string, unknown>): PedidoSeguro | null {
  const id = typeof row.id === "string" ? row.id : "";
  if (!id) return null;
  const frete = row.frete && typeof row.frete === "object" ? row.frete as Record<string, unknown> : {};
  const codigo = typeof row.codigo === "string" && /^\d{9}$/.test(row.codigo) ? row.codigo : "";
  return {
    id,
    codigo,
    status: typeof row.status === "string" ? row.status : "",
    entrega: row.entrega_tipo === "retirada" ? "retirada" : "envio",
    email: typeof row.cliente_email === "string" ? row.cliente_email : "",
    cpf: typeof row.cliente_cpf === "string" ? row.cliente_cpf : "",
    transportadora: typeof frete.transportadora === "string" ? frete.transportadora : "",
    servico: typeof frete.servico === "string" ? frete.servico : "",
    rastreio: typeof row.rastreio === "string" ? row.rastreio : "",
    pago_em: typeof row.pago_em === "string" ? row.pago_em : "",
    created_at: typeof row.created_at === "string" ? row.created_at : "",
  };
}

async function buscarRest(
  url: string,
  key: string,
  filtro: string,
): Promise<PedidoSeguro | null | "rede"> {
  let res: Response;
  try {
    res = await fetch(`${url}/rest/v1/pedidos?${filtro}&select=${CAMPOS_PEDIDO}`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });
  } catch (_err) {
    return "rede";
  }
  if (!res.ok) return "rede";
  try {
    const data = await res.json();
    const row = Array.isArray(data) ? data[0] : null;
    if (!row || typeof row !== "object") return null;
    return montarPedido(row as Record<string, unknown>);
  } catch (_err) {
    return "rede";
  }
}

async function buscarPorCodigo(
  url: string,
  key: string,
  codigo: string,
): Promise<PedidoSeguro | null | "rede"> {
  return buscarRest(url, key, `codigo=eq.${codigo}`);
}

async function buscarPorId(
  url: string,
  key: string,
  pedidoId: string,
): Promise<PedidoSeguro | null | "rede"> {
  return buscarRest(url, key, `id=eq.${pedidoId}`);
}

async function buscarHistorico(
  url: string,
  key: string,
  pedidoId: string,
): Promise<PassoRastreio[]> {
  let res: Response;
  try {
    res = await fetch(
      `${url}/rest/v1/pedido_status_historico?pedido_id=eq.${pedidoId}&select=status,created_at&order=created_at.asc`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(8000),
      },
    );
  } catch (_err) {
    return [];
  }
  if (!res.ok) return [];
  try {
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return linhaDoTempo(data.map((row) => {
      const item = row && typeof row === "object" ? row as Record<string, unknown> : {};
      return {
        status: typeof item.status === "string" ? item.status : "",
        created_at: typeof item.created_at === "string" ? item.created_at : "",
      };
    }));
  } catch (_err) {
    return [];
  }
}
