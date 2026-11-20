// Reserva o evento, manda o SMTP e só então marca como enviado.
// Sem os secrets de SMTP, não reserva: o pagamento segue e o e-mail espera.

import {
  assuntoEmail,
  htmlEmail,
  textoEmail,
  type DadosEmail,
  type EventoEmail,
  type ItemEmail,
} from "./correio.ts";
import { credenciaisSupabase } from "./frete.ts";
import { envelopeDe, enviarSmtp, lerSmtp } from "./smtp.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Cred = { url: string; key: string };

async function rpc(cred: Cred, nome: string, corpo: unknown): Promise<Record<string, unknown> | null> {
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
      signal: AbortSignal.timeout(12000),
    });
  } catch (err) {
    console.error("correio: rpc", nome, err instanceof Error ? err.name : "erro");
    return null;
  }
  if (!res.ok) {
    console.error("correio: rpc", nome, res.status);
    return null;
  }
  try {
    const data = await res.json();
    return data && typeof data === "object" ? data as Record<string, unknown> : null;
  } catch (_err) {
    return null;
  }
}

function centavos(valor: unknown): number {
  const n = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

function itensDe(bruto: unknown): ItemEmail[] {
  if (!Array.isArray(bruto)) return [];
  const itens: ItemEmail[] = [];
  for (const item of bruto) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const nome = typeof row.nome === "string" ? row.nome.trim().slice(0, 80) : "";
    const qtd = centavos(row.qtd);
    if (!nome || qtd < 1) continue;
    itens.push({ nome, qtd, preco_unitario_centavos: centavos(row.preco_unitario_centavos) });
  }
  return itens;
}

async function lerPedido(cred: Cred, pedidoId: string): Promise<DadosEmail | null> {
  const campos = [
    "codigo",
    "cliente_nome",
    "cliente_email",
    "entrega_tipo",
    "itens",
    "subtotal_centavos",
    "desconto_centavos",
    "frete_centavos",
    "total_centavos",
    "frete",
    "rastreio",
    "status",
    "pago_em",
    "created_at",
  ].join(",");
  let res: Response;
  try {
    res = await fetch(`${cred.url}/rest/v1/pedidos?id=eq.${pedidoId}&select=${campos}`, {
      headers: {
        apikey: cred.key,
        Authorization: `Bearer ${cred.key}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(12000),
    });
  } catch (err) {
    console.error("correio: leitura", err instanceof Error ? err.name : "erro");
    return null;
  }
  if (!res.ok) return null;
  let data: unknown;
  try {
    data = await res.json();
  } catch (_err) {
    return null;
  }
  const row = Array.isArray(data) ? data[0] : null;
  if (!row || typeof row !== "object") return null;
  const pedido = row as Record<string, unknown>;
  const email = typeof pedido.cliente_email === "string" ? pedido.cliente_email.trim().toLowerCase() : "";
  if (!email.includes("@")) return null;
  const frete = pedido.frete && typeof pedido.frete === "object" ? pedido.frete as Record<string, unknown> : {};
  const codigo = typeof pedido.codigo === "string" && /^[0-9]{9}$/.test(pedido.codigo) ? pedido.codigo : "";
  const rastreio = typeof pedido.rastreio === "string" ? pedido.rastreio : "";
  const quando = typeof pedido.pago_em === "string" && pedido.pago_em
    ? pedido.pago_em
    : typeof pedido.created_at === "string"
    ? pedido.created_at
    : "";
  return {
    evento: "pagamento_confirmado",
    codigo,
    nome: typeof pedido.cliente_nome === "string" ? pedido.cliente_nome : "",
    email,
    entrega_tipo: pedido.entrega_tipo === "retirada" ? "retirada" : "envio",
    itens: itensDe(pedido.itens),
    subtotal_centavos: centavos(pedido.subtotal_centavos),
    desconto_centavos: centavos(pedido.desconto_centavos),
    frete_centavos: centavos(pedido.frete_centavos),
    total_centavos: centavos(pedido.total_centavos),
    transportadora: typeof frete.transportadora === "string" ? frete.transportadora : "",
    servico: typeof frete.servico === "string" ? frete.servico : "",
    rastreio,
    quando,
  };
}

export async function enviarEmailCliente(
  pedidoId: string,
  evento: EventoEmail,
): Promise<"enviado" | "ja" | "pulado" | "falha"> {
  if (!UUID.test(pedidoId)) return "pulado";
  const cred = credenciaisSupabase();
  const smtp = lerSmtp({
    SMTP_HOST: Deno.env.get("SMTP_HOST"),
    SMTP_PORT: Deno.env.get("SMTP_PORT"),
    SMTP_USER: Deno.env.get("SMTP_USER"),
    SMTP_PASS: Deno.env.get("SMTP_PASS"),
  });
  if (!cred || !smtp) {
    console.warn("correio: SMTP ou supabase ausente, e-mail não enviado");
    return "pulado";
  }

  const reserva = await rpc(cred, "reservar_email_cliente", {
    p_pedido_id: pedidoId,
    p_evento: evento,
  });
  if (!reserva || reserva.ok !== true) return "falha";
  if (reserva.pode !== true) return reserva.ja === true ? "ja" : "pulado";

  const dados = await lerPedido(cred, pedidoId);
  if (!dados) {
    await rpc(cred, "liberar_email_cliente", { p_pedido_id: pedidoId, p_evento: evento });
    return "falha";
  }
  dados.evento = evento;

  try {
    const assunto = assuntoEmail(dados);
    await enviarSmtp(smtp, envelopeDe({
      to: dados.email,
      subject: assunto,
      text: textoEmail(dados),
      html: htmlEmail(dados),
    }));
  } catch (err) {
    console.error("correio: smtp", err instanceof Error ? err.message : "erro");
    await rpc(cred, "liberar_email_cliente", { p_pedido_id: pedidoId, p_evento: evento });
    return "falha";
  }

  const confirmado = await rpc(cred, "confirmar_email_cliente", {
    p_pedido_id: pedidoId,
    p_evento: evento,
  });
  if (!confirmado || confirmado.ok !== true) {
    console.error("correio: enviado, mas a reserva não fechou", pedidoId);
  }
  return "enviado";
}
