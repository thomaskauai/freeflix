import type Hls from 'hls.js';

type HlsClass = typeof Hls;

/** Na TV: hls.js como script à parte, injetado só quando uma fonte HLS precisar dele. */
function fromScript(): Promise<HlsClass> {
  const global = window as unknown as { Hls?: HlsClass };
  if (global.Hls) return Promise.resolve(global.Hls);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'vendor/hls.min.js';
    script.onload = () => (global.Hls ? resolve(global.Hls) : reject(new Error('hls.js não carregou')));
    script.onerror = () => reject(new Error('hls.js não carregou'));
    document.head.appendChild(script);
  });
}

/**
 * hls.js sob demanda. No navegador, por import() dinâmico. No build da TV o
 * bundle é um script clássico, sem import(): lá ele vem de vendor/hls.min.js,
 * para os 600 KB não serem lidos e compilados na abertura do app (e a TV quase
 * sempre toca HLS nativo, sem precisar dele).
 */
export const loadHls: () => Promise<HlsClass> =
  import.meta.env.MODE === 'tizen' ? fromScript : () => import('hls.js').then((m) => m.default);
