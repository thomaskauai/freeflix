// Completa o app da TV gerado por `vite build --mode tizen` e gera os .wgt
// assinados em tizen-build/, um por formato de ícone:
//   Freeflix-tv-nova.wgt     ícone quadrado (telas iniciais mais recentes)
//   Freeflix-tv-antiga.wgt   ícone 16:9 (telas iniciais antigas, barra de blocos largos)
// O app, a versão e o certificado são os mesmos; a TV lê o ícone na
// instalação, então cada aparelho recebe o pacote com o formato da sua tela.
//
// Assinatura igual à do próprio TizenBrew para TVs antigas: certificado de
// autor Tizen (sem conta Samsung) + distribuidor público do SDK Tizen, via
// tizen.js. Nas TVs Tizen 7+, o TizenBrew Installer reassina por cima.
//
// O certificado de autor é criado na primeira vez e guardado em tizen-cert/
// (fora do git: tem chave privada). Atualizar o app na TV exige o mesmo
// certificado da instalação anterior; sem ele, é preciso desinstalar antes.
//
// Uso: npm run build:tizen
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const forge = require('node-forge');
const JSZip = require('jszip');
const { Signature, TizenCertificateCreator } = require('tizen');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'tizen-build');
const app = path.join(out, 'app');
const certDir = path.join(root, 'tizen-cert');
const authorFile = path.join(certDir, 'author.p12');
const authorInfoFile = path.join(certDir, 'author.json');
const sdkCerts = path.join(homedir(), 'share/.tizen-cert');
/** senhas públicas e fixas dos certificados do SDK Tizen */
const DISTRIBUTOR_PASSWORD = 'tizenpkcs12passfordsigner';
const DEVELOPER_CA_PASSWORD = 'tizencertificatefordevelopercaroqkfwk';

// A TV só aceita o .wgt como atualização do app instalado se o package id e o
// certificado de autor forem os mesmos e a versão for maior. A versão vem do
// package.json (suba com `npm version patch|minor` antes de gerar).
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (!/^\d{1,3}\.\d{1,3}\.\d{1,5}$/.test(version)) {
  throw new Error(`versão "${version}" fora do formato da TV (x.y.z, até 255.255.65535)`);
}
const config = (await readFile(path.join(root, 'config.xml'), 'utf8')).replace(
  /(<widget\b[^>]*?\sversion=")[^"]*(")/,
  `$1${version}$2`,
);
await writeFile(path.join(app, 'config.xml'), config);
// mantém o config.xml do projeto em dia com a versão
await writeFile(path.join(root, 'config.xml'), config);
// hls.js fica fora do bundle da TV; src/streams/loadHls.ts o injeta quando preciso
await mkdir(path.join(app, 'vendor'), { recursive: true });
await copyFile(path.join(root, 'node_modules/hls.js/dist/hls.min.js'), path.join(app, 'vendor/hls.min.js'));
console.log(`app da TV pronto em ${path.relative(root, app)}/`);

const creator = new TizenCertificateCreator();
// certificados do SDK Tizen (download.tizen.org), em ~/share/.tizen-cert
await creator._downloadTizenCertificates();

/**
 * Certificado de autor Tizen emitido pela "Tizen Developers CA" do SDK, como o
 * Certificate Manager do Tizen Studio faz. Não usa o createCertificate do
 * tizen.js: ele grava no .p12 a chave da CA em vez da chave do autor, e a TV
 * recusa a assinatura ("Signed with wrong key").
 */
async function createAuthorCertificate(password) {
  const caCert = forge.pki.certificateFromPem(await readFile(path.join(sdkCerts, 'developer/tizen-developer-ca.cer'), 'utf8'));
  const caKey = forge.pki.decryptRsaPrivateKey(
    await readFile(path.join(sdkCerts, 'developer/tizen-developer-ca-privatekey.pem'), 'utf8'),
    DEVELOPER_CA_PASSWORD,
  );
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = `01${randomBytes(8).toString('hex')}`;
  // válido até a CA expirar, como no Tizen Studio: atualizações só instalam com ele válido
  cert.validity.notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
  cert.validity.notAfter = caCert.validity.notAfter;
  cert.setSubject([{ name: 'commonName', value: 'Freeflix' }]);
  cert.setIssuer(caCert.subject.attributes);
  // mesmas extensões do certificado de autor gerado pelo Tizen Studio
  cert.setExtensions([
    { name: 'basicConstraints', cA: false, critical: true },
    { name: 'keyUsage', digitalSignature: true },
    { name: 'extKeyUsage', codeSigning: true },
  ]);
  cert.sign(caKey, forge.md.sha512.create());
  if (!caCert.verify(cert)) throw new Error('certificado de autor não confere com a CA do SDK');
  const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert, caCert], password, {
    generateLocalKeyId: true,
    friendlyName: 'UserCertificate',
    algorithm: '3des',
  });
  return forge.asn1.toDer(asn1).getBytes();
}

if (!existsSync(authorFile)) {
  const password = randomBytes(18).toString('base64url');
  const cert = await createAuthorCertificate(password);
  await mkdir(certDir, { recursive: true });
  await writeFile(authorFile, cert, { encoding: 'binary' });
  await writeFile(authorInfoFile, `${JSON.stringify({ password }, null, 2)}\n`);
  console.log(`certificado de autor criado em ${path.relative(root, certDir)}/ (guarde: atualizações precisam dele)`);
}

const p12 = (file, password) => forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.createBuffer(file)), false, password);
const { password } = JSON.parse(await readFile(authorInfoFile, 'utf8'));
const author = p12(await readFile(authorFile, 'binary'), password);
const distributor = p12(
  await readFile(path.join(sdkCerts, 'distributor/sdk-public/tizen-distributor-signer.p12'), 'binary'),
  DISTRIBUTOR_PASSWORD,
);

async function listFiles(dir, prefix = '') {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(full, rel)));
    else files.push({ uri: encodeURIComponent(rel), data: await readFile(full) });
  }
  return files;
}

const VARIANTS = [
  { file: 'Freeflix-tv-nova.wgt', icon: 'tizen/icon-quadrado.png' },
  { file: 'Freeflix-tv-antiga.wgt', icon: 'tizen/icon-retangular.png' },
];

for (const name of await readdir(out)) {
  if (name.endsWith('.wgt')) await rm(path.join(out, name));
}
for (const variant of VARIANTS) {
  // o icon.png do config.xml é trocado a cada pacote; a assinatura cobre o ícone
  await copyFile(path.join(root, variant.icon), path.join(app, 'icon.png'));
  const files = await listFiles(app);
  const signedByAuthor = await new Signature('AuthorSignature', files).sign(author);
  const signed = await new Signature('DistributorSignature', signedByAuthor).sign(distributor);
  const zip = new JSZip();
  signed.forEach((file) => zip.file(decodeURIComponent(file.uri), file.data));
  const wgt = path.join(out, variant.file);
  await writeFile(wgt, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  console.log(`.wgt assinado em ${path.relative(root, wgt)} (versão ${version})`);
}
