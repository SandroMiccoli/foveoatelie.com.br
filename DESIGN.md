---
name: Foveō Ateliê
description: Painel e loja no preto quente, com papel e cobre.
colors:
  ink: "#0d0908"
  paper: "#ede6d9"
  paper-dim: "#c9c0b1"
  ink-dim: "#3f3832"
  copper: "#c87431"
  copper-press: "#b86a2c"
  line: "rgba(237, 230, 217, 0.2)"
  stock-green: "#7fac62"
  stock-amber: "#d1a24a"
  stock-red: "#cc6456"
typography:
  display:
    fontFamily: "EB Garamond, Iowan Old Style, Palatino Linotype, Palatino, Georgia, serif"
    fontSize: "2rem"
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Inter, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.08em"
rounded:
  none: "0"
  pill: "999px"
spacing:
  campo: "1rem"
  pagina: "1.25rem"
  pagina-larga: "2.5rem"
components:
  button-primary:
    backgroundColor: "{colors.copper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0.75rem 1.4rem"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.copper-press}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0.75rem 1.4rem"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.paper}"
    rounded: "{rounded.none}"
    padding: "0.5rem 0.15rem"
    height: "44px"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.paper}"
    rounded: "{rounded.none}"
    padding: "0.65rem 0.75rem"
    height: "48px"
  selo-teste:
    backgroundColor: "transparent"
    textColor: "{colors.paper}"
    rounded: "{rounded.none}"
    padding: "0.08rem 0.4rem"
---

# Design System: Foveō Ateliê

## Overview

O painel usa o mesmo preto, o mesmo papel e o mesmo cobre do site da loja. A marca escreve-se Foveō, com o mácron. O cobre aparece na ação principal, na seção atual e na marca dos pedidos de teste. O resto fica em papel sobre o preto.

Inter carrega dados, botões e navegação, como na loja. EB Garamond fica só no título da página, em itálico.

**Key Characteristics:**

- Fundo `#0d0908`, texto `#ede6d9`.
- Cobre só onde há ação ou estado.
- Títulos em garamond itálico. Dados em Inter, com números tabulares.
- Fios de 1px em papel a 20% de opacidade. Sem cartão e sem sombra.
- No telefone, a navegação fica embaixo. No computador, fica numa coluna à esquerda.

## Colors

A paleta é a do site. Os nomes já estavam no CSS da loja.

### Primary

- **Cobre** (`#c87431`): botão Entrar, seção atual no computador, fio da seção atual no telefone, borda da marca `teste`, foco. Texto preto sobre o cobre passa AA (5.66:1).
- **Cobre pressionado** (`#b86a2c`): hover do botão. Texto preto passa AA (4.85:1).

### Neutral

- **Preto** (`#0d0908`): fundo da página, do menu e dos campos.
- **Papel** (`#ede6d9`): texto principal e a palavra da seção atual no telefone.
- **Papel baço** (`#c9c0b1`): rótulos, seção inativa, texto secundário. Sobre o preto, 11:1.
- **Preto baço** (`#3f3832`): trilho da barra de rolagem.
- **Fio** (`rgba(237, 230, 217, 0.2)`): divisórias de linha, borda de campo, borda do menu.

### Status

Usados só no ponto ao lado da palavra. A palavra continua em papel.

- **Verde** (`#7fac62`): pago, enviado, entregue.
- **Âmbar** (`#d1a24a`): pendente.
- **Vermelho** (`#cc6456`): expirado, recusado, cancelado, e a borda do aviso de erro.

## Typography

**Display:** EB Garamond, itálico, peso 500.
**Body:** Inter, peso 400.
**Label:** Inter, peso 500, caixa alta, espaçamento 0.08em.

O título da página é 1.75rem no telefone e 2rem a partir de 45rem. O corpo é 1rem. Código, data e dinheiro usam números tabulares.

## Layout

No telefone a barra com a marca e Sair fica no topo. O miolo rola. As quatro seções ficam fixas embaixo, com área segura.

A partir de 60rem, a coluna da esquerda tem 16rem e a altura da janela. Sair desce para o fim dessa coluna. A lista de pedidos vira tabela a partir de 45rem. Abaixo disso, cada pedido é um bloco com rótulo e valor.

## Elevation & Depth

Não há sombra. A profundidade é o fio de 1px e a troca de cor da seção atual.

## Shapes

Campos e a marca `teste` são retos. O botão Entrar é uma pílula, no mesmo raio dos controles da loja. O ponto de status é um círculo de 0.5rem.

## Components

### Buttons

- **Entrar:** cobre, texto preto, altura 48px, caixa alta.
- **Hover:** `#b86a2c`. Desabilitado durante o envio, opacidade 0.55.
- **Sair e Mostrar:** texto em papel, sem fundo, altura mínima 44px. Hover em cobre.

### Inputs

- Fundo transparente, borda de 1px no fio, altura 48px, cantos retos.
- Foco: a borda passa a cobre. Sem segundo contorno.
- Erro: frase em papel dentro de uma caixa com borda vermelha de 1px.

### Navigation

- Quatro seções: Início, Pedidos, Estoque, Clientes.
- Inativa em papel baço. Atual em cobre no computador, e em papel com fio de cobre em cima no telefone.
- Alvos de toque com pelo menos 44px.

### Selo teste

A palavra `teste` em papel, borda de 1px em cobre, ao lado do código. Não some da lista.

## Do's and Don'ts

### Do

- **Do** escrever Foveō com o mácron.
- **Do** manter o texto da interface em português do Brasil.
- **Do** usar o cobre para a ação, a seção atual e a marca de teste.

### Don't

- **Don't** trocar Inter ou EB Garamond. São as fontes da loja.
- **Don't** colocar cartão, ícone decorativo ou número gigante no lugar da lista.
- **Don't** abrir `pedidos` para a chave publishable. A leitura é do usuário autenticado do ateliê.
