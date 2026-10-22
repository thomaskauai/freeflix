import { addonBase, fetchStreams, getJson, type AddonManifest, type AddonResource } from '../data/addonClient';
import listed from '../sources.json';

// Addons de fonte de vídeo do aparelho. As da lista padrão (SOURCES_URL) entram
// sozinhas; o espectador pode remover e adicionar outras.

export interface SourceAddon {
  id: string;
  name: string;
  version?: string;
  base: string;
  /** tipos e prefixos de id que o addon diz atender; vazio = qualquer */
  types: string[];
  idPrefixes: string[];
}

export type InstallError = 'invalid-url' | 'unreachable' | 'not-an-addon' | 'no-streams' | 'torrent' | 'duplicate';

export class SourceError extends Error {
  constructor(public code: InstallError) {
    super(code);
  }
}

export const INSTALL_ERRORS: Record<InstallError, string> = {
  'invalid-url': 'Isso não parece um endereço. Cole o link completo do manifest, começando por https://.',
  unreachable: 'O endereço não respondeu. Confira o link e a conexão.',
  'not-an-addon': 'O endereço respondeu, mas não é um manifest de addon.',
  'no-streams': 'Este addon não oferece fontes de vídeo (só catálogo ou metadados).',
  torrent: 'Esta fonte entrega torrent, e o Freeflix não toca torrent.',
  duplicate: 'Esta fonte já está instalada.',
};

/**
 * Fontes padrão: instaladas na primeira abertura e, se removidas, oferecidas
 * com um clique em Configurações. A lista é um JSON de { "name", "url" } (url
 * = link do manifest) lido de SOURCES_URL a cada abertura, então mudar o
 * arquivo no main (e o deploy do site) muda as fontes de todas as TVs sem gerar outro .wgt. Sem
 * rede, vale a última lista baixada; na primeira abertura sem rede, a cópia de
 * src/sources.json embutida no app.
 */
export interface ListedSource {
  name: string;
  url: string;
}

// o repositório é privado: a lista sai pelo site (api/sources.ts), publicada a cada deploy do main
const SOURCES_URL =
  (import.meta.env.VITE_SOURCES_URL as string | undefined) || 'https://freefliix.vercel.app/api/sources';
/** a lista remota não pode segurar a abertura: passado isso, vale a guardada */
const SOURCES_TIMEOUT_MS = 6000;
const REMOTE_KEY = 'freeflix.sources.remote';

function validList(value: unknown): ListedSource[] | null {
  if (!Array.isArray(value)) return null;
  const list = (value as unknown[]).filter(
    (s): s is ListedSource =>
      !!s && typeof (s as ListedSource).name === 'string' && typeof (s as ListedSource).url === 'string',
  );
  return list.length ? list : null;
}

function savedRemote(): ListedSource[] | null {
  try {
    return validList(JSON.parse(window.localStorage.getItem(REMOTE_KEY) || 'null'));
  } catch {
    return null;
  }
}

/** Lista em uso: a remota desta abertura, a última guardada ou a embutida. */
let listedNow: ListedSource[] = savedRemote() || validList(listed) || [];
/** a lista veio do endereço remoto nesta abertura (só então fontes saem da TV) */
let fresh = false;

export const listedSources = () => listedNow;

let remote: Promise<void> | null = null;

function fetchListed(): Promise<void> {
  if (!remote) {
    remote = getJson<unknown>(`${SOURCES_URL}?t=${Date.now()}`, SOURCES_TIMEOUT_MS).then(
      (value) => {
        const list = validList(value);
        if (!list) return;
        listedNow = list;
        fresh = true;
        try {
          window.localStorage.setItem(REMOTE_KEY, JSON.stringify(list));
        } catch {
          /* sem persistência nesta sessão */
        }
      },
      () => undefined,
    );
  }
  return remote;
}

/**
 * Preferência entre as fontes instaladas: as da lista na ordem do arquivo; as
 * adicionadas por link vêm depois, na ordem em que entraram.
 */
export function sourcePriority(source: SourceAddon, installed: SourceAddon[]): number {
  const list = listedSources();
  const listedAt = list.map((s) => addonBase(s.url)).indexOf(source.base);
  return listedAt >= 0 ? listedAt : list.length + installed.indexOf(source);
}

/** A fonte listada já está instalada? */
export const isInstalled = (source: ListedSource, installed: SourceAddon[]) =>
  installed.some((s) => s.base === addonBase(source.url));

const KEY = 'freeflix.sources';

export function listSources(): SourceAddon[] {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) || '[]') as SourceAddon[];
  } catch {
    return [];
  }
}

