// Cotação de frete da sacola (Melhor Envio). O token não sai do servidor.
// Deploy e secrets: ver README.md nesta pasta. Não publicar daqui.

// ── constantes da embalagem (trocar aqui quando a caixa for confirmada) ──
/** CEP de origem: 31030-285, Belo Horizonte. */
const CEP_ORIGEM = "31030285";

/** Largura da embalagem, em cm. */
const EMBALAGEM_LARGURA_CM = 10;
/** Comprimento da embalagem, em cm. */
const EMBALAGEM_COMPRIMENTO_CM = 15;
/**
 * Altura da embalagem, em cm.
 * Ainda não confirmada: 6 cm é estimativa.
 */
const EMBALAGEM_ALTURA_CM = 6;

/** Peso de uma vela, em kg. */
const PESO_VELA_KG = 0.12;
/** Peso da embalagem, somado uma vez por pacote, em kg. */
const PESO_EMBALAGEM_KG = 0.05;

/**
 * Quantas velas cabem em cada pacote.
 * 0 coloca o pedido inteiro num pacote só:
 * peso = quantidade × PESO_VELA_KG + PESO_EMBALAGEM_KG.
 */
const VELAS_POR_PACOTE = 0;

// Headers HTTP são ASCII. O macron de Foveō faz o fetch do Deno rejeitar o header.
const USER_AGENT = "Foveo Atelie (contato@foveoatelie.com.br)";
const BASE_URL_PADRAO = "https://melhorenvio.com.br";
const BASES_PERMITIDAS = new Set([
  "https://melhorenvio.com.br",
  "https://sandbox.melhorenvio.com.br",
]);

const ORIGENS_FIXAS = new Set([
  "https://foveoatelie.com.br",
  "https://dev.foveoatelie.com.br",
]);

const LIMITE_ITENS = 20;
const LIMITE_QTD = 99;
const LIMITE_CORPO = 8000;

type ItemPedido = { produto_id: string; qtd: number };

type Pacote = {
  width: number;
  height: number;
  length: number;
  weight: number;
  insurance: number;
};

type OpcaoFrete = {
  id: string;
  transportadora: string;
  servico: string;
  preco_centavos: number;
  prazo_dias: number | null;
};

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cabecalhosCors(origin) });
  }

  if (origin && !origemPermitida(origin)) {
    return json(origin, 403, { erro: "origem" });
  }

  if (req.method !== "POST") {
    return json(origin, 405, { erro: "metodo" });
  }

  let bruto = "";
  try {
    bruto = await req.text();
  } catch (_err) {
    return json(origin, 400, { erro: "pedido_invalido" });
  }
  if (bruto.length > LIMITE_CORPO) {
    return json(origin, 400, { erro: "pedido_invalido" });
  }

  let corpo: unknown;
  try {
    corpo = JSON.parse(bruto);
  } catch (_err) {
    return json(origin, 400, { erro: "pedido_invalido" });
  }

  const pedido = lerPedido(corpo);
  if (!pedido) return json(origin, 400, { erro: "pedido_invalido" });

  const checagem = await conferirProdutos(pedido.itens.map((item) => item.produto_id));
  if (checagem === "indisponivel") return json(origin, 503, { erro: "cotacao_indisponivel" });
  if (checagem === "invalido") return json(origin, 400, { erro: "pedido_invalido" });

  const qtdTotal = pedido.itens.reduce((soma, item) => soma + item.qtd, 0);
  const valorCentavos = await valorDeclaradoCentavos(qtdTotal);
  if (valorCentavos == null) return json(origin, 503, { erro: "cotacao_indisponivel" });

  const opcoes = await cotarMelhorEnvio(pedido.cep, montarPacotes(qtdTotal, valorCentavos));
  if (!opcoes) return json(origin, 502, { erro: "cotacao_indisponivel" });

  return json(origin, 200, { opcoes });
});

function origemPermitida(origin: string): boolean {
  if (ORIGENS_FIXAS.has(origin)) return true;
  return /^https:\/\/deploy-preview-[a-z0-9-]+--foveoatelie\.netlify\.app$/i.test(origin);
}

function cabecalhosCors(origin: string | null): Headers {
  const headers = new Headers({
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Max-Age": "86400",
  });
  if (origin && origemPermitida(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

function json(origin: string | null, status: number, corpo: unknown): Response {
  const headers = cabecalhosCors(origin);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(corpo), { status, headers });
}

function lerPedido(corpo: unknown): { cep: string; itens: ItemPedido[] } | null {
  if (!corpo || typeof corpo !== "object") return null;
  const dados = corpo as Record<string, unknown>;
  const cep = String(dados.cep_destino ?? "").replace(/\D/g, "");
  if (!/^\d{8}$/.test(cep) || cep === "00000000") return null;
  if (!Array.isArray(dados.itens) || dados.itens.length === 0 || dados.itens.length > LIMITE_ITENS) {
    return null;
  }

  const mapa = new Map<string, number>();
  for (const bruto of dados.itens) {
    if (!bruto || typeof bruto !== "object") return null;
    const item = bruto as Record<string, unknown>;
    const id = item.produto_id;
    const qtd = item.qtd;
    if (typeof id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) return null;
    if (typeof qtd !== "number" || !Number.isInteger(qtd) || qtd < 1 || qtd > LIMITE_QTD) return null;
    mapa.set(id, (mapa.get(id) ?? 0) + qtd);
  }

  const itens: ItemPedido[] = [];
  let total = 0;
  for (const [produto_id, qtd] of mapa) {
    if (qtd > LIMITE_QTD) return null;
    total += qtd;
    itens.push({ produto_id, qtd });
  }
  if (total < 1 || total > LIMITE_QTD) return null;
  return { cep, itens };
}

function credenciaisSupabase(): { url: string; key: string } | null {
  const url = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) return null;
  return { url, key };
}

async function conferirProdutos(ids: string[]): Promise<"ok" | "invalido" | "indisponivel"> {
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

async function valorDeclaradoCentavos(qtd: number): Promise<number | null> {
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

function montarPacotes(qtd: number, valorCentavos: number): Pacote[] {
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

function baseUrlMelhorEnvio(): string | null {
  const bruta = (Deno.env.get("MELHOR_ENVIO_BASE_URL") || BASE_URL_PADRAO).replace(/\/+$/, "");
  return BASES_PERMITIDAS.has(bruta) ? bruta : null;
}

async function cotarMelhorEnvio(cepDestino: string, pacotes: Pacote[]): Promise<OpcaoFrete[] | null> {
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
    console.error("cotar-frete: falha ao chamar o Melhor Envio", err instanceof Error ? err.message : err);
    return null;
  }

  if (!res.ok) {
    console.error("cotar-frete: Melhor Envio respondeu", res.status);
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

function reaisParaCentavos(valor: unknown): number | null {
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
