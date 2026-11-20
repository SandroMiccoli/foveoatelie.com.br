// Cotação Melhor Envio. As constantes são as mesmas que a sacola já usa.
// Headers HTTP são ASCII: o macron de Foveō faz o fetch do Deno rejeitar o header.

export const USER_AGENT = "Foveo Atelie (contato@foveoatelie.com.br)";

const CEP_ORIGEM = "31030285";
const EMBALAGEM_LARGURA_CM = 10;
const EMBALAGEM_COMPRIMENTO_CM = 15;
const EMBALAGEM_ALTURA_CM = 6;
const PESO_VELA_KG = 0.12;
const PESO_EMBALAGEM_KG = 0.05;
const VELAS_POR_PACOTE = 0;

const BASE_URL_PADRAO = "https://melhorenvio.com.br";
const BASES_PERMITIDAS = new Set([
  "https://melhorenvio.com.br",
  "https://sandbox.melhorenvio.com.br",
]);

export type ItemPedido = { produto_id: string; qtd: number };

type Pacote = {
  width: number;
  height: number;
  length: number;
  weight: number;
  insurance: number;
};

export type OpcaoFrete = {
  id: string;
  transportadora: string;
  servico: string;
  preco_centavos: number;
  prazo_dias: number | null;
};

export function credenciaisSupabase(): { url: string; key: string } | null {
  const url = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) return null;
  return { url, key };
}

export async function conferirProdutos(ids: string[]): Promise<"ok" | "invalido" | "indisponivel"> {
  const cred = credenciaisSupabase();
  if (!cred) return "indisponivel";

  const filtro = ids.map((id) => encodeURIComponent(id)).join(",");
  let res: Response;
  try {
    res = await fetch(`${cred.url}/rest/v1/produtos?select=id,ativo&id=in.(${filtro})`, {
      headers: {
        apikey: cred.key,
        Authorization: `Bearer ${cred.key}`,
        Accept: "application/json",
      },
    });
  } catch (_err) {
    return "indisponivel";
  }
  if (!res.ok) return "indisponivel";

  let rows: unknown;
  try {
    rows = await res.json();
  } catch (_err) {
    return "indisponivel";
  }
  if (!Array.isArray(rows)) return "indisponivel";

  const ativos = new Set(
    rows
      .filter((row) => row && typeof row === "object" && (row as { ativo?: unknown }).ativo === true)
      .map((row) => String((row as { id?: unknown }).id)),
  );
  return ids.every((id) => ativos.has(id)) ? "ok" : "invalido";
}

