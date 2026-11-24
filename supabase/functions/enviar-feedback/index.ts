// Recebe o formulário /feedback/. A chave publishable não é um JWT,
// por isso verify_jwt fica false no config.toml. Quem grava é a
// service role, dentro de enviar_feedback, com limite por IP.
// O aviso reusa registrar_aviso e o webhook que já existe.

import { registrarAviso } from "../_shared/avisos.ts";
import {
  camposDoFormulario,
  detalheFeedback,
  hashIp,
  honeypotCheio,
  ipCliente,
  lerFeedback,
  mensagemFeedback,
} from "../_shared/feedback.ts";
import { cabecalhosCors, json, origemDoPedido, origemPermitida } from "../_shared/http.ts";

const LIMITE_CORPO = 20000;
const SITE = "https://foveoatelie.com.br";

type Cred = { url: string; key: string };

function credenciais(): Cred | null {
  const url = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  const key = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  if (!url || !key) return null;
  return { url, key };
}

function formulario(req: Request): boolean {
  const tipo = (req.headers.get("content-type") || "").toLowerCase();
  return tipo.includes("application/x-www-form-urlencoded");
}

function origemSegura(origin: string | null, referer: string | null): string {
  if (origin && origemPermitida(origin)) return origin.replace(/\/+$/, "");
  if (referer) {
    try {
      const url = new URL(referer);
      const base = url.origin;
      if (origemPermitida(base)) return base;
    } catch (_err) {
      return SITE;
    }
  }
  return SITE;
}

function destinoObrigado(origin: string | null, referer: string | null): string {
  return origemSegura(origin, referer) + "/feedback/obrigado/";
}

function destinoFormulario(origin: string | null, referer: string | null): string {
  return origemSegura(origin, referer) + "/feedback/";
}

function escapar(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pagina(origin: string | null, referer: string | null, status: number, mensagem: string): Response {
  const volta = destinoFormulario(origin, referer);
  const html = "<!DOCTYPE html><html lang=\"pt-BR\"><meta charset=\"utf-8\">" +
    "<meta name=\"robots\" content=\"noindex\"><title>Feedback — Foveō</title>" +
    "<p>" + escapar(mensagem) + "</p>" +
    "<p><a href=\"" + escapar(volta) + "\">Voltar ao formulário</a></p></html>";
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex" },
  });
}

function falha(
  req: Request,
  origin: string | null,
  status: number,
  erro: string,
  mensagem: string,
): Response {
  if (formulario(req)) return pagina(origin, req.headers.get("Referer"), status, mensagem);
  return json(origin, status, { ok: false, erro });
}

function sucesso(req: Request, origin: string | null): Response {
  if (formulario(req)) {
    return new Response(null, {
      status: 303,
      headers: { Location: destinoObrigado(origin, req.headers.get("Referer")) },
    });
  }
  return json(origin, 200, { ok: true });
}

const FRASE: Record<string, string> = {
  invalido: "Confira as respostas e tente de novo.",
  longo: "Um dos textos passou do limite. Encurta um pouco e tenta de novo.",
  taxa: "Muitas respostas seguidas. Espere um pouco e tente de novo.",
  indisponivel: "Não consegui enviar agora. Tente de novo em instantes.",
};

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
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    console.error("feedback: rpc", err instanceof Error ? err.name : "erro");
    return null;
  }
  if (!res.ok) {
    console.error("feedback: rpc", res.status);
    return null;
  }
  try {
    const data = await res.json();
    return data && typeof data === "object" ? data as Record<string, unknown> : null;
  } catch (_err) {
    return null;
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cabecalhosCors(origin) });
  }
  if (req.method !== "POST") return json(origin, 405, { ok: false, erro: "metodo" });
  if (origin && !origemPermitida(origin)) return json(origin, 403, { ok: false, erro: "origem" });

  const cred = credenciais();
  if (!cred) return falha(req, origin, 503, "indisponivel", FRASE.indisponivel);

  let bruto = "";
  try {
    bruto = await req.text();
  } catch (_err) {
    return falha(req, origin, 400, "invalido", FRASE.invalido);
  }
  if (bruto.length > LIMITE_CORPO) return falha(req, origin, 400, "longo", FRASE.longo);

  let corpo: unknown;
  if (formulario(req)) {
    corpo = camposDoFormulario(bruto);
  } else {
    try {
      corpo = JSON.parse(bruto);
    } catch (_err) {
      return falha(req, origin, 400, "invalido", FRASE.invalido);
    }
  }

  if (honeypotCheio(corpo)) return sucesso(req, origin);

  const leitura = lerFeedback(corpo);
  if (!leitura.ok) {
    const erro = leitura.erro;
    return falha(req, origin, 400, erro, FRASE[erro] || FRASE.invalido);
  }

  const ip = ipCliente(req.headers);
  const ipHash = await hashIp(ip || "sem-ip");
  const ua = (req.headers.get("user-agent") || "").trim().slice(0, 300);
  const source = origemDoPedido(origin).replace(/^https:\/\//, "").slice(0, 80);
  const feedback = leitura.feedback;
  const payload: Record<string, unknown> = {
    candles: feedback.candles,
    rating: feedback.rating,
    sensacao: feedback.sensacao,
    mudaria: feedback.mudaria,
    depoimento: feedback.depoimento,
    instagram_share: feedback.instagram_share,
    novidades: feedback.novidades,
    nome: feedback.nome,
    contato: feedback.contato,
    user_agent: ua,
    source,
    ip_hash: ipHash,
  };
  if (feedback.contato_novo) {
    payload.nome_completo = feedback.nome_completo;
    payload.whatsapp = feedback.whatsapp;
    payload.email = feedback.email;
  }

  const gravou = await rpc(cred, "enviar_feedback", { p_payload: payload });

  if (!gravou || gravou.ok !== true) {
    const erro = gravou && typeof gravou.erro === "string" ? gravou.erro : "indisponivel";
    if (erro === "taxa") return falha(req, origin, 429, "taxa", FRASE.taxa);
    if (erro === "longo") return falha(req, origin, 400, "longo", FRASE.longo);
    if (erro === "invalido") return falha(req, origin, 400, "invalido", FRASE.invalido);
    return falha(req, origin, 503, "indisponivel", FRASE.indisponivel);
  }

  const id = typeof gravou.id === "string" ? gravou.id : "";
  if (id) {
    try {
      await registrarAviso({
        tipo: "feedback_novo",
        chave: id,
        mensagem: mensagemFeedback(feedback),
        detalhe: detalheFeedback(feedback),
      });
    } catch (err) {
      console.error("feedback: aviso", err instanceof Error ? err.name : "erro");
    }
  }

  return sucesso(req, origin);
});
