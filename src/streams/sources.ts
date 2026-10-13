import {
  addonBase,
  fetchStreams,
  getJson,
  type AddonManifest,
  type AddonResource,
} from '../data/addonClient';
import listed from '../sources.json';

// Addons de fonte de vídeo instalados pelo espectador. Nenhum vem embutido.

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
 * Fontes oferecidas com um clique em Configurações. Vêm de src/sources.json,
 * uma lista de { "name", "url" } onde "url" é o link do manifest. O arquivo sai
 * vazio: quem mantém o app decide quais fontes entram ali.
 */
export interface ListedSource {
  name: string;
  url: string;
}

export const LISTED_SOURCES: ListedSource[] = (Array.isArray(listed) ? (listed as unknown[]) : []).filter(
  (s): s is ListedSource =>
    !!s && typeof (s as ListedSource).name === 'string' && typeof (s as ListedSource).url === 'string',
);

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
  const type = types.length === 0 || types.indexOf('movie') >= 0 ? 'movie' : types.indexOf('series') >= 0 ? 'series' : '';
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
