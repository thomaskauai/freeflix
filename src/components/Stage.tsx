import { useEffect, useState, type ReactNode } from 'react';
import { STAGE_H, STAGE_W } from '../styles/tokens';

function fit() {
  const scale = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
  return {
    scale,
    x: Math.round((window.innerWidth - STAGE_W * scale) / 2),
    y: Math.round((window.innerHeight - STAGE_H * scale) / 2),
  };
}

/** Palco de 1920×1080: 1:1 na TV, escalado para caber na janela do computador. */
export function Stage({ children }: { children: ReactNode }) {
  const [box, setBox] = useState(fit);

  useEffect(() => {
    const onResize = () => setBox(fit());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <div className="viewport">
      <div
        className="stage"
        style={{ transform: `translate(${box.x}px, ${box.y}px) scale(${box.scale})` }}
      >
        {children}
      </div>
    </div>
  );
}
