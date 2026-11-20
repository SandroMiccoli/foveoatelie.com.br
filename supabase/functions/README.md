# Pagamento — Mercado Pago Checkout Pro (Orders API)

A sacola deixa o WhatsApp só como contato. `criar-pedido` reserva o estoque, recota o frete e abre o checkout. `webhook-mercado-pago` marca o pedido como pago ou solta a reserva.

O checkout é `POST https://api.mercadopago.com/v1/orders` com `type: "online"` e `processing_mode: "manual"`, o modo do Checkout Pro nessa API. O header `X-Idempotency-Key` vai em toda criação. A resposta traz `checkout_url`, e o navegador redireciona para ela.

Documentação usada: [criar a order](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-orders/create-order), [URLs de retorno](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-orders/web-integration/configure-back-urls), [notificações](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-orders/notifications) e [webhooks](https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks).

O deploy fica com o Sandro. Daqui não se publica função, não se aplica migration e não se grava secret.

## Migration

Arquivos, nesta ordem, no SQL editor (só os que ainda não rodaram):

- `supabase/migrations/20261119100000_checkout_mercado_pago.sql`
- `supabase/migrations/20261119180000_pedido_codigo.sql`
- `supabase/migrations/20261119230000_admin_acesso.sql` (painel, etapa 1)
- `supabase/migrations/20261120060000_admin_pedidos_etapa2.sql` (painel, etapa 2)

O segundo acrescenta `pedidos.codigo` (`YYMMDDNNN`), preenche os pedidos que já existem e gera o próximo num gatilho. A sequência recomeça todo dia. A etapa 2 acrescenta histórico de status, CPF/notas opcionais, RPCs de cancelar/reembolsar/apagar teste e amplia os status do pedido.

As três migrations de 18/11/2026 já estão no projeto `foveo-loja` (`bbksditqlgdjftwowtje`) e não estão neste repositório. Por isso **não** use `supabase db push`: a CLI vê versões no remoto que não existem localmente e recusa. Abra o SQL editor do projeto e rode cada arquivo uma vez.

O que entra:

- colunas em `pedidos`: `mp_order_id`, `mp_status`, `mp_status_detail`, `mp_checkout_url`, `frete`, `idempotency_key`, `pago_em`
- `private.expirar_reservas()` solta reservas de pedidos `pendente` com `reserva_expira_em` vencido (30 minutos) e marca `expirado`
- `private.catalogo_rows()` passa a descontar só reserva ainda vigente, então a vitrine solta a vela mesmo antes da função de expirar rodar
- RPCs só para `service_role`: `reservar_pedido`, `registrar_order_mp`, `liberar_pedido`, `aplicar_retorno_mp`, `expirar_reservas`

`anon` continua sem leitura de `pedidos`. O preço do pedido é `calcular_preco_centavos` dentro de `reservar_pedido`. O frete que a função grava é o que `criar-pedido` acabou de cotar, não o número que o navegador mostrou.

## Secrets

Já existem: `MERCADO_PAGO_ACCESS_TOKEN` (teste), `MELHOR_ENVIO_TOKEN`, `MELHOR_ENVIO_BASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

Falta, quando for conferir a origem do webhook:

```bash
supabase secrets set MERCADO_PAGO_WEBHOOK_SECRET=<assinatura da aplicação> --project-ref bbksditqlgdjftwowtje
```

A assinatura sai em Suas integrações → a aplicação → Webhooks → Configurar notificações → assinatura secreta. Sem esse secret a função **aceita** o POST e escreve um aviso no log. Dá para testar o fluxo, e qualquer um que conheça a URL consegue fingir um pagamento. Antes de cobrar gente de verdade, grave o secret.

Quando um pedido passa a `pago` (só nessa transição), o webhook avisa o ateliê. Sem as duas variáveis abaixo, o aviso é pulado e o pagamento segue normal.

```bash
supabase secrets set GROKBOT_PEDIDO_WEBHOOK_URL=<url https do bot> --project-ref bbksditqlgdjftwowtje
supabase secrets set GROKBOT_PEDIDO_WEBHOOK_KEY=<chave> --project-ref bbksditqlgdjftwowtje
```

O POST leva `{"evento":"pedido_pago","pedido_id":"<uuid>","codigo":"261119005"}`, com `Authorization: Bearer` e `X-Automation-Key`. O `codigo` é `YYMMDDNNN`: dia do pedido em São Paulo e a ordem dele naquele dia. Uma tentativa, 8 segundos. Falha só vai pro log, sem a chave.

## Deploy

Na raiz do repositório, com a CLI autenticada:

```bash
supabase functions deploy criar-pedido --project-ref bbksditqlgdjftwowtje --no-verify-jwt

