// Uma vez por dia: renova o token do Melhor Envio se faltar menos de 7
// dias (ou se expires_at estiver nulo), confere o saldo e manda os avisos
// que ainda não saíram. Só a service role. O gateway tem de estar com
// verify_jwt = true: papelDoJwt não confere a assinatura. O pg_cron chama
// com o JWT guardado no vault.

import { despacharAvisosPendentes, papelDoJwt, registrarSaldoBaixo } from "../_shared/avisos.ts";
import { saldoCentavos } from "../_shared/etiquetas.ts";
import { baseUrlMelhorEnvio } from "../_shared/frete.ts";
import { chamarMelhorEnvio, tokenMelhorEnvio } from "../_shared/token-me.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response(null, { status: 405 });

  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (papelDoJwt(jwt) !== "service_role") return new Response(null, { status: 401 });

  const token = await tokenMelhorEnvio({ agendado: true });
  let saldo: number | null = null;
  const base = baseUrlMelhorEnvio();
  if (token && base) {
    try {
      const res = await chamarMelhorEnvio(`${base}/api/v2/me/balance`, { method: "GET" });
      if (res && res.ok) {
        saldo = saldoCentavos(await res.json());
        if (saldo != null) await registrarSaldoBaixo(saldo);
      }
    } catch (err) {
      console.error("manutencao: saldo", err instanceof Error ? err.name : "erro");
    }
  }

  const enviados = await despacharAvisosPendentes();
  return Response.json({
    ok: true,
    token: Boolean(token),
    saldo_centavos: saldo,
    enviados,
  });
});
