// Fontes que só entregam o vídeo com Referer ou Origin do site delas (Vidly,
// Cinejoy, VegaMovies… do PenguPlay). O <video> e o hls.js não deixam o app
// mandar esses cabeçalhos; o motor local (torrent-engine/, rota /proxy) manda.
// Com o motor no ar (TV, ou Mac com o motor rodando), essas fontes passam a
// tocar por ele; sem o motor (site em https), continuam de fora.
import type { ParsedStream } from './parse';
import { ENGINE, torrentAvailable } from './torrent';

/** a busca de fontes não espera mais que isso pela resposta do motor */
const ENGINE_WAIT_MS = 1500;

/** O motor responde? Sem resposta em ENGINE_WAIT_MS, segue sem o repasse. */
export function headerProxyAvailable(): Promise<boolean> {
  return Promise.race([
    torrentAvailable().catch(() => false),
    new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), ENGINE_WAIT_MS)),
  ]);
}

export function proxiedUrl(url: string, headers: Record<string, string>): string {
  return `${ENGINE}/proxy?u=${encodeURIComponent(url)}&h=${encodeURIComponent(JSON.stringify(headers))}`;
}

/** Fonte que só faltava cabeçalho vira tocável pelo motor; as outras ficam como estão. */
export function viaHeaderProxy(s: ParsedStream): ParsedStream {
  if (s.unplayable !== 'headers' || !s.url || !s.headers) return s;
  return { ...s, url: proxiedUrl(s.url, s.headers), unplayable: undefined };
}
