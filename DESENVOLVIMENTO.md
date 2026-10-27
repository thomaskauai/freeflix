# Avançado: código-fonte

Para quem quer rodar o Freeflix no computador, mexer no código ou gerar o app da TV. Para
só usar, veja o [README](README.md).

## Rodar

Precisa de [Node.js](https://nodejs.org/) 20+.

```bash
git clone https://github.com/thomaskauai/freeflix.git
cd freeflix
npm install
npm run dev            # http://localhost:5173
```

Sem configuração, usa o catálogo e as fontes padrão. Variáveis opcionais em
[.env.example](.env.example) (copie para `.env.local`).

```bash
npm test               # testes do parser e do ranking das fontes
npm run build          # build do site (dist/)
npm run preview        # serve o build
npm run mock-addon     # addon falso em http://localhost:7077, para testar sem terceiros
```

A sincronização entre TVs usa funções da Vercel (`api/`) e Postgres Neon. Para rodar com
elas: `vercel env pull .env.local` e `vercel dev`. Sem isso o app funciona, só não
sincroniza.

O app desenha num palco de TV (1920×1080) que se ajusta a qualquer janela; no celular em
pé o menu vira uma barra no pé da tela. Mouse e toque funcionam além do teclado.

## App da TV

```bash
npm version patch      # a TV só atualiza se a versão for maior que a instalada
npm run build:tizen
```

Gera `tizen-build/app/` e dois `.wgt` assinados em `tizen-build/` (fora do git), iguais a
não ser pelo ícone: `Freeflix-tizen7.wgt` (quadrado, Tizen 7 ou mais novo; o publicado) e
`Freeflix-tizen5.wgt` (16:9, para a barra de apps do Tizen 5 e 6).

- A versão do `package.json` vai para o `config.xml` e aparece no fim de Configurações.
- O bundle da TV é um script clássico (sem módulos ES) em es2015: o `.wgt` abre por
  `file://`, onde o WebView (Chromium 63–76) bloqueia `<script type="module">`.
- Assinatura: certificado de autor Tizen mais o distribuidor público do SDK, via
  [tizen.js](https://github.com/reisxd/tizen.js). Serve direto abaixo do Tizen 7; nas 7+
  o TizenBrew Installer reassina com a conta Samsung.
- O certificado de autor é criado no primeiro build em `tizen-cert/` (fora do git, tem
  chave privada). Sem ele, TVs abaixo do Tizen 7 precisam desinstalar para atualizar.
- `npm run tv:install` instala direto nas TVs da casa do autor (IPs e modelos fixos em
  `scripts/tv-install.mjs`).

**Publicar:** suba a versão, rode `npm run build:tizen` e anexe `Freeflix-tizen7.wgt`,
renomeado para `Freeflix.wgt`, a uma release `vX.Y.Z`. O nome fixo mantém o link de
download do README.

## Como funciona

**Catálogo.** Addon `catalog.nuvio.tv` no protocolo do Stremio (`/catalog`, `/meta`), em
pt-BR se o aparelho estiver em português. Endereços em `src/settings.ts`.

**Fontes.** Addons com recurso `stream`. A lista padrão é
[src/sources.json](src/sources.json), publicada em `/api/sources` a cada deploy e lida
pelo app a cada abertura: mudar o arquivo e dar push muda as fontes de todas as TVs sem
novo `.wgt`. A ordem do arquivo é a ordem de preferência. Sem rede vale a última lista
baixada (ou a cópia embutida). Uma fonte padrão removida pelo usuário não volta sozinha.
Em séries, a fonte que tocou fica guardada e o próximo episódio começa por ela.

**Home.** Destaques sorteados das listas "em alta" com peso pela posição e pela nota IMDb
(abaixo de 6,5 ficam de fora); Continuar assistindo; depois Filmes e Séries em alta, Notas
altas no IMDb e as demais listas em ordem sorteada a cada abertura.

**Sincronização.** O celular que lê o QR (`public/parear.html`) cria a casa. Cada aparelho
tem um id próprio (na Samsung, um resumo do DUID), então uma TV reinstalada volta sozinha
para a casa. A posição vai ao servidor no máximo a cada 10 s e ao pausar/sair; ao abrir,
vale o registro mais recente de cada conteúdo. 5 códigos errados seguidos travam o
aparelho por 10 min. Backend: `api/pair.ts`, `house.ts`, `sync.ts`, `sources.ts`, Postgres
Neon (`DATABASE_URL`), tabelas criadas na primeira chamada. A TV chama
`https://freefliix.vercel.app/api`; o navegador, o próprio site (`VITE_API_BASE` troca).

**Legendas.** Addon OpenSubtitles v3 (`src/streams/subtitles.ts`) pelo id IMDb; o `.srt`
vira WebVTT no aparelho. Usa a primeira legenda do idioma, então pode sair fora de
sincronia em outra edição do filme.

## Estrutura

```
src/styles/        tokens.css (toda a geometria), base.css, components.css
src/focus/         navegação por controle: keys.ts, spatial.ts, FocusContext.tsx
src/data/          tipos, cliente de addon, catálogo, estado local
src/streams/       fontes, parser, ranking, legendas
src/platform/      acesso a window.tizen, com guarda
src/components/    Stage, Sidebar, Hero, Row, Card, PlayerShell, VideoPlayer…
src/pages/         Home, Browse, Details, Search, MyList, Watch, Settings, AddSource
api/               funções da Vercel: casa, sincronização, lista de fontes
public/parear.html página do celular aberta pelo QR code
scripts/           empacotamento e instalação na TV, addon falso
config.xml         manifest Tizen
reference/         screenshots de referência e SPEC.md com as medidas
```