supabase functions deploy webhook-mercado-pago --project-ref bbksditqlgdjftwowtje --no-verify-jwt

supabase functions deploy consultar-pedido --project-ref bbksditqlgdjftwowtje --no-verify-jwt

# Painel: reembolso. JWT do usuário logado (verify_jwt = true).
supabase functions deploy reembolsar-pedido --project-ref bbksditqlgdjftwowtje
```

`--no-verify-jwt` está também em `supabase/config.toml` para as funções da sacola. A sacola manda a chave publishable, que não é um JWT. O Mercado Pago chama o webhook sem JWT. `reembolsar-pedido` exige JWT e confere `contato@foveoatelie.com.br`.

URLs:

- criar pedido: `https://bbksditqlgdjftwowtje.supabase.co/functions/v1/criar-pedido`
- webhook: `https://bbksditqlgdjftwowtje.supabase.co/functions/v1/webhook-mercado-pago`
- consultar pedido: `https://bbksditqlgdjftwowtje.supabase.co/functions/v1/consultar-pedido`
- reembolsar pedido: `https://bbksditqlgdjftwowtje.supabase.co/functions/v1/reembolsar-pedido`

## Webhook no painel

Em Suas integrações, na aplicação do Checkout Pro, modo Teste (e depois Produção, com outro token):

1. Webhooks → Configurar notificações.
2. URL: `https://bbksditqlgdjftwowtje.supabase.co/functions/v1/webhook-mercado-pago`
3. Evento **Order (Mercado Pago)**, tópico `order`. Não marque o tópico antigo de Pagamentos no lugar deste: o handler ignora o que não for `order`.
4. Salve e copie a assinatura para `MERCADO_PAGO_WEBHOOK_SECRET`.

A order também manda `config.online.callback_url` com essa mesma URL. No guia atual da Orders API a notificação de order se configura no painel; o `callback_url` é o campo de webhook por order no SDK atual (`config.online.callback_url`). As duas apontam para o mesmo lugar. URL configurada na criação tem prioridade sobre a do painel, segundo o guia de webhooks.

A função responde 200 em até 22 segundos. Assinatura inválida, com o secret definido, responde 401. O log dessa rejeição traz o `ts`, se veio `x-request-id`, o `data.id`, os manifestos tentados e os 8 primeiros caracteres do `v1` recebido e do calculado. A chave não entra no log.

A conferência segue o validador do SDK: manifesto `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`, HMAC-SHA256 em hex, comparado com `v1`. Se `data.id` tiver letra, tenta também a forma em minúsculas, porque o guia pede o id alfanumérico em minúsculo e o SDK atual usa o valor como chegou. O `ts` da Orders API vem em milissegundos (13 dígitos); o de pagamentos antigos vem em segundos. A janela é de 10 minutos.

## O que o comprador vê

Na sacola: nome, e-mail, WhatsApp e, se não for retirada em BH, o endereço. O CEP continua o da cotação. "Pagar com Mercado Pago" manda para o `checkout_url`.

Volta do checkout, com `auto_return: "all"`, em `/pedido/?pedido=<uuid>`. As rotas antigas (`/pedido/confirmado/`, `/pedido/recusado/`, `/pedido/pendente/`) mostram a mesma página. Ela chama `consultar-pedido`. Se o pedido ainda está `pendente` e já tem `mp_order_id`, a função busca a order no Mercado Pago com o token nosso e aplica o mesmo caminho do webhook, no máximo uma vez a cada 5 segundos por pedido. A sacola do navegador só some quando o status é `pago`.

