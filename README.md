# Foveō Ateliê

Página do ateliê em Jekyll, sem framework de JavaScript. Nesta branch (`obrigado`), a raiz é o ritual pós-compra em formato de stories, publicado em obrigado.foveoatelie.com.br. O site principal, com o logo, continua na branch `main`.

## Local

É preciso Ruby 3.2.3 (a versão do arquivo `.ruby-version`) e Bundler.

```bash
bundle install
bundle exec jekyll serve
```

Abra http://127.0.0.1:4000

Para gerar a pasta `_site` sem subir o servidor:

```bash
bundle exec jekyll build
```

## Netlify

O repositório está ligado à Netlify. A cada push ela instala os gems do `Gemfile.lock` e roda o build descrito no `netlify.toml`:

- comando: `jekyll build`
- pasta publicada: `_site`

O domínio foveoatelie.com.br aponta para a Netlify a partir do Registro.br, com os registros que o painel da Netlify indicar.
