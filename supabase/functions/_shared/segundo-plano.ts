// Continua o trabalho depois da resposta. No Edge, waitUntil segura o isolate.
// Fora dele, a promise segue sozinha e o erro não derruba o pedido.

export function emSegundoPlano(trabalho: Promise<unknown>): void {
  const seguro = trabalho.catch((err) => {
    console.error("segundo plano", err instanceof Error ? err.name : "erro");
  });
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (typeof runtime?.waitUntil === "function") runtime.waitUntil(seguro);
}

