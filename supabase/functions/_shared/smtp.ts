// SMTP mínimo para o Gmail (465 implícito ou 587 com STARTTLS).
// A senha não entra em log. Os testes não abrem socket.

import { mensagemData } from "./correio.ts";

export type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
};

export function lerSmtp(env: Record<string, string | undefined>): SmtpConfig | null {
  const host = (env.SMTP_HOST ?? "").trim();
  const user = (env.SMTP_USER ?? "").trim();
  const pass = env.SMTP_PASS ?? "";
  const porta = Number((env.SMTP_PORT ?? "").trim());
  if (!host || !user || !pass) return null;
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) return null;
  if (!/^[A-Za-z0-9.-]+$/.test(host)) return null;
  return { host, port: porta, user, pass };
}

export const SMTP_IO_MS = 8000;

export function ioComPrazo<T>(trabalho: Promise<T>, ms: number, fechar: () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let terminou = false;
    const timer = setTimeout(() => {
      if (terminou) return;
      terminou = true;
      try {
        fechar();
      } catch (_err) {
        // O socket já pode ter caído.
      }
      reject(new Error("smtp_timeout"));
    }, ms);
    trabalho.then((valor) => {
      if (terminou) return;
      terminou = true;
      clearTimeout(timer);
      resolve(valor);
    }, (err) => {
      if (terminou) return;
      terminou = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

export function abrirComPrazo<T extends { close: () => void }>(abrir: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    let socket: T | undefined;
    let terminou = false;
    const timer = setTimeout(() => {
      if (terminou) return;
      terminou = true;
      try {
        socket?.close();
      } catch (_err) {
        // Ainda não abriu.
      }
      reject(new Error("smtp_timeout"));
    }, ms);
    abrir.then((aberto) => {
      socket = aberto;
      if (terminou) {
        try {
          aberto.close();
        } catch (_err) {
          // Já fechou no prazo.
        }
        return;
      }
      terminou = true;
      clearTimeout(timer);
      resolve(aberto);
    }, (err) => {
      if (terminou) return;
      terminou = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function conectarTls(cfg: SmtpConfig): Promise<Deno.TlsConn> {
  return await abrirComPrazo(Deno.connectTls({ hostname: cfg.host, port: cfg.port }), SMTP_IO_MS);
}

async function conectarTcp(cfg: SmtpConfig): Promise<Deno.TcpConn> {
  return await abrirComPrazo(Deno.connect({ hostname: cfg.host, port: cfg.port }), SMTP_IO_MS);
}

async function escreverTudo(socket: Deno.Conn, dados: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < dados.byteLength) {
    const n = await ioComPrazo(
      socket.write(dados.subarray(offset)),
      SMTP_IO_MS,
      () => socket.close(),
    );
    if (!Number.isInteger(n) || n <= 0) throw new Error("smtp_timeout");
    offset += n;
  }
}

function criarLeitor(socket: Deno.Conn) {
  const decoder = new TextDecoder();
  let resto = "";
  return async function ler(): Promise<string> {
    for (let i = 0; i < 8; i++) {
      const corte = resto.indexOf("\r\n");
      if (corte >= 0) {
        const linha = resto.slice(0, corte);
        resto = resto.slice(corte + 2);
        return linha;
      }
      const buf = new Uint8Array(1024);
      const n = await ioComPrazo(socket.read(buf), SMTP_IO_MS, () => socket.close());
      if (n == null) break;
      resto += decoder.decode(buf.subarray(0, n));
    }
    throw new Error("smtp_timeout");
  };
}

async function comando(ler: () => Promise<string>, socket: Deno.Conn, linha: string | null): Promise<string> {
  if (linha != null) {
    await escreverTudo(socket, new TextEncoder().encode(linha + "\r\n"));
  }
  let ultima = "";
  for (let i = 0; i < 40; i++) {
    ultima = await ler();
    if (/^\d{3} /.test(ultima)) return ultima;
  }
  return ultima;
}

function codigo(resposta: string): number {
  const n = Number(resposta.slice(0, 3));
  return Number.isInteger(n) ? n : 0;
}

export async function enviarSmtp(
  cfg: SmtpConfig,
  mensagem: { from: string; to: string; data: string },
): Promise<void> {
  let socket: Deno.Conn | null = null;
  try {
    let ler: () => Promise<string>;
    if (cfg.port === 465) {
      socket = await conectarTls(cfg);
      ler = criarLeitor(socket);
      const saudacao = await comando(ler, socket, null);
      if (codigo(saudacao) !== 220) throw new Error("smtp_saudacao");
    } else {
      const cru = await conectarTcp(cfg);
      socket = cru;
      ler = criarLeitor(cru);
      const saudacao = await comando(ler, cru, null);
      if (codigo(saudacao) !== 220) throw new Error("smtp_saudacao");
      const ehloTcp = await comando(ler, cru, "EHLO foveoatelie.com.br");
      if (codigo(ehloTcp) !== 250) throw new Error("smtp_ehlo");
      const start = await comando(ler, cru, "STARTTLS");
      if (codigo(start) !== 220) throw new Error("smtp_starttls");
      socket = await Deno.startTls(cru, { hostname: cfg.host });
      ler = criarLeitor(socket);
    }
    const ehlo = await comando(ler, socket, "EHLO foveoatelie.com.br");
    if (codigo(ehlo) !== 250) throw new Error("smtp_ehlo");
    const auth = await comando(ler, socket, "AUTH LOGIN");
    if (codigo(auth) !== 334) throw new Error("smtp_auth");
    const user = await comando(ler, socket, btoa(cfg.user));
    if (codigo(user) !== 334) throw new Error("smtp_auth");
    const pass = await comando(ler, socket, btoa(cfg.pass));
    if (codigo(pass) !== 235) throw new Error("smtp_auth");
    const from = await comando(ler, socket, "MAIL FROM:<" + mensagem.from + ">");
    if (codigo(from) !== 250) throw new Error("smtp_from");
    const rcpt = await comando(ler, socket, "RCPT TO:<" + mensagem.to + ">");
    if (codigo(rcpt) !== 250 && codigo(rcpt) !== 251) throw new Error("smtp_rcpt");
    const data = await comando(ler, socket, "DATA");
    if (codigo(data) !== 354) throw new Error("smtp_data");
    await escreverTudo(socket, new TextEncoder().encode(mensagem.data + "\r\n.\r\n"));
    const fim = await comando(ler, socket, null);
    if (codigo(fim) !== 250) throw new Error("smtp_envio");
    await comando(ler, socket, "QUIT");
  } finally {
    try {
      socket?.close();
    } catch (_err) {
      // Já fechou.
    }
  }
}

export const REMETENTE_EMAIL = "contato@foveoatelie.com.br";
export const REMETENTE_NOME = "Foveō Ateliê";

export function envelopeDe(dados: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): { from: string; to: string; data: string } {
  return {
    from: REMETENTE_EMAIL,
    to: dados.to,
    data: mensagemData({
      fromName: REMETENTE_NOME,
      from: REMETENTE_EMAIL,
      to: dados.to,
      replyTo: REMETENTE_EMAIL,
      subject: dados.subject,
      text: dados.text,
      html: dados.html,
    }),
  };
}
