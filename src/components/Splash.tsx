import { useEffect, useState } from 'react';
import splash from '../assets/splash.png';
import { useKeyHandler } from '../focus/keys';

/** tamanho da marca na tela (a imagem tem o dobro, para crescer sem borrar) */
const MARK_W = 960;
const MARK_H = 320;
const DURATION_MS = 2000;
const IMAGE_WAIT_MS = 1200;

/**
 * Abertura: a marca surge no centro, cresce devagar, avança e some. Só no load inicial.
 *
 * A marca é uma imagem pronta (scripts/render-splash.mjs): a TV só move e
 * esmaece uma camada, sem redesenhar nada. Desenhada em SVG a cada quadro ela
 * travava nas TVs.
 */
export function Splash({ onDone }: { onDone: () => void }) {
  const [ready, setReady] = useState(false);

  // Espera a imagem decodificada: a animação não começa com ela pela metade.
  useEffect(() => {
    let alive = true;
    const start = () => alive && setReady(true);
    const timeout = window.setTimeout(start, IMAGE_WAIT_MS);
    const img = new Image();
    img.onload = () => (img.decode ? img.decode().then(start, start) : start());
    img.onerror = start;
    img.src = splash;
    return () => {
      alive = false;
      window.clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(onDone, DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [ready, onDone]);

  // O controle só passa a valer quando a abertura termina.
  useKeyHandler(() => true, 100);

  return (
    <div className={`splash${ready ? ' is-playing' : ''}`}>
      {ready && <img className="splash__mark" src={splash} width={MARK_W} height={MARK_H} alt="Freeflix" />}
    </div>
  );
}