- `pago`: "Pagamento aprovado", o primeiro nome, o resumo e a quarta-feira da postagem. O botão abre o WhatsApp da Foveō com o código do pedido (`YYMMDDNNN`, por exemplo #261119005). O link da página continua com o UUID.
- `pendente`: "Pagamento em análise", o resumo, o aviso de que Pix e cartão podem levar alguns minutos e que a página atualiza sozinha. A consulta automática dura cerca de 1 minuto. "Conferir pagamento de novo" e o WhatsApp (com o número do pedido e "pagamento em análise") continuam na tela. Cartão recusado com a order ainda aberta (`action_required` / `waiting_retry`, ou o último pagamento `rejected`/`failed`) continua `pendente` no banco, para a reserva valer, e a página mostra "Pagamento não aprovado" com "Tentar pagar de novo" enquanto `reserva_expira_em` não venceu. Pix em `waiting_payment` segue em análise. `failed`, `expired` e `canceled` soltam a reserva como antes.
- `recusado`, `expirado` ou `cancelado`: a sacola fica. Tem o link de volta pra ela e o WhatsApp.

O fechamento é sexta à noite, no fuso de São Paulo. A postagem é a quarta da semana seguinte (sexta + 5 dias). Sábado e domingo entram na outra semana. Quinta 19/11/2026 posta em 25/11. Sábado 21/11 posta em 02/12. A data usa `pago_em`, ou `created_at` se o pagamento ainda não tiver hora. Retirada em BH usa a mesma quarta, pra combinar pelo WhatsApp.

Quem baixa o estoque é o webhook, depois de `GET /v1/orders/{id}`. A reserva dura 30 minutos (`expiration_time: PT30M` na order, `reserva_expira_em` no banco). Se o Mercado Pago recusar `PT30M`, o log da função mostra o código do erro; nesse caso troque a constante em `criar-pedido/index.ts` para `P1D` e saiba que o link de pagamento passa a durar mais que a reserva.

Pedido pago com a reserva já expirada e o estoque vendido de novo fica com `mp_status = processed` e `status` ainda `expirado` ou `cancelado`. Aí o estorno é manual.

## Teste de ponta a ponta

Use credenciais de **teste** (`MERCADO_PAGO_ACCESS_TOKEN` de teste, prefixo `APP_USR` da conta de teste). Cartão real não passa nesse token.

1. Aplique a migration (se ainda não rodou) e publique `criar-pedido`, `webhook-mercado-pago` e `consultar-pedido`.
2. No site de staging (`https://dev.foveoatelie.com.br`), ponha uma vela na sacola, calcule o frete ou escolha "Retirar em BH (combinar)", preencha os dados e pague.
3. Entre no checkout com a conta de **teste comprador** da aplicação (Suas integrações → Contas de teste → Comprador). O login de teste pede o código de 6 dígitos que aparece nessa mesma tela. Não use a conta vendedora para pagar.
4. Cartões de teste, CVV 123, validade 11/30. O resultado sai do nome do titular, não do número:

| Resultado | Titular | Documento |
| --- | --- | --- |
| Aprovado | `APRO` | CPF `12345678909` |
| Recusado | `OTHE` | CPF `12345678909` |
| Pendente | `CONT` | — |

Números: Mastercard `5480 8328 0103 3311`, Visa `4235 6477 2802 5682`. A lista inteira está em [cartões de teste](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/test-cards) e o passo a passo da compra em [compra de teste](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/integration-test/test-purchases).

5. Com `APRO`, a volta é `/pedido/`, a página mostra "Pagamento aprovado" depois que o webhook marca `pago`, e a sacola esvazia. `disponivel` e `reservado` descem. Com `OTHE`, o status fica `recusado`, a página avisa e a sacola continua. Com `CONT`, fica "Pagamento em análise" e a página pergunta de novo por até um minuto.
6. Dá para simular o webhook no painel (Simular notificação, evento de order, o `data.id` da order). Sem o secret, a função processa mesmo assim. Com o secret, a simulação do painel precisa bater a assinatura.

O preço na tela é só exibição. Um real a menos no JSON do navegador não muda o que o Mercado Pago cobra: `reservar_pedido` chama `calcular_preco_centavos` (1 = R$ 60, 2 = R$ 110, 3 = R$ 150, e o resto segue a tabela) e a cotação de frete roda de novo no servidor.
