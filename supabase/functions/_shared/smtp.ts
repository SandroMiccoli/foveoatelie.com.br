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

type Socket = {
  read: (p: Uint8Array) => Promise<number | null>;
  write: (p: Uint8Array) => Promise<number>;
  close: () => void;
};

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

export function abrirComPrazo(abrir: Promise<Socket>, ms: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    let socket: Socket | undefined;
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

async function conectar(cfg: SmtpConfig): Promise<Socket> {
  const abrir = cfg.port === 465
    ? Deno.connectTls({ hostname: cfg.host, port: cfg.port })
    : Deno.connect({ hostname: cfg.host, port: cfg.port });
  return await abrirComPrazo(abrir, SMTP_IO_MS);
}

function criarLeitor(socket: Socket) {
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

async function comando(ler: () => Promise<string>, socket: Socket, linha: string | null): Promise<string> {
  if (linha != null) {
    await ioComPrazo(
      socket.write(new TextEncoder().encode(linha + "\r\n")),
      SMTP_IO_MS,
      () => socket.close(),
    );
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
  let socket = await conectar(cfg);
  let ler = criarLeitor(socket);
  try {
    const saudacao = await comando(ler, socket, null);
    if (codigo(saudacao) !== 220) throw new Error("smtp_saudacao");
    let ehlo = await comando(ler, socket, "EHLO foveoatelie.com.br");
    if (codigo(ehlo) !== 250) throw new Error("smtp_ehlo");
    if (cfg.port !== 465) {
      const start = await comando(ler, socket, "STARTTLS");
      if (codigo(start) !== 220) throw new Error("smtp_starttls");
      const cru = socket as Deno.Conn;
      socket = await Deno.startTls(cru, { hostname: cfg.host });
      ler = criarLeitor(socket);
      ehlo = await comando(ler, socket, "EHLO foveoatelie.com.br");
      if (codigo(ehlo) !== 250) throw new Error("smtp_ehlo");
    }
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
    await ioComPrazo(
      socket.write(new TextEncoder().encode(mensagem.data + "\r\n.\r\n")),
      SMTP_IO_MS,
      () => socket.close(),
    );
    const fim = await comando(ler, socket, null);
    if (codigo(fim) !== 250) throw new Error("smtp_envio");
    await comando(ler, socket, "QUIT");
  } finally {
    try {
      socket.close();
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
