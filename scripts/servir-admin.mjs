// Servidor local com as mesmas rotas do netlify.toml.
// node scripts/servir-admin.mjs

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = fileURLToPath(new URL("../admin/", import.meta.url));
const porta = Number(process.env.PORT) || 4173;
const tipos = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
};
const rotas = new Set(["/", "/entrar", "/pedidos", "/estoque", "/clientes", "/avisos"]);

function arquivoDe(pathname) {
  let caminho = decodeURIComponent(pathname);
  if (caminho.length > 1 && caminho.endsWith("/")) caminho = caminho.slice(0, -1);
  if (rotas.has(caminho)) return "/index.html";
  return caminho;
}

createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const relativo = arquivoDe(url.pathname).replace(/^\/+/, "");
  if (relativo.includes("\0") || relativo.split("/").includes("..")) {
    res.writeHead(400);
    res.end();
    return;
  }
  const cheio = normalize(join(raiz, relativo));
  if (!cheio.startsWith(raiz)) {
    res.writeHead(400);
    res.end();
    return;
  }
  try {
    const dados = await readFile(cheio);
    const tipo = tipos[extname(cheio)] || "application/octet-stream";
    res.writeHead(200, { "content-type": tipo, "cache-control": "no-cache" });
    res.end(dados);
  } catch (_err) {
    const pagina = await readFile(join(raiz, "404.html"));
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    res.end(pagina);
  }
}).listen(porta, "127.0.0.1", () => {
  process.stdout.write("http://127.0.0.1:" + porta + "\n");
});
