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

A Samsung não deixa instalar apps fora da loja pelo jeito normal. O caminho é o
**TizenBrew Installer**, um programa que roda no computador, conecta na TV pela rede (no
modo de desenvolvedor dela) e instala o arquivo do app (`.wgt`).

Você vai precisar de:

- uma TV Samsung de **2017 ou mais nova** (Tizen 3.0+);
- um computador (Windows, macOS ou Linux) **na mesma rede Wi-Fi/cabo** da TV;
- em TVs **Tizen 7 ou mais novo** (em geral, 2023 em diante): uma **conta Samsung**
  (grátis). Veja [Qual é o Tizen da minha TV?](#qual-é-o-tizen-da-minha-tv).

O processo leva uns 15 minutos na primeira vez.

### Qual é o Tizen da minha TV?

O jeito de instalar muda num ponto só: **a partir do Tizen 7**, a TV só aceita apps
assinados com um certificado ligado a uma conta Samsung. Abaixo disso, não precisa de
conta.

Você não precisa descobrir o número exato: o TizenBrew Installer lê a versão da TV quando
conecta e, se for Tizen 7+, pede o login da Samsung sozinho. Mas dá para saber antes pelo
**ano do modelo**:

| Ano da TV | Tizen de fábrica | Precisa de conta Samsung? |
|---|---|---|
| 2017 | 3.0 | não |
| 2018 | 4.0 | não |
| 2019 | 5.0 | não |
| 2020 | 5.5 | não |
| 2021 | 6.0 | não |
| 2022 | 6.5 | não |
| 2023 | 7.0 | **sim** |
| 2024 | 8.0 | **sim** |
| 2025 em diante | 9.0+ | **sim** |

Cuidado: a Samsung tem atualizado o sistema de algumas TVs para um Tizen mais novo. Se a
sua recebeu essa atualização, vale a versão atual, não a de fábrica. Na dúvida, siga o
passo a passo: o Installer avisa.

**Como achar o ano da TV:** o código do modelo está na etiqueta atrás da TV e em
**Configurações → Suporte → Sobre esta TV**. Uma letra do código indica o ano:

| Letra | M | N | R | T | A | B | C | D | F |
|---|---|---|---|---|---|---|---|---|---|
| Ano | 2017 | 2018 | 2019 | 2020 | 2021 | 2022 | 2023 | 2024 | 2025 |

Exemplos: `UN55`**`R`**`U7100` é 2019 (Tizen 5); `QN55Q60`**`C`** é 2023 (Tizen 7);
`QN43QE`**`F`**`1A` é 2025 (Tizen 9). Nas TVs LED a letra vem logo depois do tamanho; nas
QLED, no fim do nome da série.

### O arquivo do app

Baixe o **[Freeflix.wgt](https://github.com/thomaskauai/freeflix/releases/latest/download/Freeflix.wgt)**
(página de [Releases](https://github.com/thomaskauai/freeflix/releases/latest)). É o mesmo
arquivo para qualquer TV.

### Passo 1: anotar o IP do computador

A TV precisa saber qual computador pode instalar apps nela.

- **Windows**: abra o Prompt de Comando, digite `ipconfig` e anote o "Endereço IPv4"
  (algo como `192.168.0.10`).
- **macOS**: Ajustes do Sistema → Wi-Fi → Detalhes da rede conectada → Endereço IP. Ou no
  Terminal: `ipconfig getifaddr en0`.
- **Linux**: `hostname -I` (o primeiro número).

### Passo 2: ligar o modo de desenvolvedor na TV

1. Na TV, abra **Apps** (na tela inicial).
2. Com a tela de Apps aberta, digite **`1 2 3 4 5`** no controle. Se o controle não tem
   números (o controle fino, com bateria solar), aperte o botão **`123`** ou segure o de
   cor/número para abrir o teclado numérico na tela.
3. Aparece a janela **Developer Mode**. Mude para **On**.
4. Em **Host PC IP**, digite o IP do computador do passo 1. Confirme com **OK**.
5. **Reinicie a TV de verdade**: segure o botão liga/desliga do controle até aparecer o
   logo da Samsung (só desligar e ligar não basta: a TV fica em espera).
6. Depois de reiniciar, a tela de Apps mostra "Developer Mode" no topo.

Anote também o **IP da TV**: Configurações → Geral → Rede → Status da rede → Config. IP.

### Passo 3: baixar o TizenBrew Installer no computador

Baixe da página de releases do
[TizenBrew Installer](https://github.com/reisxd/TizenBrewInstaller/releases/latest) o
arquivo do seu sistema:

| Sistema | Arquivo |
|---|---|
| Windows | `TizenBrewInstaller-win-x64.exe` |
| Mac com chip Apple (M1, M2…) | `TizenBrewInstaller-macos-arm64` |
| Mac com Intel | `TizenBrewInstaller-macos-x64` |
| Linux | `TizenBrewInstaller-linux-x64` |

Baixe também o [Freeflix.wgt](#o-arquivo-do-app).

Para abrir:

- **Windows**: dois cliques. Se aparecer "O Windows protegeu o computador", clique em
  **Mais informações → Executar assim mesmo**. Se o firewall perguntar, permita acesso à
  rede privada.
- **macOS / Linux**: pelo Terminal, na pasta do download:

  ```bash
  chmod +x TizenBrewInstaller-macos-arm64
  xattr -d com.apple.quarantine TizenBrewInstaller-macos-arm64   # só no macOS
  ./TizenBrewInstaller-macos-arm64
  ```

O Installer abre uma página no navegador (`http://localhost:8091`). Se não abrir,
abra esse endereço à mão. **Deixe o programa (a janela do terminal) aberto** enquanto
instala.

### Passo 4: conectar na TV

Com a TV ligada, na página do Installer, clique em **Connect to TV**, digite o **IP da
TV** e aperte Enter (ou clique fora da caixa). Em alguns segundos aparecem os botões de
instalação.

Se der erro, veja [Problemas comuns](#problemas-comuns).

### Passo 5 (só Tizen 7+): entrar na conta Samsung

Em TV Tizen 7 ou mais nova, o Installer mostra **"Resigning required"**:

1. Clique em **Sign in to Samsung Account**. Abre a página de login da Samsung.
2. Entre com sua conta (ou crie uma, é grátis).
3. Volte para a página do Installer. Ele cria um certificado ligado à sua conta e à TV.
   Isso leva alguns segundos.

Em TV abaixo do Tizen 7 esse passo não aparece. Siga adiante.

### Passo 6: instalar o Freeflix

1. Clique em **Select file to install**.
2. Escolha o `Freeflix.wgt` que você baixou.
3. Acompanhe o status: *Resigning* (só Tizen 7+), *Installing*, e por fim **Package
   installed**.

Pronto. O Freeflix aparece em **Apps** na TV (às vezes no fim da lista). Para colocá-lo na
tela inicial, selecione o ícone, segure OK e escolha **Adicionar à Início**.

Você não precisa instalar o "TizenBrew" em si (o botão **Install TizenBrew**): ele é outro
app, para módulos. Para o Freeflix basta o Installer.

Deixe o modo de desenvolvedor ligado: ele é necessário para instalar atualizações.

### Atualizar para uma versão nova

Repita os passos 3 a 6 com o `Freeflix.wgt` novo da página de Releases. A TV troca o app sem
perder o que você assistiu e o código da casa.

A TV só aceita o arquivo como atualização se ele foi assinado com o mesmo certificado do
app instalado. Em Tizen 7+, o certificado vem da conta Samsung: use **sempre a mesma
conta**. O Installer v1.1.3 apaga o certificado salvo depois de cada instalação, então ele
pede o login de novo a cada vez; é normal.

### Problemas comuns

**"Could not connect to the SDB Daemon. Make sure that the TV is on and that the IP is
correct."**
O IP da TV está errado ou a TV está desligada/em espera. Confira o IP da TV (passo 2) e
se os dois aparelhos estão na mesma rede (Wi-Fi de visitantes e redes "5G" separadas às
vezes isolam os aparelhos).

**"Either you haven't set the Host PC IP to this device's IP, or you didn't restart the
TV properly."**
O Host PC IP na TV não é o do computador, ou a TV não reiniciou de verdade. Refaça o
passo 2 e reinicie segurando o botão liga/desliga até o logo da Samsung. O IP do
computador pode mudar de um dia para o outro (DHCP): confira de novo.

**Conectou uma vez, mas a segunda tentativa falha.**
A TV aceita uma conexão por vez. Feche o Installer (Ctrl+C no terminal ou feche a
janela), abra de novo e reconecte.

**"Author certificate not match" / falha ao atualizar.**
O app na TV foi instalado com outro certificado (outra conta Samsung, ou um `.wgt` de
outra origem). Desinstale o Freeflix na TV (Apps → selecione o ícone → segure OK →
Excluir) e instale de novo. Isso apaga os dados locais do app; se a TV estava numa casa
sincronizada, ela volta sozinha para a casa e recupera o histórico.

**Tizen 7+: erro ao assinar (Resigning).**
Saia e entre na conta Samsung de novo (botão de login). Confira se o computador tem
internet: o certificado é criado nos servidores da Samsung.

**O app instalou mas não abre / tela preta.**
Confira se a TV tem internet. O catálogo e as fontes vêm da rede.

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
