import { useEffect, useState } from 'react';
import { useKeyHandler } from '../focus/keys';

const W = 1200;
const H = 400;
const BASELINE = 236;
/** topo das maiúsculas: a deformação estica as letras a partir daqui */
const CAP_TOP = 66;
const STRIPS = 96;
/** quanto o centro da palavra fica mais curto que as pontas */
const ARCH = 0.12;
/** letras altas e estreitas: a fonte é esticada na vertical além do condensado dela */
const TALL = 1.42;
/** tamanho na tela em relação ao desenho */
const DISPLAY = 0.8;
const DURATION_MS = 2000;
const FONT_WAIT_MS = 1200;

/**
 * Marca com a base em arco: topo reto, letras das pontas mais altas que as do
 * meio. SVG não tem "warp" de texto, então a palavra é fatiada em tiras
 * verticais e cada tira é esticada na altura conforme a posição.
 */
function Wordmark() {
  const strips = [];
  const step = W / STRIPS;
  for (let i = 0; i < STRIPS; i++) {
    const u = ((i + 0.5) / STRIPS) * 2 - 1; // -1 nas pontas, 0 no centro
    const scale = TALL * (1 - ARCH * (1 - u * u));
    strips.push(
      <g key={i} clipPath={`url(#splash-strip-${i})`}>
        <use
          href="#splash-word"
          xlinkHref="#splash-word"
          transform={`translate(0 ${CAP_TOP}) scale(1 ${scale}) translate(0 ${-CAP_TOP})`}
        />
      </g>,
    );
  }
  return (
    <svg className="splash__mark" viewBox={`0 0 ${W} ${H}`} width={W * DISPLAY} height={H * DISPLAY} aria-label="Freeflix">
      <defs>
        <text id="splash-word" className="splash__word" x={W / 2} y={BASELINE} textAnchor="middle">
          FREEFLIX
        </text>
        {Array.from({ length: STRIPS }, (_, i) => (
          <clipPath key={i} id={`splash-strip-${i}`}>
            {/* meio pixel de sobra evita frestas entre as tiras */}
            <rect x={i * step - 0.5} y={0} width={step + 1} height={H} />
          </clipPath>
        ))}
      </defs>
      {strips}
    </svg>
  );
}

/** Abertura: a marca surge no centro, cresce devagar, avança e some. Só no load inicial. */
export function Splash({ onDone }: { onDone: () => void }) {
  const [ready, setReady] = useState(false);

  // Espera a fonte: com a de reserva, a marca apareceria errada e trocaria no meio.
  useEffect(() => {
    let alive = true;
    const start = () => alive && setReady(true);
    const timeout = window.setTimeout(start, FONT_WAIT_MS);
    try {
      document.fonts.load('800 40px "Archivo Variable"', 'FREEFLIX').then(start, start);
    } catch {
      start();
    }
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

  return <div className={`splash${ready ? ' is-playing' : ''}`}>{ready && <Wordmark />}</div>;
}
