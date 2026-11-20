# Foveō Ateliê — painel

O branch `admin` é o painel da loja, em admin.foveoatelie.com.br. A vitrine continua no branch `main`.

HTML, CSS e JavaScript em `admin/`. Sem build. A Netlify publica a pasta `admin`.

## Local

```bash
node scripts/servir-admin.mjs
```

Abra http://127.0.0.1:4173

## Banco

A etapa 4 acrescenta funções de etiqueta, webhook do Melhor Envio, e-mail e rastreio. O deploy continua manual: ver `supabase/functions/README.md`. Migrations novas ficam em `supabase/migrations/` e rodam no SQL editor do projeto foveo-loja. Não usar `supabase db push`.

A página pública de rastreio está em `rastreio/` e o script do pedido pago em `vitrine/assets/js/pedido.js`. Os dois são para copiar no branch `main`. Não misture `admin` em `main`: este branch não tem a vitrine.
