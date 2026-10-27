# Freeflix

> **Projeto experimental.** Feito para uso pessoal, em casa. Pode quebrar, mudar sem
> aviso e depende de serviços de terceiros que podem sair do ar.

Freeflix é um app de filmes e séries para **TV Samsung (Tizen)**, pensado para ser usado
só com o controle remoto. Abre direto no catálogo: não tem login, perfil nem conta. Também
roda no navegador do computador e do celular.

O Freeflix não hospeda nenhum vídeo. Ele junta duas coisas:

- **Catálogo**: a lista de títulos, capas, sinopses, temporadas e episódios, de um addon
  de catálogo no protocolo do Stremio.
- **Fontes**: addons com recurso `stream` que respondem, para cada título, onde está o
  vídeo. O app pergunta a todas as fontes, ordena as opções (resolução, áudio, preferência)
  e toca a melhor; se falhar, tenta a próxima.

Além disso:

- Continuar assistindo, histórico e "Assistido", sincronizados entre as TVs da casa por um
  código de 6 números (sem e-mail).
- Legendas em português, inglês e espanhol (OpenSubtitles).
- Em séries, lembra qual fonte tocou e começa o próximo episódio por ela.

**Para usar não precisa baixar o código nem rodar nada.** Baixe o app pronto (`.wgt`) na
página de [Releases](https://github.com/thomaskauai/freeflix/releases/latest) e siga
[Instalar na TV Samsung](#instalar-na-tv-samsung). Rodar no computador só serve para quem
quer modificar o app.

## Sumário

- [Instalar na TV Samsung](#instalar-na-tv-samsung)
- [Rodar no computador (para modificar)](#rodar-no-computador-para-modificar)
- [Gerar o app da TV (para quem desenvolve)](#gerar-o-app-da-tv-para-quem-desenvolve)
- [Como funciona por dentro](#como-funciona-por-dentro)

## Instalar na TV Samsung

Serve para TV Samsung de 2017 em diante. Você vai precisar de um computador (Windows, Mac
ou Linux) na **mesma rede** da TV. A instalação é feita pelo **TizenBrew Installer**, um
programa que roda no computador e manda o app para a TV.

TVs mais novas (Tizen 7+, em geral 2023 em diante) pedem também login numa **conta
Samsung** (grátis). Não precisa descobrir a versão: o Installer vê sozinho e só pede se
for preciso.

### 1. Baixar os dois arquivos

- O app: **[Freeflix.wgt](https://github.com/thomaskauai/freeflix/releases/latest/download/Freeflix.wgt)**
- O [TizenBrew Installer](https://github.com/reisxd/TizenBrewInstaller/releases/latest)
  do seu sistema: `TizenBrewInstaller-win-x64.exe` (Windows),
  `TizenBrewInstaller-macos-arm64` (Mac M1/M2…), `TizenBrewInstaller-macos-x64` (Mac
  Intel) ou `TizenBrewInstaller-linux-x64` (Linux).

### 2. Ligar o modo de desenvolvedor na TV

1. Descubra o IP do computador. Windows: `ipconfig` no Prompt de Comando, "Endereço
   IPv4". Mac: `ipconfig getifaddr en0` no Terminal. Algo como `192.168.0.10`.
2. Na TV, abra **Apps** e digite **`1 2 3 4 5`** no controle (controle sem números:
   aperte o botão **`123`** para abrir o teclado na tela).
3. Na janela **Developer Mode**: ligue (**On**), digite o IP do computador em **Host PC
   IP** e confirme.
4. **Reinicie a TV segurando o botão liga/desliga** até aparecer o logo da Samsung (só
   desligar e ligar não serve).

Anote o **IP da TV**: Configurações → Geral → Rede → Status da rede → Config. IP.

### 3. Abrir o Installer e conectar

- **Windows**: dois cliques no `.exe`. Se o Windows bloquear: **Mais informações →
  Executar assim mesmo**.
- **Mac / Linux**: no Terminal, na pasta do download:

  ```bash
  chmod +x TizenBrewInstaller-macos-arm64
  xattr -d com.apple.quarantine TizenBrewInstaller-macos-arm64   # só no Mac
  ./TizenBrewInstaller-macos-arm64
  ```

Abre uma página no navegador (se não abrir: `http://localhost:8091`). Deixe o programa
aberto até o fim. Em **Connect to TV**, digite o **IP da TV** e aperte Enter:

![Connect to TV com o IP da TV digitado](docs/instalacao/1-conectar.png)

### 4. Instalar

Conectado, aparecem quatro botões. Clique em **Select file to install** (o último) e
escolha o `Freeflix.wgt`:

![Botões depois de conectar; o último é Select file to install](docs/instalacao/3-instalar.png)

**Se aparecer "Resigning required"** (TVs Tizen 7+): clique em **Sign in to Samsung
Account**, entre na sua conta Samsung na página que abrir, volte ao Installer e clique de
novo em **Select file to install**.

![Aviso Resigning required com o botão Sign in to Samsung Account](docs/instalacao/2-conta-samsung.png)

Quando aparecer **Package installed**, está pronto: o Freeflix fica em **Apps** na TV.
Para pô-lo na tela inicial, selecione o ícone, segure OK e escolha **Adicionar à Início**.

Não precisa clicar em **Install TizenBrew**: é outro app, não é necessário para o
Freeflix.

### Atualizar

Baixe o `Freeflix.wgt` novo e repita os passos 3 e 4. Nada do que você assistiu se perde.
Deixe o modo de desenvolvedor ligado na TV para isso. Em TV Tizen 7+, entre sempre com a
**mesma conta Samsung** (o Installer pede o login a cada instalação; é normal).

### Deu erro?

| Mensagem | O que fazer |
|---|---|
| *Make sure that the TV is on and that the IP is correct* | IP da TV errado, TV desligada, ou TV e computador em redes diferentes (ex.: Wi-Fi de visitantes). |
| *Either you haven't set the Host PC IP… or you didn't restart the TV properly* | Refaça o passo 2: confira o IP do computador (pode mudar de um dia para o outro) e reinicie segurando o botão liga/desliga. |
| Conectou uma vez e depois não conecta mais | Feche o Installer, abra de novo e reconecte. |
| *Author certificate not match* | O app foi instalado antes com outra conta Samsung. Desinstale o Freeflix na TV (segure OK no ícone → Excluir) e instale de novo. |

## Rodar no computador (para modificar)

Só é preciso para mexer no código. Para usar na TV, basta
[instalar o `.wgt` pronto](#instalar-na-tv-samsung).

Precisa de [Node.js](https://nodejs.org/) 20 ou mais novo.

```bash
git clone https://github.com/thomaskauai/freeflix.git
cd freeflix
npm install
npm run dev        # abre em http://localhost:5173
```

Nada mais é obrigatório: sem configuração, o app usa o catálogo e a lista de fontes
padrão. As variáveis opcionais estão em [.env.example](.env.example) (copie para
`.env.local`).

Outros comandos:

```bash
npm test               # testes do parser e do ranking das fontes
npm run build          # build do site (pasta dist/)
npm run preview        # serve o build, para conferir antes de publicar
npm run mock-addon     # addon falso em http://localhost:7077, para testar sem terceiros
```

A sincronização entre TVs usa funções da Vercel (pasta `api/`) e um Postgres Neon. Para
rodar com elas localmente: `vercel env pull .env.local` e `vercel dev`. Sem isso o app
funciona, só não sincroniza.

### Controles

O app desenha numa tela de TV (1920×1080) e se ajusta a qualquer janela. No celular em pé,
o menu vira uma barra no pé da tela.

| Ação | Teclado | Controle da TV |
|---|---|---|
| Mover | setas | setas |
| Selecionar | Enter | OK |
| Voltar | Esc ou Backspace | Back |
| Reproduzir / pausar | Espaço | Play/Pause |
| Avançar / voltar (segurar acelera) | → / ← na linha do tempo | FF / RW |

Mouse e toque também funcionam: passar por cima foca, clicar seleciona, arrastar rola.

## Gerar o app da TV (para quem desenvolve)

```bash
npm version patch      # a TV só atualiza se a versão for maior que a instalada
npm run build:tizen
```

Gera o app em `tizen-build/app/` e dois `.wgt` assinados em `tizen-build/` (fora do
git), iguais a não ser pelo ícone: `Freeflix-tv-nova.wgt` (quadrado, o publicado) e
`Freeflix-tv-antiga.wgt` (16:9, para a barra de blocos largos das TVs antigas, usado só
pelo `tv:install`). Detalhes:

- A versão do `package.json` é copiada para o `config.xml` e aparece no fim de
  Configurações no app.
- O bundle da TV é um script clássico, sem módulos ES: o `.wgt` abre por `file://`, e lá o
  WebView bloqueia `<script type="module">`. O alvo é es2015 (WebViews Chromium 63–76).
- Assinatura: certificado de autor Tizen (sem conta Samsung) mais o distribuidor público
  do SDK Tizen, via [tizen.js](https://github.com/reisxd/tizen.js), igual ao TizenBrew.
  Serve direto em TVs abaixo do Tizen 7; nas 7+ o Installer reassina com o certificado da
  conta Samsung.
- O certificado de autor é criado no primeiro build em `tizen-cert/` (fora do git, tem
  chave privada). Perdê-lo obriga a desinstalar e instalar de novo nas TVs abaixo do
  Tizen 7.
- `npm run tv:install` instala direto nas TVs da casa do autor, sem a interface do
  Installer (IPs e modelos fixos em `scripts/tv-install.mjs`).

Para publicar uma versão: suba a versão, rode `npm run build:tizen` e anexe
`Freeflix-tv-nova.wgt`, renomeado para `Freeflix.wgt`, a uma release do GitHub com a tag
`vX.Y.Z` (o nome fixo mantém o link de download do README).

## Como funciona por dentro

### Catálogo

Os títulos vêm do addon de catálogo `catalog.nuvio.tv`, em pt-BR se o idioma do aparelho
for português, senão em inglês. O addon fala o protocolo do Stremio (`/catalog`, `/meta`);
os endereços ficam em `src/settings.ts`.

### Fontes de vídeo

A lista de fontes padrão está em [src/sources.json](src/sources.json). Cada deploy do site
a publica em `/api/sources`, que o app lê a cada abertura: mudar o arquivo e dar push muda
as fontes de todas as TVs sem gerar outro `.wgt`. As novas entram sozinhas e as que saíram
da lista saem da TV. Sem rede vale a última lista baixada; na primeira abertura sem rede, a
cópia embutida no app. A ordem do arquivo é a ordem de preferência.

Em Configurações dá para remover, reinstalar e adicionar outras fontes pelo link do
`manifest.json`. Uma fonte padrão removida não volta sozinha.

Em séries, a fonte que tocou (addon, resolução e áudio) fica guardada por série: o próximo
episódio pergunta primeiro só a ela e começa pela mesma opção; as outras entram como
reserva.

### Home

- **Destaques** (topo): dois filmes e duas séries das listas "em alta", sorteados com peso
  pela posição e pela nota IMDb (abaixo de 6,5 ficam de fora).
- **Continuar assistindo**: onde você parou. Episódio terminado vira o seguinte; filme
  terminado sai.
- **Fileiras**: Filmes e Séries em alta, Notas altas no IMDb, depois as demais listas do
  catálogo em ordem sorteada a cada abertura.

### Sincronizar entre TVs

Sem conta nem e-mail. Em Configurações, **Sincronizar entre TVs**:

- **Criar código**: a TV mostra um QR code; o celular que o abrir cria o código da casa (6
  números) e a TV entra nela sozinha. O QR vale 15 min.
- **Já tenho um código**: digita os 6 números com o controle.

Cada aparelho tem um id próprio (na Samsung, um resumo do identificador da TV), então uma
TV reinstalada volta sozinha para a casa. Posição vai ao servidor no máximo a cada 10 s e
ao pausar/sair do player; ao abrir o app, junta o que está no servidor com o do aparelho
(vale o registro mais recente). 5 códigos errados seguidos travam o aparelho por 10 min.

Backend: funções da Vercel em `api/` (`pair.ts`, `house.ts`, `sync.ts`, `sources.ts`) e
Postgres Neon (`DATABASE_URL`); as tabelas são criadas na primeira chamada. O app da TV
chama `https://freefliix.vercel.app/api`; no navegador, o próprio site (`VITE_API_BASE`
troca).

### Legendas

O botão Legendas oferece Português (Brasil), English e Español quando existem. Vêm do addon
OpenSubtitles v3 (`src/streams/subtitles.ts`) pelo id IMDb, e o `.srt` vira WebVTT no
aparelho. Limite: é a primeira legenda do idioma; se o vídeo for de outra edição, pode
sair fora de sincronia.

### Estrutura

```
src/styles/       tokens.css (toda a geometria), base.css, components.css
src/focus/        navegação por controle: keys.ts, spatial.ts, FocusContext.tsx
src/data/         tipos, cliente de addon, catálogo, estado local
src/streams/      fontes, parser, ranking, legendas
src/platform/     acesso a window.tizen, com guarda
src/components/   Stage, Sidebar, Hero, Row, Card, PlayerShell, VideoPlayer…
src/pages/        Home, Browse, Details, Search, MyList, Watch, Settings, AddSource
api/              funções da Vercel: casa, sincronização, lista de fontes
public/parear.html página do celular aberta pelo QR code
scripts/          empacotamento e instalação na TV, addon falso
config.xml        manifest Tizen
reference/        screenshots de referência e SPEC.md com as medidas
```
