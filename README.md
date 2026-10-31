# Foveō Ateliê

Página de [foveoatelie.com.br](https://foveoatelie.com.br). Nesta primeira versão o site mostra só a marca, centralizada no fundo escuro texturizado do ateliê. O catálogo, o estoque e os pedidos entram depois, em cima desta mesma base Jekyll.

## Como rodar localmente

É preciso Ruby 3.2 (a versão está em `.ruby-version`) e Bundler.

```bash
bundle install
bundle exec jekyll serve
```

O site abre em <http://127.0.0.1:4000>. Para só gerar os arquivos estáticos:

```bash
bundle exec jekyll build
```

A saída fica em `_site/`.

## Deploy na Netlify

O `netlify.toml` já define o build: comando `jekyll build`, pasta publicada `_site`. Conecte este repositório do GitHub na Netlify. O comando e o diretório saem do arquivo; não é preciso reescrevê-los no painel.

Em seguida adicione o domínio `foveoatelie.com.br`. O DNS está no Registro.br: no painel do domínio, publique os registros que a Netlify mostrar ao verificar o domínio (o apex e, se quiser, o `www`).

## Estrutura

- `_config.yml` — nome, endereço e textos do site
- `_layouts/default.html` — documento base, metadados e ícones
- `index.html` — a página
- `assets/` — logos, selo, textura, ícones e imagem de compartilhamento
