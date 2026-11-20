// E-mail da cliente. O HTML é puro; o SMTP fica em smtp.ts.
// Um evento por pedido: pagamento confirmado, enviado, entregue, pronto para retirada.

import { linkRastreio, type EventoEmail } from "./etiquetas.ts";
import { centavosParaReais } from "./pedido.ts";

export type ItemEmail = { nome: string; qtd: number; preco_unitario_centavos: number };

export type DadosEmail = {
  evento: EventoEmail;
  codigo: string;
  nome: string;
  email: string;
  entrega_tipo: "envio" | "retirada";
  itens: ItemEmail[];
  subtotal_centavos: number;
  desconto_centavos: number;
  frete_centavos: number;
  total_centavos: number;
  transportadora: string;
  servico: string;
  rastreio: string;
};

const COR = {
  fundo: "#0e0b09",
  papel: "#ede6d9",
  baço: "#c9c0b1",
  cobre: "#c87431",
};

export function primeiroNomeEmail(nome: string): string {
  const parte = nome.trim().split(/\s+/).filter(Boolean)[0] ?? "";
  if (!parte) return "";
  return parte.charAt(0).toLocaleUpperCase("pt-BR") + parte.slice(1).toLocaleLowerCase("pt-BR");
}

export function reaisEmail(centavos: number): string {
  const texto = centavosParaReais(Math.max(0, Math.round(centavos)));
  const [reais, cents] = texto.split(".");
  const comPonto = reais.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return "R$ " + comPonto + "," + cents;
}