export async function valorDeclaradoCentavos(qtd: number): Promise<number | null> {
  const cred = credenciaisSupabase();
  if (!cred) return null;

  let res: Response;
  try {
    res = await fetch(`${cred.url}/rest/v1/rpc/calcular_preco_centavos`, {
      method: "POST",
      headers: {
        apikey: cred.key,
        Authorization: `Bearer ${cred.key}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ qtd }),
    });
  } catch (_err) {
    return null;
  }
  if (!res.ok) return null;

  let data: unknown;
  try {
    data = await res.json();
  } catch (_err) {
    return null;
  }
  if (typeof data !== "number" || !Number.isInteger(data) || data < 0) return null;
  return data;
}

export function montarPacotes(qtd: number, valorCentavos: number): Pacote[] {
  const capacidade = VELAS_POR_PACOTE > 0 ? VELAS_POR_PACOTE : qtd;
  const nPacotes = Math.ceil(qtd / capacidade);
  const pacotes: Pacote[] = [];
  let valorUsado = 0;

  for (let i = 0; i < nPacotes; i++) {
    const neste = Math.min(capacidade, qtd - i * capacidade);
    const sugerido = Math.round((valorCentavos * neste) / qtd);
    const valorNeste = i === nPacotes - 1
      ? valorCentavos - valorUsado
      : Math.min(sugerido, valorCentavos - valorUsado);
    valorUsado += valorNeste;
    pacotes.push({
      width: EMBALAGEM_LARGURA_CM,
      height: EMBALAGEM_ALTURA_CM,
      length: EMBALAGEM_COMPRIMENTO_CM,
      weight: Math.round((neste * PESO_VELA_KG + PESO_EMBALAGEM_KG) * 1000) / 1000,
      insurance: Math.round(valorNeste) / 100,
    });
  }

  return pacotes;
}

export function baseUrlMelhorEnvio(): string | null {
  const bruta = (Deno.env.get("MELHOR_ENVIO_BASE_URL") || BASE_URL_PADRAO).replace(/\/+$/, "");
  return BASES_PERMITIDAS.has(bruta) ? bruta : null;
}

export function reaisParaCentavos(valor: unknown): number | null {
  const texto = typeof valor === "number"
    ? (Number.isFinite(valor) ? String(valor) : "")
    : typeof valor === "string"
    ? valor.trim().replace(/\s/g, "").replace(",", ".")
    : "";
  if (!/^\d+(\.\d+)?$/.test(texto)) return null;
  const numero = Number(texto);
  if (!Number.isFinite(numero) || numero < 0) return null;
  return Math.round(numero * 100);
}

function lerOpcao(item: unknown): OpcaoFrete | null {
  if (!item || typeof item !== "object") return null;
  const row = item as Record<string, unknown>;
  if (row.error) return null;
  if (row.id == null || row.id === "") return null;

  const preco = reaisParaCentavos(row.custom_price ?? row.price);
  if (preco == null) return null;

  const prazoBruto = row.custom_delivery_time ?? row.delivery_time;
  let prazo: number | null = null;
  if (typeof prazoBruto === "number" && Number.isFinite(prazoBruto) && prazoBruto >= 0) {
    prazo = Math.round(prazoBruto);
  } else if (typeof prazoBruto === "string" && /^\d+$/.test(prazoBruto)) {
    prazo = Number(prazoBruto);
  }

  const empresa = row.company;
  const transportadora = empresa && typeof empresa === "object" &&
      typeof (empresa as { name?: unknown }).name === "string"
    ? (empresa as { name: string }).name
    : "";
  const servico = typeof row.name === "string" && row.name.trim() ? row.name.trim() : "";
  if (!servico && !transportadora) return null;

  return {
    id: String(row.id),
    transportadora,
    servico: servico || transportadora,
    preco_centavos: preco,
    prazo_dias: prazo,
  };
}

export async function cotarMelhorEnvio(cepDestino: string, pacotes: Pacote[]): Promise<OpcaoFrete[] | null> {
  const token = (Deno.env.get("MELHOR_ENVIO_TOKEN") ?? "").trim();
  const base = baseUrlMelhorEnvio();
  if (!token || !base) return null;

  let res: Response;
  try {
    res = await fetch(`${base}/api/v2/me/shipment/calculate`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify({
        from: { postal_code: CEP_ORIGEM },
        to: { postal_code: cepDestino },
        volumes: pacotes,
        options: { receipt: false, own_hand: false },
      }),
      signal: AbortSignal.timeout(12000),
    });
  } catch (err) {
    console.error("frete: falha ao chamar o Melhor Envio", err instanceof Error ? err.message : err);
    return null;
  }

  if (!res.ok) {
    console.error("frete: Melhor Envio respondeu", res.status);
    return null;
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch (_err) {
    return null;
  }
  if (!Array.isArray(data)) return null;

  const opcoes: OpcaoFrete[] = [];
  for (const item of data) {
    const opcao = lerOpcao(item);
    if (opcao) opcoes.push(opcao);
  }
  opcoes.sort((a, b) => a.preco_centavos - b.preco_centavos || (a.prazo_dias ?? 0) - (b.prazo_dias ?? 0));
  return opcoes;
}

export async function cotarItens(cep: string, itens: ItemPedido[]): Promise<
  { ok: true; opcoes: OpcaoFrete[] } | { ok: false; erro: "pedido_invalido" | "cotacao_indisponivel" }
> {
  const checagem = await conferirProdutos(itens.map((item) => item.produto_id));
  if (checagem === "indisponivel") return { ok: false, erro: "cotacao_indisponivel" };
  if (checagem === "invalido") return { ok: false, erro: "pedido_invalido" };

  const qtdTotal = itens.reduce((soma, item) => soma + item.qtd, 0);
  const valorCentavos = await valorDeclaradoCentavos(qtdTotal);
  if (valorCentavos == null) return { ok: false, erro: "cotacao_indisponivel" };

  const opcoes = await cotarMelhorEnvio(cep, montarPacotes(qtdTotal, valorCentavos));
  if (!opcoes) return { ok: false, erro: "cotacao_indisponivel" };
  return { ok: true, opcoes };
}
