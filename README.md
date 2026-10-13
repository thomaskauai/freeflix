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

O catálogo é escolhido em **Configurações** (último item do menu):

| Opção | De onde vem |
|---|---|
| Clássicos (Domínio Público) — padrão na primeira abertura | `src/data/catalog.json`, embutido, com vídeo do Wikimedia Commons |
| Freeflix (Conteúdo completo) | addon de catálogo `catalog.nuvio.tv`; em pt-BR se o idioma do aparelho for português, senão em inglês |

A escolha fica guardada no aparelho. O addon fala o protocolo do Stremio (`/catalog`,
`/meta`); os endereços ficam em `src/settings.ts`. Trocar de catálogo recarrega o app.
Minha lista e progresso são guardados por catálogo.

O catálogo embutido se mantém com:

```bash
npm run fetch-media    # pôsteres e fotogramas do Commons
npm run fetch-video    # arquivos de vídeo do Commons
```

## Fontes de vídeo

Catálogo mostra os títulos; quem traz o vídeo é uma **fonte**: um addon com recurso
`stream`, instalado em Configurações → Adicionar fonte, pelo link do `manifest.json`.
Por ora o link é digitado ou colado no computador.

Para oferecer fontes com um clique, liste-as em `src/sources.json`:

```json
[{ "name": "Nome da fonte", "url": "https://exemplo.com/manifest.json" }]
```

Cada item aparece em Configurações → Fontes de vídeo com um botão Adicionar; depois de
instalada, passa a ter Remover (e volta à lista de disponíveis se for removida). O arquivo
sai vazio: nenhuma fonte vem embutida. Mudou o arquivo, refaça o build.

Ao dar play não há tela de escolha. O Freeflix consulta todas as fontes instaladas e
escolhe uma, nesta ordem de critérios (`src/streams/rank.ts`):

1. **Cabe na rede.** Um teste simples mede a banda (guardado por 30 min): abaixo de
   5 Mbps, até 480p; abaixo de 10, até 720p; senão 1080p. Se a fonte informa o tamanho,
   o bitrate estimado precisa caber em 80% da banda.
2. **Idioma do áudio** definido em Configurações; sem ele, o original; depois inglês.
3. **Resolução**, com 1080p como alvo (4K só se for o que há).
4. **Compatibilidade** de codec e contêiner com o aparelho.
5. **Seeds**, como desempate.

Se a fonte escolhida falha ou não começa em 15 s, o player passa sozinho para a próxima
(até 4). No player, "Fonte" diz o que está tocando e "Outra fonte" força a troca.

Limites:

- **Torrent não toca.** Só fontes com `url` HTTP direta (MP4, MKV, WebM, HLS). Addon que
  só devolve `infoHash` gera o aviso "Só há fontes de torrent".
- Resolução, idioma e seeds são lidos do texto livre de cada addon (`src/streams/parse.ts`).
  É heurística.
- Sem legendas.

Para testar sem depender de terceiros:

```bash
npm run mock-addon     # http://localhost:7077/manifest.json (e /torrent/manifest.json)
npm test               # testes do parser e do ranking
```

Há ainda um modo embed opcional: com `VITE_EMBED_BASE_URL` definida, títulos do catálogo
embutido abrem um iframe em `{base}/embed/{tmdbId}[/{temporada}/{episodio}]`.

## Estrutura

```
reference/        screenshots de referência e SPEC.md com as medidas
src/styles/       tokens.css (toda a geometria), base.css, components.css
src/focus/        engine de foco: keys.ts, spatial.ts, FocusContext.tsx
src/data/         tipos, cliente de addon, providers de catálogo, estado local
src/streams/      fontes instaladas, parser, ranking, teste de rede
src/settings.ts   catálogo e idioma escolhidos
src/platform/     acesso a window.tizen, com guarda
src/components/   Stage, Sidebar, Hero, Row, Card, PlayerShell, VideoPlayer…
src/pages/        Home, Browse, Details, Search, MyList, Watch, Settings, AddSource
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