function escapar(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function assuntoEmail(dados: DadosEmail): string {
  const codigo = dados.codigo ? " #" + dados.codigo : "";
  if (dados.evento === "pagamento_confirmado") return "Pagamento confirmado — pedido" + codigo;
  if (dados.evento === "enviado") return "Pedido" + codigo + " a caminho";
  if (dados.evento === "entregue") return "Pedido" + codigo + " entregue";
  return "Pedido" + codigo + " pronto para retirada";
}

export function textoEmail(dados: DadosEmail): string {
  const nome = primeiroNomeEmail(dados.nome);
  const ola = nome ? "Olá, " + nome + "." : "Olá.";
  const codigo = dados.codigo || "seu pedido";
  const linhas = [ola, ""];
  if (dados.evento === "pagamento_confirmado") {
    linhas.push("Recebemos o pagamento do pedido " + codigo + ".");
    linhas.push("");
    for (const item of dados.itens) {
      linhas.push(item.qtd + " × " + item.nome + " — " + reaisEmail(item.preco_unitario_centavos * item.qtd));
    }
    if (dados.desconto_centavos > 0) linhas.push("Desconto do combo: " + reaisEmail(dados.desconto_centavos));
    const frete = dados.entrega_tipo === "retirada"
      ? "Retirada em BH"
      : [dados.transportadora, dados.servico].filter(Boolean).join(" ") || "Envio";
    linhas.push("Frete: " + frete + " — " + (dados.frete_centavos > 0 ? reaisEmail(dados.frete_centavos) : "grátis"));
    linhas.push("Total: " + reaisEmail(dados.total_centavos));
    linhas.push("");
    linhas.push("A postagem sai na quarta-feira. O código de rastreio chega neste e-mail.");
  } else if (dados.evento === "enviado") {
    linhas.push("O pedido " + codigo + " foi postado.");
    if (dados.rastreio) {
      linhas.push("Rastreio: " + dados.rastreio);
      const link = linkRastreio(dados.transportadora, dados.rastreio);
      if (link) linhas.push(link);
    }
  } else if (dados.evento === "entregue") {
    linhas.push("O pedido " + codigo + " foi entregue.");
    linhas.push("Esperamos que as velas encontrem um canto bom na casa.");
  } else {
    linhas.push("O pedido " + codigo + " está pronto para retirada em Belo Horizonte.");
    linhas.push("Combina o horário pelo WhatsApp da Foveō.");
  }
  linhas.push("");
  linhas.push("Foveō Ateliê");
  linhas.push("contato@foveoatelie.com.br");
  return linhas.join("\n");
}

function linhaHtml(rotulo: string, valor: string, destaque = false): string {
  const peso = destaque ? "500" : "400";
  const cor = destaque ? COR.papel : COR.baço;
  return (
    "<tr><td style=\"padding:6px 0;color:" + COR.baço + ";font-family:Georgia,serif;\">" +
    escapar(rotulo) +
    "</td><td style=\"padding:6px 0;text-align:right;color:" + cor + ";font-weight:" + peso +
    ";font-family:Arial,Helvetica,sans-serif;\">" + escapar(valor) + "</td></tr>"
  );
}

export function htmlEmail(dados: DadosEmail): string {
  const nome = primeiroNomeEmail(dados.nome);
  const ola = nome ? "Olá, " + nome + "." : "Olá.";
  const codigo = dados.codigo ? "#" + dados.codigo : "seu pedido";
  let miolo = "";
  if (dados.evento === "pagamento_confirmado") {
    miolo += "<p style=\"margin:0 0 16px;color:" + COR.papel + ";font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;\">" +
      escapar(ola) + " Recebemos o pagamento do pedido " + escapar(codigo) + ".</p>";
    let tabela = "";
    for (const item of dados.itens) {
      tabela += linhaHtml(item.qtd + " × " + item.nome, reaisEmail(item.preco_unitario_centavos * item.qtd));
    }
    tabela += linhaHtml("Subtotal", reaisEmail(dados.subtotal_centavos));
    if (dados.desconto_centavos > 0) tabela += linhaHtml("Desconto do combo", reaisEmail(dados.desconto_centavos));
    const freteNome = dados.entrega_tipo === "retirada"
      ? "Retirada em BH"
      : [dados.transportadora, dados.servico].filter(Boolean).join(" · ") || "Envio";
    tabela += linhaHtml(freteNome, dados.frete_centavos > 0 ? reaisEmail(dados.frete_centavos) : "Grátis");
    tabela += linhaHtml("Total", reaisEmail(dados.total_centavos), true);
    miolo += "<table role=\"presentation\" width=\"100%\" style=\"border-collapse:collapse;margin:8px 0 16px;\">" + tabela + "</table>";
    miolo += "<p style=\"margin:0;color:" + COR.baço + ";font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;\">A postagem sai na quarta-feira. O código de rastreio chega neste e-mail.</p>";
  } else if (dados.evento === "enviado") {
    const link = dados.rastreio ? linkRastreio(dados.transportadora, dados.rastreio) : null;
    miolo += "<p style=\"margin:0 0 12px;color:" + COR.papel + ";font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;\">" +
      escapar(ola) + " O pedido " + escapar(codigo) + " foi postado.</p>";
    if (dados.rastreio) {
      miolo += "<p style=\"margin:0 0 12px;color:" + COR.papel + ";font-family:Arial,Helvetica,sans-serif;font-size:16px;\">Rastreio <strong style=\"letter-spacing:0.04em;\">" +
        escapar(dados.rastreio) + "</strong></p>";
    }
    if (link) {
      miolo += "<p style=\"margin:16px 0 0;\"><a href=\"" + escapar(link) + "\" style=\"color:" + COR.cobre +
        ";font-family:Arial,Helvetica,sans-serif;font-size:15px;\">Acompanhar na transportadora</a></p>";
    }
  } else if (dados.evento === "entregue") {
    miolo += "<p style=\"margin:0 0 12px;color:" + COR.papel + ";font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;\">" +
      escapar(ola) + " O pedido " + escapar(codigo) + " foi entregue.</p>";
    miolo += "<p style=\"margin:0;color:" + COR.baço + ";font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;\">Esperamos que as velas encontrem um canto bom na casa.</p>";
  } else {
    miolo += "<p style=\"margin:0 0 12px;color:" + COR.papel + ";font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;\">" +
      escapar(ola) + " O pedido " + escapar(codigo) + " está pronto para retirada em Belo Horizonte.</p>";
    miolo += "<p style=\"margin:0;color:" + COR.baço + ";font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;\">Combina o horário pelo WhatsApp da Foveō.</p>";
  }

  return "<!DOCTYPE html><html lang=\"pt-BR\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>" +
    escapar(assuntoEmail(dados)) + "</title></head><body style=\"margin:0;padding:0;background:" + COR.fundo + ";\">" +
    "<table role=\"presentation\" width=\"100%\" style=\"background:" + COR.fundo + ";\"><tr><td align=\"center\" style=\"padding:32px 16px;\">" +
    "<table role=\"presentation\" width=\"100%\" style=\"max-width:480px;\">" +
    "<tr><td style=\"padding:0 0 18px;color:" + COR.cobre + ";font-family:Georgia,'Times New Roman',serif;font-size:28px;font-style:italic;\">Foveō</td></tr>" +
    "<tr><td style=\"border-top:1px solid " + COR.cobre + ";padding-top:22px;\">" + miolo + "</td></tr>" +
    "<tr><td style=\"padding-top:28px;color:" + COR.baço + ";font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;\">Foveō Ateliê<br>contato@foveoatelie.com.br</td></tr>" +
    "</table></td></tr></table></body></html>";
}

export function eventoCompativel(evento: string, status: string, entrega: string): boolean {
  if (evento === "pagamento_confirmado") {
    return ["pago", "etiqueta_gerada", "enviado", "entregue", "pronto_retirada", "retirado"].includes(status);
  }
  if (evento === "enviado") return entrega === "envio" && (status === "enviado" || status === "entregue");
  if (evento === "entregue") return entrega === "envio" && status === "entregue";
  if (evento === "pronto_retirada") {
    return entrega === "retirada" && (status === "pronto_retirada" || status === "retirado");
  }
  return false;
}

export function codificarAssunto(assunto: string): string {
  const bytes = new TextEncoder().encode(assunto);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return "=?UTF-8?B?" + btoa(bin) + "?=";
}

export function codificarNome(nome: string): string {
  if (/^[\x20-\x7E]*$/.test(nome) && !nome.includes("\"")) return "\"" + nome + "\"";
  return codificarAssunto(nome);
}

export function mensagemData(opts: {
  fromName: string;
  from: string;
  to: string;
  replyTo: string;
  subject: string;
  text: string;
  html: string;
}): string {
  const fronteira = "foveo_" + [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const linhas = [
    "From: " + codificarNome(opts.fromName) + " <" + opts.from + ">",
    "To: <" + opts.to + ">",
    "Reply-To: <" + opts.replyTo + ">",
    "Subject: " + codificarAssunto(opts.subject),
    "MIME-Version: 1.0",
    "Content-Type: multipart/alternative; boundary=\"" + fronteira + "\"",
    "",
    "--" + fronteira,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    opts.text,
    "",
    "--" + fronteira,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    opts.html,
    "",
    "--" + fronteira + "--",
    "",
  ];
  return linhas.join("\r\n").split("\r\n").map((linha) => linha.startsWith(".") ? "." + linha : linha).join("\r\n");
}
