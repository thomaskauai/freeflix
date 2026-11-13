// Endereço final das fontes HTTP. O link de uma fonte passa por 2 a 4
// redirecionamentos até o arquivo (cada um 0,3 a 0,6 s); o player da TV refaz o
// caminho a cada pulo no vídeo. Descoberto antes, o <video> vai direto ao
// arquivo: abre mais rápido e o avanço responde em ~0,2 s em vez de ~1,5 s.

/** o endereço final é assinado e vale umas 3 h; passado disso, volta o original */
const DIRECT_TTL_MS = 60 * 60 * 1000;
/** sem resposta nesse tempo, fica o link original */
const RESOLVE_TIMEOUT_MS = 4000;

const found: Record<string, { url: string; at: number }> = {};

/**
 * O que a descoberta viu do link: 'video' (respondeu 2xx com algo que não é
 * página), 'dead' (4xx/5xx ou página HTML no lugar do vídeo). Sem resposta,
 * bloqueado (CORS no navegador) ou ainda sem resposta: nada.
 */
export type Verdict = 'video' | 'dead';
const verdicts: Record<string, Verdict | undefined> = {};

/** Veredito já conhecido do link. */
export const verdictOf = (url: string): Verdict | undefined => verdicts[url];
const pending: Record<string, Promise<string> | undefined> = {};

/** Endereço final já conhecido (e ainda novo) do link; senão o próprio link. */
export function directFor(url: string): string {
  const hit = found[url];
  return hit && Date.now() - hit.at < DIRECT_TTL_MS ? hit.url : url;
}

/** Só vale descobrir para links http(s) de fonte, nunca do motor de torrent ou HLS. */
function worth(url: string, hls: boolean): boolean {
  if (hls || !/^https?:\/\//.test(url)) return false;
  return !/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url);
}

/**
 * Segue os redirecionamentos do link e guarda onde ele termina. Um GET simples
 * (sem cabeçalho extra, sem preflight), cancelado assim que chegam os
 * cabeçalhos: nada do vídeo é baixado. Nunca falha: devolve o link a usar.
 */
export function resolveDirect(url: string, hls = false): Promise<string> {
  if (!worth(url, hls)) return Promise.resolve(url);
  const known = directFor(url);
  if (known !== url) return Promise.resolve(known);
  const running = pending[url];
  if (running) return running;
  const job = new Promise<string>((done) => {
    let xhr: XMLHttpRequest;
    try {
      xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
    } catch {
      done(url);
      return;
    }
    let settled = false;
    const finish = (final: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      try {
        xhr.abort();
      } catch {
        // já terminou
      }
      // página em https não toca vídeo de http: aí fica o link original
      const mixed = window.location.protocol === 'https:' && final.indexOf('http:') === 0;
      if (final && final !== url && !mixed) found[url] = { url: final, at: Date.now() };
      done(directFor(url));
    };
    const timer = window.setTimeout(() => finish(url), RESOLVE_TIMEOUT_MS);
    xhr.onreadystatechange = () => {
      if (xhr.readyState < 2) return;
      const status = xhr.status;
      let type = '';
      try {
        type = xhr.getResponseHeader('content-type') || '';
      } catch {
        // sem acesso aos cabeçalhos
      }
      // status 0: bloqueado (CORS) ou cancelado; aí não se sabe nada
      if (status >= 400 || (status >= 200 && status < 300 && /text\/html/i.test(type))) verdicts[url] = 'dead';
      else if (status >= 200 && status < 300) verdicts[url] = 'video';
      finish(status >= 200 && status < 400 ? xhr.responseURL || url : url);
    };
    xhr.onerror = () => finish(url);
    xhr.send();
  });
  pending[url] = job;
  job.then(() => delete pending[url]);
  return job;
}

/** O link original falhou com o endereço final (assinatura vencida): esquece. */
export function forgetDirect(url: string) {
  delete found[url];
}