function save(list: SourceAddon[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* sem persistência nesta sessão */
  }
}

function streamResource(manifest: AddonManifest): AddonResource | undefined {
  return (manifest.resources ?? []).filter((r) => (typeof r === 'string' ? r : r.name) === 'stream')[0];
}

/** títulos bem conhecidos, só para ver que tipo de fonte o addon devolve */
const PROBES: Record<string, string> = { movie: 'tt0111161', series: 'tt0903747:1:1' };

/**
 * O addon só entrega torrent? Vale a marca p2p do manifest; sem ela, pergunta
 * por um título conhecido e olha a resposta. Na dúvida (sem resposta, lista
 * vazia), devolve false: não é motivo para recusar a instalação.
 */
async function servesOnlyTorrent(manifest: AddonManifest, base: string, types: string[]): Promise<boolean> {
  if (manifest.behaviorHints && manifest.behaviorHints.p2p) return true;
  const type =
    types.length === 0 || types.indexOf('movie') >= 0 ? 'movie' : types.indexOf('series') >= 0 ? 'series' : '';
  if (!type) return false;
  try {
    const streams = await fetchStreams(base, type, PROBES[type]);
    return streams.length > 0 && streams.every((s) => !s.url && !!s.infoHash);
  } catch {
    return false;
  }
}

/** Baixa o manifest do endereço colado e, se for um addon de fontes que o app toca, instala. */
export async function installSource(input: string): Promise<SourceAddon> {
  const base = addonBase(input);
  if (!/^https?:\/\/[^\s/]+/i.test(base)) throw new SourceError('invalid-url');
  if (listSources().some((s) => s.base === base)) throw new SourceError('duplicate');

  let manifest: AddonManifest;
  try {
    manifest = await getJson<AddonManifest>(`${base}/manifest.json`);
  } catch {
    throw new SourceError('unreachable');
  }
  if (!manifest || !manifest.id || !manifest.name) throw new SourceError('not-an-addon');

  const resource = streamResource(manifest);
  if (!resource) throw new SourceError('no-streams');
  const scoped = typeof resource === 'string' ? null : resource;

  const addon: SourceAddon = {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    base,
    types: (scoped && scoped.types) || manifest.types || [],
    idPrefixes: (scoped && scoped.idPrefixes) || manifest.idPrefixes || [],
  };
  if (await servesOnlyTorrent(manifest, base, addon.types)) throw new SourceError('torrent');

  save([...listSources(), addon]);
  return addon;
}

export function removeSource(base: string) {
  save(listSources().filter((s) => s.base !== base));
}

/** fontes padrão já instaladas uma vez; removidas pelo espectador, não voltam sozinhas */
const DEFAULTS_KEY = 'freeflix.sources.defaults';

function installedDefaults(): string[] {
  try {
    return JSON.parse(window.localStorage.getItem(DEFAULTS_KEY) || '[]') as string[];
  } catch {
    return [];
  }
}

function saveDefaults(urls: string[]) {
  try {
    window.localStorage.setItem(DEFAULTS_KEY, JSON.stringify(urls));
  } catch {
    /* sem persistência nesta sessão */
  }
}

const markDefault = (url: string) => saveDefaults([...installedDefaults(), url]);

let defaults: Promise<void> | null = null;

/**
 * Busca a lista de fontes e instala as que ainda não entraram, uma por vez, na
 * ordem da lista. Sem rede, a fonte fica para a próxima abertura; recusada por
 * outro motivo (já instalada, só torrent…), não tenta mais. Fonte padrão que
 * saiu da lista remota sai também da TV. Chamar de novo devolve a mesma
 * promessa: quem vai tocar um vídeo espera as fontes chegarem.
 */
export function installDefaultSources(): Promise<void> {
  if (!defaults) {
    defaults = fetchListed().then(() => {
      const list = listedSources();
      const done = installedDefaults();
      if (fresh) {
        const kept = list.map((s) => addonBase(s.url));
        done
          .filter((url) => kept.indexOf(addonBase(url)) < 0)
          .forEach((url) => removeSource(addonBase(url)));
        const still = done.filter((url) => kept.indexOf(addonBase(url)) >= 0);
        if (still.length !== done.length) saveDefaults(still);
      }
      return list
        .filter((s) => done.indexOf(s.url) < 0)
        .reduce(
          (previous, s) =>
            previous.then(() =>
              installSource(s.url).then(
                () => markDefault(s.url),
                (err) => {
                  if (!(err instanceof SourceError) || err.code !== 'unreachable') markDefault(s.url);
                },
              ),
            ),
          Promise.resolve(),
        );
    });
  }
  return defaults;
}
