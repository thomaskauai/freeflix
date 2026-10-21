// Instala os .wgt de tizen-build/ nas TVs da casa pelo TizenBrew Installer
// Desktop, sem passar pela interface: fala direto com o WebSocket do serviço
// (ws://localhost:8091), como a página /ui/dist/index.html/desktop faz.
//   sala    192.168.18.44  Tizen antigo   Freeflix-tv-antiga.wgt
//   quarto  192.168.18.45  Tizen 7+       Freeflix-tv-nova.wgt (reassinado)
//
// Requisitos na TV: Developer Mode ligado (Apps → 12345) com Host PC IP = IP
// deste Mac, e TV ligada na mesma rede.
//
// TV Tizen 7+ (quarto): o Installer reassina o pacote com o certificado da
// conta Samsung, guardado em ~/share/tizenbrewInstallerConfig.json. A v1.1.3
// apaga esse arquivo depois de cada instalação de arquivo (falta um `break`
// no case InstallFile), então guardamos uma cópia em tizen-cert/ e a
// devolvemos antes e depois de cada instalação. Sem cópia, rode com --login:
// abre a interface, você conecta ao quarto, escolhe o .wgt e entra na conta
// Samsung; o certificado criado é copiado assim que aparece.
//
// Cada TV usa um processo novo do Installer, encerrado no fim (ele prende a
// conexão sdb e a TV recusa a próxima). Feche a interface antes. Binário em
// $TIZENBREW_INSTALLER ou ~/Downloads/TizenBrew/TizenBrewInstaller-macos-arm64;
// se faltar, é baixado da release v1.1.3 com o gh.
//
// Uso: npm run tv:install [-- sala|quarto ...]   (sem argumento: todas)
//      npm run tv:install -- --check              (só testa a conexão)
//      npm run tv:install -- --login              (login Samsung do quarto, uma vez)
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, readFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TVS = {
  sala: { ip: '192.168.18.44', wgt: 'Freeflix-tv-antiga.wgt' },
  quarto: { ip: '192.168.18.45', wgt: 'Freeflix-tv-nova.wgt' },
};
const Events = { InstallPackage: 1, Error: 3, InstallationStatus: 4, DeleteConfiguration: 5, ConnectToTV: 6, InstallFile: 7 };
const RELEASE = 'v1.1.3';
const binary =
  process.env.TIZENBREW_INSTALLER ?? path.join(homedir(), 'Downloads/TizenBrew/TizenBrewInstaller-macos-arm64');
const samsungConfig = path.join(homedir(), 'share/tizenbrewInstallerConfig.json');
const samsungBackup = path.join(root, 'tizen-cert/samsung-installer-config.json');

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const login = args.includes('--login');
const names = args.filter((a) => !a.startsWith('--'));
const targets = names.length ? names : Object.keys(TVS);
for (const name of targets) if (!TVS[name]) throw new Error(`TV "${name}" desconhecida (use: ${Object.keys(TVS).join(', ')})`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** a porta do sdb (26101) só abre com a TV ligada e em Developer Mode */
function sdbReachable(ip) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: ip, port: 26101, timeout: 3000 });
    const done = (ok) => (socket.destroy(), resolve(ok));
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function hasCertificate(file) {
  if (!existsSync(file)) return false;
  const config = JSON.parse(await readFile(file, 'utf8'));
  return Boolean(config.authorCert && config.distributorCert && config.password);
}

/** guarda o certificado Samsung se o Installer tiver um que ainda não salvamos */
async function backupSamsungCertificate() {
  if (await hasCertificate(samsungConfig)) {
    await mkdir(path.dirname(samsungBackup), { recursive: true });
    await copyFile(samsungConfig, samsungBackup);
  }
}

async function restoreSamsungCertificate() {
  if (await hasCertificate(samsungBackup)) {
    await mkdir(path.dirname(samsungConfig), { recursive: true });
    await copyFile(samsungBackup, samsungConfig);
  }
}

async function installerRunning() {
  try {
    return (await fetch('http://localhost:8091/ui/dist/index.html')).ok;
  } catch {
    return false;
  }
}

/**
 * Sobe um Installer novo. Ele não fecha a conexão sdb com a TV ao terminar, e a
 * TV recusa outra enquanto aquela vive; por isso cada TV ganha um processo
 * próprio, encerrado no fim (inclusive um que já estivesse aberto).
 */
