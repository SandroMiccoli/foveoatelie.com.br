# cotar-frete

Cota o frete da sacola no Melhor Envio. A função ainda não está publicada e os secrets ainda não existem: o deploy fica com o Sandro.

O navegador manda `{ cep_destino, itens: [{ produto_id, qtd }] }`. A função confere os ids na tabela `produtos` (a RLS fecha essa tabela para `anon`), chama `calcular_preco_centavos` para o valor declarado e pede `POST /api/v2/me/shipment/calculate`. A cotação em si está em `supabase/functions/_shared/frete.ts`, porque `criar-pedido` recota com as mesmas regras.

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já entram no ambiente da função. Não é preciso gravá-los de novo.

## Secrets

- `MELHOR_ENVIO_TOKEN` — token da API
- `MELHOR_ENVIO_BASE_URL` — opcional. Sem este secret a função usa `https://melhorenvio.com.br`. Sandbox: `https://sandbox.melhorenvio.com.br`

## Deploy

Na raiz do repositório, com a CLI autenticada:

```bash
supabase secrets set MELHOR_ENVIO_TOKEN=<token> MELHOR_ENVIO_BASE_URL=https://melhorenvio.com.br --project-ref bbksditqlgdjftwowtje

supabase functions deploy cotar-frete --project-ref bbksditqlgdjftwowtje --no-verify-jwt
```

`--no-verify-jwt` deixa a cotação pública. O mesmo está em `supabase/config.toml`.

## Constantes

No topo de `index.ts`: CEP de origem `31030-285`, embalagem 10 × 15 cm, altura 6 cm (estimativa), 0,12 kg por vela e 0,05 kg de embalagem. `VELAS_POR_PACOTE = 0` manda o pedido inteiro num pacote só, e o peso fica `qtd × 0,12 + 0,05`. Quando a capacidade da caixa estiver definida, troque esse número.

Os Correios costumam recusar caixa menor que 16 × 11 × 2 cm. Com 10 × 15 a cotação pode voltar vazia até a medida real entrar nas constantes.
