import { useEffect, useState } from 'react';

// Arte de título (logo) baixada fora da tela, uma vez por endereço nesta
// abertura do app. Os cards pedem a arte quando o foco para neles, e a página
// de detalhes já a encontra pronta em vez de abrir com o espaço vazio.

/** arte que não chega neste tempo dá lugar ao nome em texto */
const LOGO_WAIT_MS = 4000;

const settled = new Map<string, boolean>();
const loading = new Map<string, Promise<boolean>>();

/** Começa (ou reaproveita) o download da arte; resolve se ela tem imagem. */
export function loadLogo(url: string): Promise<boolean> {
  let request = loading.get(url);
  if (!request) {
    request = new Promise<boolean>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img.naturalWidth > 0);
      img.onerror = () => resolve(false);
      img.src = url;
    });
    request.then((ok) => {
      settled.set(url, ok);
      // falha não fica guardada: a próxima tela tenta de novo
      if (!ok) loading.delete(url);
    });
    loading.set(url, request);
  }
  return request;
}

/**
 * Estado da arte: null enquanto baixa; true pronta; false falhou ou demorou.
 * Arte já baixada responde no primeiro quadro, sem passar pelo vazio.
 */
export function useLogo(url?: string): boolean | null {
  const known = url && settled.get(url) ? true : null;
  const [state, setState] = useState<{ url: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (!url || settled.get(url)) return;
    let alive = true;
    const timer = window.setTimeout(() => alive && setState({ url, ok: false }), LOGO_WAIT_MS);
    loadLogo(url).then((ok) => {
      if (!alive) return;
      window.clearTimeout(timer);
      setState({ url, ok });
    });
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [url]);

  if (!url) return false;
  if (known) return true;
  return state && state.url === url ? state.ok : null;
}

/** Verdadeiro quando a arte já se resolveu ou passou `maxWaitMs`: hora de mostrar o bloco do título. */
export function useLogoSettled(url: string | undefined, maxWaitMs: number): boolean {
  const logo = useLogo(url);
  const [expired, setExpired] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!url) return;
    const timer = window.setTimeout(() => setExpired(url), maxWaitMs);
    return () => window.clearTimeout(timer);
  }, [url, maxWaitMs]);
  return logo !== null || (!!url && expired === url);
}
