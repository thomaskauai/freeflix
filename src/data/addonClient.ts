// Cliente do protocolo de addons (o mesmo do Stremio): um addon é um servidor
// HTTP que responde JSON em rotas fixas a partir de um endereço base.

export interface AddonCatalog {
  type: string;
  id: string;
  name: string;
  extra?: { name: string; isRequired?: boolean; options?: string[] }[];
}

export type AddonResource = string | { name: string; types?: string[]; idPrefixes?: string[] };

export interface AddonManifest {
  id: string;
  name: string;
  version?: string;
  description?: string;
  resources?: AddonResource[];
  types?: string[];
  idPrefixes?: string[];
  catalogs?: AddonCatalog[];
  behaviorHints?: { p2p?: boolean };
}

export interface AddonMeta {
  id: string;
  type: string;
  name: string;
  poster?: string;
  background?: string;
  logo?: string;
  description?: string;
  releaseInfo?: string;
  runtime?: string;
  genres?: string[];
  imdbRating?: string;
  language?: string;
  /** código (BR) no catálogo principal; nome (Brazil) no de streamings */
  country?: string;
  videos?: {
    id: string;
    title?: string;
    name?: string;
    season?: number;
    episode?: number;
    runtime?: string;
    thumbnail?: string;
    overview?: string;
    /** data em que foi ao ar (ISO) */
    released?: string;
  }[];
}

export interface AddonStream {
  name?: string;
  title?: string;
  description?: string;
  url?: string;
  infoHash?: string;
  ytId?: string;
  externalUrl?: string;
  behaviorHints?: {
    notWebReady?: boolean;
    videoSize?: number;
    filename?: string;
    proxyHeaders?: { request?: Record<string, string> };
  };
}

const TIMEOUT_MS = 12000;
const cache = new Map<string, Promise<unknown>>();

/** Aceita a URL do manifest como o usuário cola (https ou stremio://) e devolve o endereço base. */
export function addonBase(input: string): string {
  return input
    .trim()
    .replace(/^stremio:\/\//i, 'https://')
    .replace(/\/manifest\.json(\?.*)?$/i, '')
    .replace(/\/+$/, '');
}

export async function getJson<T>(url: string, timeoutMs = TIMEOUT_MS): Promise<T> {
  // AbortController não existe nos WebViews mais antigos; lá vale só a corrida com o timer.
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timer = 0;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => {
      if (controller) controller.abort();
      reject(new Error('timeout'));
    }, timeoutMs);
  });
  try {
    const res = await Promise.race([fetch(url, controller ? { signal: controller.signal } : undefined), timeout]);
    if (!res.ok) throw new Error(`http ${res.status}`);
    return (await res.json()) as T;
  } finally {
    window.clearTimeout(timer);
  }
}

function cached<T>(url: string): Promise<T> {
  const hit = cache.get(url);
  if (hit) return hit as Promise<T>;
  const request = getJson<T>(url);
  cache.set(url, request);
  // falha não fica guardada: a próxima tentativa refaz
  request.catch(() => cache.delete(url));
  return request;
}

/** JSON de qualquer endereço, guardado como os do addon (falha não fica guardada). */
export const fetchCached = <T>(url: string) => cached<T>(url);

export const fetchManifest = (base: string) => cached<AddonManifest>(`${base}/manifest.json`);

export function fetchCatalog(base: string, type: string, id: string, extra?: Record<string, string>) {
  const args = extra
    ? Object.keys(extra)
        .map((k) => `${k}=${encodeURIComponent(extra[k])}`)
        .join('&')
    : '';
  return cached<{ metas?: AddonMeta[] }>(`${base}/catalog/${type}/${id}${args ? `/${args}` : ''}.json`).then(
    (r) => r.metas ?? [],
  );
}

export const fetchMeta = (base: string, type: string, id: string) =>
  cached<{ meta?: AddonMeta }>(`${base}/meta/${type}/${encodeURIComponent(id)}.json`).then((r) => r.meta ?? null);

/** alguns addons levam 12 s ou mais; o play não espera por eles (streams/resolve.ts) */
const STREAMS_TIMEOUT_MS = 16000;

/** Fontes não ficam em cache: links de vídeo expiram. */
export const fetchStreams = (base: string, type: string, videoId: string) =>
  getJson<{ streams?: AddonStream[] }>(
    `${base}/stream/${type}/${encodeURIComponent(videoId)}.json`,
    STREAMS_TIMEOUT_MS,
  ).then((r) => r.streams ?? []);