async function startInstaller() {
  await stopInstaller();
  if (!existsSync(binary)) {
    console.log(`baixando TizenBrew Installer ${RELEASE}…`);
    await mkdir(path.dirname(binary), { recursive: true });
    execFileSync('gh', ['release', 'download', RELEASE, '-R', 'reisxd/TizenBrewInstaller',
      '-p', 'TizenBrewInstaller-macos-arm64', '-O', binary, '--clobber'], { stdio: 'inherit' });
    await chmod(binary, 0o755);
  }
  spawn(binary, [], { cwd: path.dirname(binary), stdio: 'ignore' });
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    if (await installerRunning()) return;
  }
  throw new Error('TizenBrew Installer não respondeu em localhost:8091');
}

async function stopInstaller() {
  try {
    execFileSync('pkill', ['-f', path.basename(binary)]);
  } catch {
    return; // nenhum rodando
  }
  while (await installerRunning()) await sleep(200);
}

/** abre uma conexão com o serviço e devolve send + espera pelo próximo evento que casar */
function openSession() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://localhost:8091');
    const waiters = [];
    ws.onerror = () => reject(new Error('falha no WebSocket do Installer'));
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === Events.InstallationStatus) console.log(`  ${String(msg.payload).replace('installStatus.', '')}…`);
      const i = waiters.findIndex((w) => w.match(msg));
      if (i !== -1) waiters.splice(i, 1)[0].resolve(msg);
    };
    ws.onopen = () =>
      resolve({
        send: (type, payload) => ws.send(JSON.stringify({ type, payload })),
        next: (match, ms) =>
          new Promise((res, rej) => {
            const timer = setTimeout(() => rej(new Error('tempo esgotado esperando a TV')), ms);
            waiters.push({ match, resolve: (m) => (clearTimeout(timer), res(m)) });
          }),
        close: () => ws.close(),
      });
  });
}

async function install(name) {
  const tv = TVS[name];
  console.log(`\n${name} (${tv.ip})`);
  await startInstaller();
  const session = await openSession();
  try {
    session.send(Events.ConnectToTV, tv.ip);
    const connected = await session.next((m) => m.type === Events.ConnectToTV, 15000).catch(() => null);
    if (!connected?.payload.success) {
      // sondar a porta antes atrapalha a conexão do Installer; só explica a falha
      throw new Error((await sdbReachable(tv.ip))
        ? `não conectou: ${connected?.payload.error ?? 'sem resposta'} (Developer Mode com o IP deste Mac?)`
        : 'TV fora do ar: ligada, na mesma rede e com Developer Mode apontando para este Mac?');
    }
    console.log('  conectada');
    if (checkOnly) return;
    // o Installer descobre a versão do Tizen logo após conectar
    await sleep(1500);

    const wgt = path.join(root, 'tizen-build', tv.wgt);
    if (!existsSync(wgt)) throw new Error(`${path.relative(root, wgt)} não existe (rode npm run build:tizen)`);
    await restoreSamsungCertificate();
    session.send(Events.InstallFile, (await readFile(wgt)).toString('base64'));
    const done = await session.next(
      (m) => m.type === Events.Error || (m.type === Events.InstallPackage && m.payload?.response !== 1),
      180000,
    );
    if (done.type === Events.Error) throw new Error(String(done.payload));
    if (done.payload.response === 2) {
      throw new Error('TV Tizen 7+ sem certificado Samsung: faça o login uma vez pela interface do Installer (conectado a esta TV) e rode de novo');
    }
    const result = String(done.payload.result ?? '').trim();
    if (/fail|error/i.test(result)) throw new Error(`a TV recusou o pacote:\n${result}`);
    console.log(`  instalado ${tv.wgt}${result ? `\n  ${result.replace(/\n+/g, '\n  ')}` : ''}`);
  } finally {
    session.close();
    await stopInstaller();
    await restoreSamsungCertificate();
  }
}

await backupSamsungCertificate();
if (login) {
  await startInstaller();
  execFileSync('open', ['http://localhost:8091/ui/dist/index.html/desktop']);
  console.log(`conecte em ${TVS.quarto.ip}, escolha tizen-build/${TVS.quarto.wgt} e entre na conta Samsung…`);
  while (!(await hasCertificate(samsungConfig))) await sleep(300);
  await backupSamsungCertificate();
  console.log(`certificado Samsung guardado em ${path.relative(root, samsungBackup)}`);
  // deixa a instalação que a interface dispara terminar antes de fechar
  await sleep(60000);
  await stopInstaller();
  await restoreSamsungCertificate();
  process.exit(0);
}
let failed = false;
for (const name of targets) {
  try {
    await install(name);
  } catch (err) {
    failed = true;
    console.error(`  erro: ${err.message}`);
  }
}
process.exit(failed ? 1 : 0);
