// Instala os .wgt de tizen-build/ nas TVs da casa pelo TizenBrew Installer
// Desktop, sem passar pela interface: fala direto com o WebSocket do serviço
// (ws://localhost:8091), como a página /ui/dist/index.html/desktop faz.
//   sala    UN55RU7100 (2019)  Tizen 5       Freeflix-tizen5.wgt
//   quarto  QN43QEF1A (2025)   Tizen 9       Freeflix-tizen7.wgt (reassinado)
// O IP é só o último conhecido: se lá não estiver a TV desse modelo, ela é
// procurada na rede pela API da Samsung (porta 8001), já que o DHCP muda o IP.
//
// Requisitos na TV: Developer Mode ligado (Apps → 12345) com Host PC IP = IP
// deste Mac, e TV ligada na mesma rede.
//
// TV Tizen 7+ (quarto): o Installer reassina o pacote com o certificado da
// conta Samsung, guardado em ~/share/tizenbrewInstallerConfig.json. A v1.1.3
// apaga esse arquivo depois de cada instalação de arquivo (falta um `break`
// no case InstallFile), então guardamos uma cópia em tizen-cert/ e a
// devolvemos antes e depois de cada instalação. Sem cópia, rode com --login:
// abre o login da Samsung no navegador e, criado o certificado, guarda e instala.
//
// Cada TV usa um processo novo do Installer, encerrado no fim (ele prende a
// conexão sdb e a TV recusa a próxima). Feche a interface antes. Binário em
// $TIZENBREW_INSTALLER ou ~/Downloads/TizenBrew/TizenBrewInstaller-macos-arm64;
// se faltar, é baixado da release v1.1.3 com o gh.
//
// Uso: npm run tv:install [-- sala|quarto ...]   (sem argumento: todas)
//      npm run tv:install -- --check              (só testa a conexão)
//      npm run tv:install -- quarto --login       (login Samsung + instalação, uma vez)
//      npm run tv:install -- quarto --reinstall   (desinstala antes; apaga os dados do app na TV)
//      npm run tv:install -- quarto --wgt=arquivo.wgt (outro pacote, ex.: um app de teste)
//
// "Author certificate not match": o app na TV foi assinado com outro
// certificado (ex.: o Samsung perdido). Só sai com --reinstall.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const adbhost = require('adbhost');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TVS = {
  sala: { ip: '192.168.18.50', model: 'UN55RU7100GXZD', wgt: 'Freeflix-tizen5.wgt' },
  quarto: { ip: '192.168.18.45', model: 'QN43QEF1AGXZD', wgt: 'Freeflix-tizen7.wgt' },
};
const Events = { InstallPackage: 1, Error: 3, InstallationStatus: 4, DeleteConfiguration: 5, ConnectToTV: 6, InstallFile: 7 };
const RELEASE = 'v1.1.3';
const SAMSUNG_LOGIN = 'https://account.samsung.com/mobile/account/check.do?serviceID=v285zxnl3h&actionID=StartOAuth2&accessToken=Y&redirect_uri=http://localhost:4794/signin/callback';
const binary =
  process.env.TIZENBREW_INSTALLER ?? path.join(homedir(), 'Downloads/TizenBrew/TizenBrewInstaller-macos-arm64');
const samsungConfig = path.join(homedir(), 'share/tizenbrewInstallerConfig.json');
const samsungBackup = path.join(root, 'tizen-cert/samsung-installer-config.json');

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const login = args.includes('--login');
const reinstall = args.includes('--reinstall');
/** --wgt=arquivo: instala esse pacote em vez do Freeflix de tizen-build/ */
const customWgt = (args.filter((a) => a.indexOf('--wgt=') === 0)[0] || '').slice('--wgt='.length);
const PACKAGE_ID = 'FreeFlixTV'; // tizen:application package do config.xml
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

/**
 * Login na conta Samsung, como o botão da interface: a página da Samsung volta
 * para localhost:4794, o Installer cria o certificado (precisa da TV
 * conectada, pois grava o device-profile nela) e avisa com response 1.
 */
