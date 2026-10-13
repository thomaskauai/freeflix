# Spec visual

Medida nos screenshots desta pasta e normalizada para 1920×1080. Os valores vivem em
`src/styles/tokens.css`; este arquivo diz de onde cada um veio.

## Fontes

| Arquivo | O que é | Uso |
|---|---|---|
| `screenshot1_960x540_…jpg` | Home de TV, hero em foco | primária |
| `screenshot2_960x540_…jpg` | Home de TV, fileira de pôsteres em foco | primária |
| `screenshot3_960x540_…jpg` | Player de TV | primária |
| `screenshot-original-…webp` | Conceito de layout web (menu no topo) | secundária |

Nos três primeiros, a tela da TV ocupa uma moldura de 824 px de largura a partir de
(68, 92) dentro da imagem de 960×540. Conversão: `x = (x_img − 68) × 2,33`,
`y = (y_img − 92) × 2,33`.

## Medidas

| Elemento | Valor | Token | Origem |
|---|---|---|---|
| Sidebar: centro dos ícones | x = 80 | `--sidebar-x` | 1, 2 |
| Sidebar: passo vertical | 88 px, 6 itens centrados na altura | `--sidebar-step` | 1, 2 |
| Sidebar: item ativo | traço vermelho de 3 px sob o ícone | — | 1, 2 |
| Sidebar: sombra | preto → transparente até ~350 px | `--sidebar-shade` | 1 |
| Margem esquerda do conteúdo | 158 px | `--content-left` | 1, 2 |
| Hero: selo de tipo | centro em y = 212 | `--hero-top` | 1 |
| Hero: título | y ≈ 250–350 | — | 1 |
| Hero: chamada | 28 px bold, centro em y = 387 | — | 1 |
| Hero: sinopse | 24 px, 3 linhas, entrelinha 37 px, largura ~650 px | `--hero-text-w` | 1 |
| Hero: botões | altura 66 px, topo em y = 557, raio 4 px, vão 16 px | `--btn-*` | 1 |
| Botão em foco / em repouso | branco com texto preto / cinza translúcido | — | 1 |
| Primeira fileira sob o hero | título com centro em y = 846 | `--hero-h` | 1 |
| Título de fileira | 28 px bold, 14 px acima dos cards | `--row-title-*` | 1, 2 |
| Card pôster | 233 × 350, vão 8 px, ~7,3 visíveis | `--poster-*` | 1, 2 |
| Card alto (fileira de destaque) | 357 × 704, vão 8 px, ~4,9 visíveis | `--tall-*` | 2 |
| Foco em card | contorno branco de 4 px por fora, sem escala | `--focus-w` | 2 |
| Fileira em foco | título com centro em y = 86 | `--row-anchor` | 2 |
| Fileiras fora de foco | ~50% de opacidade | `--dim` | 2 |
| Vão entre fileiras | 30 px | `--row-gap` | 2 |
| Player: botões do topo | centros em (144, 114), (265, 114), (390, 114) | — | 3 |
| Player: play/pause | centro em (245, 969) | — | 3 |
| Player: barra | x de 424 a 1524, 4 px; vermelho = visto, branco = resto | — | 3 |
| Player: tempos | decorrido centrado em x = 359, total em x = 1589 | — | 3 |

## Correção em relação ao plano

O plano estimava os cards das fileiras comuns em 232×131 (16:9). Nos screenshots o
card tem ~100 px de largura na imagem e mais de 73 px de altura visíveis antes do
corte da tela, então não é 16:9: é pôster em pé, 2:3 (233×350).

## Estimado, não medido

Imagem estática não mostra tempo. Valores de partida, para ajustar na TV:
foco 150 ms (`--focus-ms`), rolagem 250 ms (`--scroll-ms`), abertura da sidebar 220 ms.

## Deliberadamente diferente

- Marca, logotipo e tipografia são próprios (Archivo; "F" no selo de tipo).
- Títulos das obras são texto em tipografia condensada, não arte de logotipo.
- Do conceito web vieram só a linha de metadados e os gêneros; o menu no topo não
  serve a controle remoto e ficou de fora.

## Ajustes pedidos depois da primeira versão

Decisões do dono do produto que se afastam dos screenshots de TV, na direção da
referência de cards (`cartaz arredondado, título e ano embaixo`):

- Cards com raio de 12 px; botões, teclas e avisos com 8 px.
- Vão entre cards de 8 para 24 px.
- Título e uma linha "ano • tipo" embaixo de cada card.
- Fileira de destaque de 357×704 para 300×450: o card alto ocupava a tela inteira.
