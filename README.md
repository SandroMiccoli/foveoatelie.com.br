# Foveō Ateliê — painel

O branch `admin` é o painel da loja, em admin.foveoatelie.com.br. A vitrine continua no branch `main`.

HTML, CSS e JavaScript em `admin/`. Sem build. A Netlify publica a pasta `admin`.

## Local

```bash
node scripts/servir-admin.mjs
```

Abra http://127.0.0.1:4173

## Banco

As funções em `supabase/functions/` não mudam neste branch. Migrations novas ficam em `supabase/migrations/` e rodam no SQL editor do projeto foveo-loja. Não usar `supabase db push`.
