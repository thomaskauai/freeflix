# App de streaming para Samsung TV (Tizen) — client estilo Netflix

## Context

Objetivo: um app de TV (Samsung/Tizen) com experiência de catálogo tipo Netflix — hero, fileiras horizontais, tela de detalhes, busca e player — navegável 100% pelo controle remoto.

Fase 1 (este plano): app roda no navegador do computador para visualização e iteração rápida.
Fase 2: mesmo código empacotado como `.wgt` para Samsung Tizen.

Decisões já tomadas com o usuário:
- **Sem vídeo real por enquanto.** O componente de embed fica implementado no formato correto, porém com a base URL vindo de variável de ambiente (`VITE_EMBED_BASE_URL`), sem nenhum domínio hardcoded.
- **Catálogo de demonstração local** (JSON) com obras de domínio público, só para montar e validar UI/navegação. A camada de dados é um provider trocável, então depois basta plugar a API real sem tocar na UI.
- **Fidelidade de layout por referência medida.** O usuário envia screenshots/fotos da interface de referência na própria TV (home, detalhes, busca, player). Eu extraio a geometria e os tempos dessas imagens e implemento em cima dos números medidos, com loop de comparação visual.
- **Branding original.** Logo, wordmark, tipografia proprietária e arte de títulos de terceiros não são reproduzidos — o app leva identidade própria. O que se replica é estrutura, densidade e comportamento de navegação.

Ambiente verificado: Node v20.20.2, npm 10.8.2. Tizen CLI/`sdb` **não** instalados — instalação entra na Fase 2.

## Método de fidelidade visual

1. **Entrada:** screenshots/fotos enviados pelo usuário, salvos em `reference/` (home, detalhes, busca, player; idealmente também um card em foco e a sidebar aberta).
2. **Spec numérica** em `reference/SPEC.md`, medida nas imagens e normalizada para 1920×1080: cards visíveis por fileira, proporção e gutter dos cards, margem esquerda, escala e borda do foco, altura do hero, stops do gradiente, tamanhos/pesos de texto, espaçamento vertical entre fileiras, largura da sidebar fechada/aberta. Tempos de animação que foto não mostra entram como estimativa marcada, para ajuste na iteração.
3. **Tokens:** a spec vira variáveis em `src/styles/tokens.css`; nenhum componente usa número solto.
4. **Loop de comparação:** a cada tela pronta, screenshot via Playwright em 1920×1080 no mesmo estado (mesmo card em foco), lado a lado com a referência; divergências corrigidas até aprovação do usuário antes de passar para a próxima tela.

Se as imagens não chegarem antes do início, a base (focus engine, dados, rotas, player) é construída primeiro com tokens provisórios, e a calibragem visual entra assim que chegarem.

## Stack

- Vite + React 18 + TypeScript, CSS puro com variáveis (sem Tailwind: menos risco no WebView antigo da TV)
- `esbuild target: es2015`, `build.modulePreload: false`, assets relativos (`base: './'`) — obrigatório para rodar de `file://` dentro do `.wgt`
- Zero dependências de runtime além de React/React Router. Engine de foco é própria (previsível, ~200 linhas) em vez de biblioteca de spatial navigation
- Canvas fixo 1920×1080 escalado por `transform: scale()` conforme a janela — na TV fica 1:1, no computador cabe em qualquer tela

## Estrutura

```
~/Projects/freeflix/
  index.html                  # inclui $WEBAPIS/webapis/webapis.js com onerror silencioso
  vite.config.ts
  config.xml                  # manifest Tizen (Fase 2)
  src/
    main.tsx  App.tsx  styles/
    data/
      types.ts                # Title, Episode, Row, Catalog
      provider.ts             # interface CatalogProvider + escolha por env
      localProvider.ts        # lê catalog.json (demo)
      httpProvider.ts         # stub pronto: fetch em VITE_API_BASE_URL, mesma interface
      catalog.json            # demo: obras de domínio público
    focus/
      FocusContext.tsx        # registry de elementos focáveis + foco atual
      useFocusable.ts         # hook por card/botão
      spatial.ts              # resolve vizinho por geometria (rects)
      keys.ts                 # mapa de teclas: teclado do PC + controle Tizen
    components/
      Hero.tsx  Row.tsx  Card.tsx  Sidebar.tsx  SearchKeyboard.tsx
      VideoPlayer.tsx         # embed (iframe) — ver abaixo
      PlayerShell.tsx         # overlay de controles + lógica de Back
    pages/
      Home.tsx  Details.tsx  Search.tsx  Watch.tsx
  scripts/build-wgt.sh        # Fase 2
```

## Navegação por controle (núcleo do app)

`src/focus/keys.ts` — mapa único usado em todo o app, resolvido por `event.keyCode`:

| Ação | PC | TV |
|---|---|---|
| Cima/Baixo/Esq/Dir | 38/40/37/39 | iguais (automáticos no Tizen) |
| OK | 13 (Enter) | 13 |
| Voltar | 27 (Esc) | 10009 (Back) + 27 |
| Play/Pause | 32 (Space) | 10252, 415, 19 |
| FF / RW | →/← no player | 417 / 412 |

