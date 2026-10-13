import { useEffect, useRef, type RefObject } from 'react';

/** o dedo precisa andar isto, em px de tela, para o gesto virar arrasto e não toque */
const SLOP_PX = 8;
/** quanto da velocidade sobra a cada quadro de 16 ms depois de soltar */
const FRICTION = 0.95;
/** px de tela por ms; abaixo disso a inércia para */
const MIN_SPEED = 0.02;
/** dedo parado por mais que isso antes de soltar: sem inércia */
const REST_MS = 80;

interface TouchScrollTarget {
  axis: 'x' | 'y';
  /** px de tela por px do palco */
  scale: number;
  get: () => number;
  max: () => number;
  set: (position: number) => void;
}

/**
 * Arrasto por toque num eixo, com inércia ao soltar. A rolagem do app é por
 * transform, então o dedo é acompanhado à mão. Cada gesto pertence a um eixo
 * só: a fileira fica com o horizontal e a página com o vertical.
 */
export function useTouchScroll(ref: RefObject<HTMLElement>, target: TouchScrollTarget) {
  const latest = useRef(target);
  latest.current = target;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let state: 'idle' | 'pending' | 'drag' | 'other' = 'idle';
    let startX = 0;
    let startY = 0;
    let grab = 0;
    let origin = 0;
    let last = 0;
    let lastTime = 0;
    let velocity = 0;
    let frame = 0;

    const along = (touch: Touch) => (latest.current.axis === 'x' ? touch.clientX : touch.clientY);

    /** Devolve false quando bateu num dos limites. */
    const moveTo = (position: number) => {
      const clamped = Math.min(latest.current.max(), Math.max(0, position));
      latest.current.set(clamped);
      return clamped === position;
    };

    const stopGlide = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
    };

    const glide = () => {
      let previous = 0;
      const step = (now: number) => {
        const elapsed = previous ? Math.min(64, now - previous) : 16;
        previous = now;
        const free = moveTo(latest.current.get() + (velocity * elapsed) / latest.current.scale);
        velocity *= Math.pow(FRICTION, elapsed / 16);
        frame = free && Math.abs(velocity) > MIN_SPEED ? window.requestAnimationFrame(step) : 0;
      };
      frame = window.requestAnimationFrame(step);
    };

    const onStart = (e: TouchEvent) => {
      stopGlide();
      if (e.touches.length !== 1) {
        state = 'idle';
        return;
      }
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      state = 'pending';
    };

    const onMove = (e: TouchEvent) => {
      if (state === 'idle' || state === 'other') return;
      const touch = e.touches[0];
      if (state === 'pending') {
        const dx = Math.abs(touch.clientX - startX);
        const dy = Math.abs(touch.clientY - startY);
        if (dx < SLOP_PX && dy < SLOP_PX) return;
        if (latest.current.axis === 'x' ? dx <= dy : dy < dx) {
          state = 'other';
          return;
        }
        state = 'drag';
        grab = along(touch);
        origin = latest.current.get();
        last = grab;
        lastTime = e.timeStamp;
        velocity = 0;
      }
      if (e.cancelable) e.preventDefault();
      const now = along(touch);
      const elapsed = e.timeStamp - lastTime;
      if (elapsed > 0) velocity = 0.7 * ((last - now) / elapsed) + 0.3 * velocity;
      last = now;
      lastTime = e.timeStamp;
      moveTo(origin + (grab - now) / latest.current.scale);
    };

    const onEnd = (e: TouchEvent) => {
      const dragged = state === 'drag';
      state = 'idle';
      if (dragged && e.timeStamp - lastTime < REST_MS && Math.abs(velocity) > MIN_SPEED) glide();
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    // não passivo: o arrasto assumido pelo app não pode virar rolagem do navegador
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      stopGlide();
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [ref]);
}
