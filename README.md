# Freeflix

Client de streaming para Samsung TV (Tizen), navegável só pelo controle remoto.
Abre direto no catálogo: não há login, perfil nem conta.

Estado atual: Fase 1, rodando no navegador. O empacotamento `.wgt` é a Fase 2.

## Rodar

```bash
npm install
npm run dev        # http://localhost:5173
```

O app desenha em px de TV (palco de 1920×1080 na proporção 16:9) e ocupa a janela toda em qualquer tela: fora do 16:9 o palco cresce no eixo que sobra; em celular em pé o menu vira uma barra no pé da tela e o conteúdo empilha. Com dedo, arrastar rola a página e as fileiras, e a barra de progresso do player aceita toque e arrasto.

| Ação | Teclado | Controle da TV |
|---|---|---|
| Mover | setas | setas |
| Selecionar | Enter | OK |
| Voltar | Esc ou Backspace | Back |
| Reproduzir / pausar | Espaço | Play/Pause |
| Avançar / voltar 10 s | → / ← no botão de play | FF / RW |

Na busca, no computador, também dá para digitar direto.

Mouse também funciona: passar por cima foca, clicar seleciona, a roda troca de
fileira (horizontal anda dentro dela) e cada fileira ganha setas nas pontas.

Antes de dar um build por bom:

```bash
npm run build && npm run preview
```

## Catálogo

Os títulos vêm do addon de catálogo `catalog.nuvio.tv`, em pt-BR se o idioma do aparelho
for português, senão em inglês. O addon fala o protocolo do Stremio (`/catalog`, `/meta`);
os endereços ficam em `src/settings.ts`.

## Fontes de vídeo

Catálogo mostra os títulos; quem traz o vídeo é uma **fonte**: um addon com recurso
`stream`. A lista de fontes padrão é lida a cada abertura do app de `VITE_SOURCES_URL`
(padrão: `src/sources.json` no GitHub, pelo raw.githubusercontent.com, que exige o
repositório público). Mudar o arquivo no GitHub muda as fontes de todas as TVs sem gerar
outro `.wgt`: as novas entram sozinhas e as que saíram da lista saem da TV. Sem rede, vale a
última lista baixada; na primeira abertura sem rede, a cópia de `src/sources.json` embutida
no app. A ordem do arquivo é a ordem de preferência. Em Configurações dá para remover,
reinstalar e adicionar outras pelo link do `manifest.json`. Uma fonte padrão removida não
volta sozinha.

Em séries, a fonte que tocou (addon, resolução e áudio) fica guardada por série: o próximo
episódio, ou um escolhido na lista, pergunta primeiro só a esse addon e começa pela mesma
opção; as outras fontes entram como reserva se ela falhar.

## Home

- **Destaques** (topo, 4): dois filmes e duas séries das listas "em alta", sorteados com peso
  60% pela posição em alta e 40% pela nota IMDb (sem fotograma, sinopse ou com nota abaixo
  de 6,5 ficam de fora). Os pontos ao lado dos botões passam entre eles.
- **Fileiras**: Filmes em alta e Séries em alta no topo, depois Notas altas no IMDb (7,5+,
  alternando filme e série), depois as demais listas do catálogo em ordem sorteada. Listas
  sem ordem de data abrem numa das 3 primeiras páginas, embaralhadas. O sorteio muda a cada
  abertura do app e fica igual enquanto ele está aberto.

## Legendas

O botão Legendas do player oferece Português (Brasil), English e Español, quando existem
para o título. Vêm do addon OpenSubtitles v3 (`src/streams/subtitles.ts`), buscadas pelo
id IMDb; o `.srt` é convertido para WebVTT no aparelho. O idioma escolhido vale para os
próximos vídeos, até ser desligado.

Limite: a legenda é a primeira que o addon oferece no idioma. Se o vídeo for de outra
edição do filme, pode sair fora de sincronia; não há ajuste de atraso.

Para testar sem depender de terceiros:

```bash
npm run mock-addon     # http://localhost:7077/manifest.json (e /torrent/manifest.json)
npm test               # testes do parser e do ranking
```

Há ainda um modo embed opcional: com `VITE_EMBED_BASE_URL` definida, títulos com id TMDB
abrem um iframe em `{base}/embed/{tmdbId}[/{temporada}/{episodio}]`.

## Estrutura

```
reference/        screenshots de referência e SPEC.md com as medidas
src/styles/       tokens.css (toda a geometria), base.css, components.css
src/focus/        engine de foco: keys.ts, spatial.ts, FocusContext.tsx
src/data/         tipos, cliente de addon, provider do catálogo, estado local
src/streams/      fontes instaladas, parser, ranking, teste de rede
src/settings.ts   endereço do catálogo e idioma escolhido
src/platform/     acesso a window.tizen, com guarda
src/components/   Stage, Sidebar, Hero, Row, Card, PlayerShell, VideoPlayer…
src/pages/        Home, Browse, Details, Search, MyList, Watch, Settings, AddSource
config.xml        manifest Tizen, para a Fase 2
```

## Fase 2: TV

`npm run build:tizen` gera o app da TV em `tizen-build/app/` e dois pacotes assinados
(fora do git), iguais a não ser pelo ícone, que a TV lê na instalação:

- `tizen-build/Freeflix-tv-nova.wgt`: ícone quadrado (`tizen/icon-quadrado.png`), para
  telas iniciais mais recentes;
- `tizen-build/Freeflix-tv-antiga.wgt`: ícone 16:9 (`tizen/icon-retangular.png`), para as
  antigas: a barra delas mostra o ícone na proporção do arquivo, e os blocos dos outros
  apps são 16:9 (o ícone de 1920×1080 da loja da Samsung).

Instala pelo [TizenBrew Installer](https://github.com/reisxd/TizenBrew).

- O bundle é um script clássico só, sem módulos ES: o `.wgt` abre por `file://`, e lá o
  WebView bloqueia `<script type="module">`.
- A assinatura é a mesma do próprio TizenBrew para TVs antigas: certificado de autor
  Tizen, sem conta Samsung, mais o distribuidor público do SDK Tizen, via
  [tizen.js](https://github.com/reisxd/tizen.js). Em TVs Tizen 7+ o TizenBrew Installer
  reassina por cima.
- Atualizar o app já instalado: suba a versão (`npm version patch` ou `minor`) e rode
  `npm run build:tizen`. A TV só trata o `.wgt` como atualização se o package id
  (`config.xml`) e o certificado de autor forem os mesmos e a versão for maior que a
  instalada. A versão do `package.json` é copiada para o `config.xml` no build e aparece
  no fim de Configurações.
- O certificado de autor é criado no primeiro build em `tizen-cert/` (fora do git, tem
  chave privada). Para atualizar o app já instalado na TV, o `.wgt` precisa do mesmo
  certificado; perdido o arquivo, é desinstalar e instalar de novo.

Pontos a conferir na TV: os códigos das teclas de mídia (o app loga os reais no
console ao iniciar) e o carregamento do bundle por `file://` no WebView do modelo.