- Setas/Enter/Back não precisam de registro no Tizen; teclas de mídia e coloridas **precisam** de `tizen.tvinputdevice.registerKeyBatch([...])` e do privilégio `http://tizen.org/privilege/tv.inputdevice` no `config.xml`. Os códigos numéricos serão confirmados em runtime via `getSupportedKeys()` logado na própria TV (os valores acima são o ponto de partida).
- `spatial.ts` escolhe o vizinho pelo retângulo mais próximo na direção pressionada (overlap no eixo perpendicular > distância), com fallback para o índice anterior/seguinte da mesma fileira. Isso evita foco "pulando" em fileiras de larguras diferentes.
- Ao focar um card, a fileira rola com `transform: translate3d()` (nunca `scrollLeft` animado — trava no WebView da TV) mantendo o card focado no mesmo offset da esquerda.
- Um único listener global de `keydown`; páginas registram handlers por camada (modal/player tem prioridade sobre a página).
- Back: Details → Home; Home → `tizen.application.getCurrentApplication().exit()` na TV, no-op no navegador.

## Player / embed

`src/components/VideoPlayer.tsx` — mantém a forma do exemplo enviado, sem domínio fixo:

```tsx
const base = import.meta.env.VITE_EMBED_BASE_URL ?? '';
const path = season != null && episode != null
  ? `/embed/${tmdbId}/${season}/${episode}`
  : `/embed/${tmdbId}`;
// base vazia -> renderiza placeholder "fonte de vídeo não configurada", não um iframe quebrado
const embedUrl = base ? `${base}${path}` : null;
```

`iframe` com `allowFullScreen`, `aspect-ratio: 16/9`, borda arredondada, e na TV ocupando a tela inteira. `PlayerShell` desenha os controles e trata Back/Play — como o conteúdo é um iframe de outra origem, os controles são do embed; nosso overlay cuida apenas de sair e mostrar título/episódio. Caso a fonte futura sirva HLS direto, há um segundo caminho (`<video>` + `hls.js` carregado sob demanda) atrás da mesma interface `PlayerSource`.

## Camada de dados

`CatalogProvider`:

```ts
interface CatalogProvider {
  getRows(): Promise<Row[]>            // "Em alta", "Filmes", "Séries", "Continuar assistindo"
  getTitle(id: string): Promise<Title>
  getSeasons(id: string): Promise<Season[]>
  search(q: string): Promise<Title[]>
}
```

`localProvider` lê `catalog.json`; `httpProvider` faz `fetch` em `VITE_API_BASE_URL` e normaliza a resposta para `Title`. Trocar de fonte = mudar uma env var. Progresso de "continuar assistindo" em `localStorage` com try/catch (pode falhar na TV).

## Telas

1. **Home** — hero com backdrop + sinopse + botões Assistir/Mais informações; fileiras horizontais com cards 16:9 que crescem e ganham borda no foco (`scale(1.08)`, transição 150ms, `will-change: transform`); sidebar colapsada à esquerda que expande ao receber foco (Início, Busca, Filmes, Séries, Minha lista).
2. **Details** — backdrop com gradiente, metadados, botão Assistir, lista de episódios por temporada quando for série, fileira "Semelhantes".
3. **Search** — teclado virtual em grade navegável pelo controle (QWERTY + espaço/apagar), resultados em grade abaixo, debounce 300ms.
4. **Watch** — `VideoPlayer` em tela cheia + `PlayerShell`.

## Fase 2 — empacotamento Tizen

1. `config.xml`: `<tizen:application id="XXXXXXXXXX.SmartTVClient" package="XXXXXXXXXX" required_version="6.0">`, `<tizen:profile name="tv">`, privilégios `tv.inputdevice` e `internet`, `<access origin="*" subdomains="true"/>`, `<tizen:setting background-support="disable" screen-orientation="landscape"/>`, ícone 512×423.
2. Instalar **Tizen VS Code Extension** (traz CLI + Certificate Manager; Tizen Studio foi descontinuado) ou o Tizen Studio legado se ainda disponível; criar perfil de certificado Samsung com a conta Samsung.
3. `npm run build` → `scripts/build-wgt.sh` copia `dist/` + `config.xml` para `build/` e roda:
   `tizen build-web -- build` → `tizen package -t wgt -s <perfil> -- build/.buildResult`
4. TV em Developer Mode (Apps → 12345 → IP do computador), `sdb connect <ip-tv>`, `tizen install -t <target> --name app.wgt`.

Riscos conhecidos: WebView antigo (Tizen 5.5/6.0 ≈ Chromium 63/76) — daí o target es2015 e nenhum CSS moderno crítico; `file://` exige `base: './'`; `webapis.js` só existe na TV, então todo acesso a `window.tizen` passa por um wrapper com guarda.

## Verificação

**No computador (Fase 1)**
- `npm run dev`, abrir em 1920×1080 (ou qualquer tamanho — o canvas escala)
- Percorrer com as setas: Home → fileiras → sidebar → Details → episódios → Search → teclado virtual → Watch → Esc volta. Nenhuma ação deve exigir mouse; `document.activeElement`/anel de foco sempre visível
- `VITE_EMBED_BASE_URL` vazia → placeholder; definida para qualquer host de teste → iframe monta a URL `/embed/{id}` e `/embed/{id}/{s}/{e}` corretamente (conferir no painel Network)
- Rodar com `npm run build && npx vite preview` para pegar quebras só de produção
- Screenshot de cada tela via Playwright (já disponível na sessão) com navegação por teclado, para comparar o resultado

**Na TV (Fase 2)**
- `.wgt` instala e abre; log de `getSupportedKeys()` confirma os códigos reais; Back sai do app na Home; sem scroll da página (overflow hidden) e sem barra de rolagem visível

## Entrega da Fase 1

Repositório pronto, rodando no navegador, com catálogo de demonstração, navegação completa por controle, embed no formato final sem fonte hardcoded e `config.xml` já versionado para a Fase 2.
