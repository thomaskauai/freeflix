import { createContext, useContext, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import {
  COMPACT_W,
  HERO_PEEK,
  MIN_SCALE,
  SHORT_H,
  STAGE_H,
  STAGE_MAX_W,
  STAGE_W,
  TABBAR_H,
} from '../styles/tokens';

export interface StageBox {
  /** px de tela por px do palco */
  scale: number;
  /** tamanho do palco, em px do próprio palco */
  width: number;
  height: number;
  /** tela estreita (celular em pé): menu vira barra embaixo e o conteúdo empilha */
  compact: boolean;
  /** pouca altura (celular deitado): menos respiro vertical */
  short: boolean;
}

function fit(): StageBox {
  const w = window.innerWidth;
  const h = window.innerHeight;
  // Na proporção da TV o palco é 1920×1080 e só muda a escala. Fora dela ele
  // cresce no eixo que sobra, em vez de deixar barras pretas.
  const contain = Math.min(w / STAGE_W, h / STAGE_H);
  // Abaixo desta escala o texto fica ilegível: daí em diante o palco encolhe.
  // Deitada, a tela só chega ao layout compacto se nem assim couber.
  const floor = w >= h ? Math.min(MIN_SCALE, w / COMPACT_W) : MIN_SCALE;
  const scale = Math.max(contain, w / STAGE_MAX_W, floor);
  const width = Math.ceil(w / scale);
  const height = Math.ceil(h / scale);
  return { scale, width, height, compact: width < COMPACT_W, short: height < SHORT_H };
}

const StageContext = createContext<StageBox>({
  scale: 1,
  width: STAGE_W,
  height: STAGE_H,
  compact: false,
  short: false,
});

export const useStage = () => useContext(StageContext);

/** Medidas que dependem do tamanho do palco e o CSS antigo das TVs não sabe calcular (sem min/max). */
function vars(box: StageBox): CSSProperties {
  const usable = box.compact ? box.height - TABBAR_H : box.height;
  // fundo de destaque: a tela inteira, até o limite de um quadro 16:9
  const backdrop = box.compact
    ? Math.round(box.width * 0.86)
    : Math.min(box.height, Math.round((box.width * STAGE_H) / STAGE_W));
  const heroTop = box.short ? 96 : 198;
  return {
    width: box.width,
    height: box.height,
    transform: `scale(${box.scale})`,
    '--stage-w': `${box.width}px`,
    '--stage-h': `${box.height}px`,
    '--page-h': `${usable}px`,
    '--backdrop-h': `${backdrop}px`,
    '--hero-top': `${heroTop}px`,
    // o destaque deixa o título da primeira fileira à vista, sem cortar o próprio texto
    '--hero-h': `${Math.max(backdrop - HERO_PEEK, heroTop + 510)}px`,
  } as CSSProperties;
}

/** Palco em px de TV (1920×1080 na proporção 16:9), escalado e redimensionado para ocupar a janela toda. */
export function Stage({ children }: { children: ReactNode }) {
  const [box, setBox] = useState(fit);

  useEffect(() => {
    const onResize = () => setBox(fit());
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  return (
    <StageContext.Provider value={box}>
      <div className="viewport">
        <div className={`stage${box.compact ? ' is-compact' : ''}${box.short ? ' is-short' : ''}`} style={vars(box)}>
          {children}
        </div>
      </div>
    </StageContext.Provider>
  );
}