async function samsungLogin(session) {
  execFileSync('open', [SAMSUNG_LOGIN]);
  console.log('  entre na conta Samsung na página aberta no navegador…');
  const created = session.next((m) => m.type === Events.InstallPackage && m.payload?.response === 1, 600000);
  await created;
  await backupSamsungCertificate();
  console.log(`  certificado Samsung guardado em ${path.relative(root, samsungBackup)}`);
}

/** desinstala direto pelo sdb, antes de o Installer abrir a conexão dele */
function uninstall(ip) {
  return new Promise((resolve, reject) => {
    const adb = adbhost.createConnection({ host: ip, port: 26101 });
    let output = '';
    const finish = () => {
      adb._stream.end();
      adb._stream.destroy();
      resolve(output);
    };
    adb._stream.once('error', (err) => reject(new Error(`sdb: ${err.message}`)));
    adb._stream.once('connect', () => {
      const shell = adb.createStream(`shell:0 vd_appuninstall ${PACKAGE_ID}`);
      shell.on('data', (chunk) => {
        output += chunk;
        if (output.includes('spend time')) finish();
      });
      shell.on('end', finish);
      shell.on('close', finish);
    });
  });
}

async function tvModel(ip) {
  try {
    const res = await fetch(`http://${ip}:8001/api/v2/`, { signal: AbortSignal.timeout(2000) });
    return (await res.json()).device?.modelName;
  } catch {
    return undefined;
  }
}

/** IP atual da TV: o conhecido, ou o da TV do mesmo modelo achada na sub-rede */
async function locate(tv) {
  if ((await tvModel(tv.ip)) === tv.model) return tv.ip;
  const prefix = tv.ip.split('.').slice(0, 3).join('.');
  const ips = Array.from({ length: 254 }, (_, i) => `${prefix}.${i + 1}`);
  const models = await Promise.all(ips.map(tvModel));
  return ips[models.indexOf(tv.model)];
}

async function install(name) {
  const tv = { ...TVS[name] };
  const ip = await locate(tv);
  if (ip && ip !== tv.ip) console.log(`\n${name}: IP mudou de ${tv.ip} para ${ip} (atualize TVS em scripts/tv-install.mjs)`);
  tv.ip = ip ?? tv.ip;
  console.log(`\n${name} (${tv.ip})`);
  if (reinstall && !checkOnly) {
    await stopInstaller();
    const result = await uninstall(tv.ip);
    console.log(`  desinstalado ${PACKAGE_ID}: ${result.match(/uninstall (completed|failed[^\n]*)/)?.[0] ?? result.trim()}`);
  }
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
    if (login) await samsungLogin(session);

    const wgt = customWgt ? path.resolve(customWgt) : path.join(root, 'tizen-build', tv.wgt);
    if (!existsSync(wgt)) throw new Error(`${path.relative(root, wgt)} não existe (rode npm run build:tizen)`);
    await restoreSamsungCertificate();
    session.send(Events.InstallFile, (await readFile(wgt)).toString('base64'));
    const done = await session.next(
      (m) => m.type === Events.Error || (m.type === Events.InstallPackage && m.payload?.response !== 1),
      180000,
    );
    if (done.type === Events.Error) throw new Error(String(done.payload));
    if (done.payload.response === 2) {
      throw new Error('TV Tizen 7+ sem certificado Samsung: rode npm run tv:install -- quarto --login');
    }
    const result = String(done.payload.result ?? '').trim();
    if (/fail|error/i.test(result)) throw new Error(`a TV recusou o pacote:\n${result}`);
    console.log(`  instalado ${path.basename(wgt)} (${result.match(/install completed|spend time[^\n]*/)?.[0] ?? 'sem saída da TV'})`);
  } finally {
    session.close();
    await stopInstaller();
    await restoreSamsungCertificate();
  }
}

await backupSamsungCertificate();
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
