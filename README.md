# Freeflix

Client de streaming para Samsung TV (Tizen), navegável só pelo controle remoto.
Abre direto no catálogo: não há login, perfil nem conta.

Estado atual: Fase 1, rodando no navegador. O empacotamento `.wgt` é a Fase 2.

## Rodar

```bash
npm install
npm run dev        # http://localhost:5173
```

O app desenha num palco fixo de 1920×1080 e escala para caber na janela.

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

O catálogo de demonstração fica em `src/data/catalog.json`: 42 filmes e seriados em
domínio público, com imagens livres do Wikimedia Commons em `public/media/`.

```bash
npm run fetch-media              # baixa pôsteres e fotogramas, preenche tmdbId
npm run fetch-media -- --list    # só lista os candidatos a fotograma
```

O script respeita o limite de requisições da Wikimedia e leva alguns minutos.
Títulos sem imagem livre aparecem com uma cartela tipográfica.

Para usar outro catálogo, defina `VITE_API_BASE_URL` e ajuste
`src/data/httpProvider.ts` ao formato da sua API. A interface está em
`src/data/types.ts`; a UI não muda.

## Vídeo

O player escolhe a fonte nesta ordem:

1. **Embed**, se `VITE_EMBED_BASE_URL` estiver definida (veja `.env.example`). Carrega um
   iframe em `{base}/embed/{tmdbId}` ou `{base}/embed/{tmdbId}/{temporada}/{episodio}`.
   Os controles de reprodução são os do próprio embed.
2. **Arquivo do catálogo**: o campo `videos` de cada título, tocado num `<video>` nativo
   com os controles do app (play/pausa, avançar, voltar, reiniciar, retomar de onde parou).
3. **Nada**: a tela mostra o cartaz e avisa que o título ainda não tem vídeo.

No catálogo de demonstração, `videos` aponta para arquivos em domínio público do
Wikimedia Commons, transmitidos direto de lá (WebM/VP9, 480p quando existe):

```bash
npm run fetch-video    # procura os arquivos e preenche "videos" em catalog.json
```

Nem todo título tem arquivo no Commons, e alguns só têm trailer ou trecho.

## Estrutura

```
reference/        screenshots de referência e SPEC.md com as medidas
src/styles/       tokens.css (toda a geometria), base.css, components.css
src/focus/        engine de foco: keys.ts, spatial.ts, FocusContext.tsx
src/data/         tipos, providers, catálogo, estado local (lista, progresso)
src/platform/     acesso a window.tizen, com guarda
src/components/   Stage, Sidebar, Hero, Row, Card, PlayerShell, VideoPlayer…
src/pages/        Home, Browse, Details, Search, MyList, Watch
config.xml        manifest Tizen, para a Fase 2
```

## Fase 2: TV

Pendente:

1. Instalar a Tizen CLI (extensão Tizen do VS Code ou Tizen Studio) e criar um
   perfil de certificado Samsung.
2. Trocar `XXXXXXXXXX` em `config.xml` pelo package id do certificado.
3. `npm run build`, copiar `dist/` e `config.xml` para uma pasta e empacotar com
   `tizen package -t wgt -s <perfil>`.
4. TV em Developer Mode, `sdb connect <ip>`, `tizen install`.

Pontos a conferir na TV: os códigos das teclas de mídia (o app loga os reais no
console ao iniciar) e o carregamento do bundle por `file://` no WebView do modelo.
