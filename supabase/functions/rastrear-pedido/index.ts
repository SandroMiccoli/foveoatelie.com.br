// Consulta pública do pedido pelo código (YYMMDDNNN) mais o e-mail da compra
// ou o CPF. Não devolve endereço, telefone, notas nem ids de pagamento.
// anon não lê a tabela: a função usa a service role e responde só o que cabe.

import { json, cabecalhosCors, origemPermitida } from "../_shared/http.ts";
import {
  combinaRastreio,
  credencialRastreio,
  linhaDoTempo,
  ipClienteRastreio,
  linkRastreio,
  statusPublico,
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

  const pedido = await buscar(url, key, credencial.codigo);
  if (pedido === "rede") return json(origin, 503, { erro: "consulta_indisponivel" });
  if (!pedido || !combinaRastreio(credencial, pedido.email, pedido.cpf)) {
    await rpcRastreio(url, key, "anotar_falha_rastreio", {
      p_codigo: credencial.codigo,
      p_ip: ip,
    });
    return json(origin, 404, { erro: "nao_encontrado" });
  }

  const historico = await buscarHistorico(url, key, pedido.id);
  const status = statusPublico(pedido.status);
  const rastreio = pedido.rastreio;
  return json(origin, 200, {
    codigo: credencial.codigo,
    status,
    entrega_tipo: pedido.entrega,
    transportadora: pedido.transportadora,
    servico: pedido.servico,
    rastreio: rastreio || null,
    rastreio_url: rastreio ? linkRastreio(pedido.transportadora, rastreio) : null,
    historico: historico,
  });
});

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
  status: string;
  entrega: "envio" | "retirada";
  email: string;
  cpf: string;
  transportadora: string;
  servico: string;
  rastreio: string;
};

async function buscar(url: string, key: string, codigo: string): Promise<PedidoSeguro | null | "rede"> {
  const campos = "id,status,entrega_tipo,cliente_email,cliente_cpf,frete,rastreio";
  let res: Response;
  try {
    res = await fetch(`${url}/rest/v1/pedidos?codigo=eq.${codigo}&select=${campos}`, {
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
    const pedido = row as Record<string, unknown>;
    const id = typeof pedido.id === "string" ? pedido.id : "";
    if (!id) return null;
    const frete = pedido.frete && typeof pedido.frete === "object" ? pedido.frete as Record<string, unknown> : {};
    return {
      id,
      status: typeof pedido.status === "string" ? pedido.status : "",
      entrega: pedido.entrega_tipo === "retirada" ? "retirada" : "envio",
      email: typeof pedido.cliente_email === "string" ? pedido.cliente_email : "",
      cpf: typeof pedido.cliente_cpf === "string" ? pedido.cliente_cpf : "",
      transportadora: typeof frete.transportadora === "string" ? frete.transportadora : "",
      servico: typeof frete.servico === "string" ? frete.servico : "",
      rastreio: typeof pedido.rastreio === "string" ? pedido.rastreio : "",
    };
  } catch (_err) {
    return "rede";
  }
}

async function buscarHistorico(
  url: string,
  key: string,
  pedidoId: string,
): Promise<{ status: string; em: string }[]> {
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
