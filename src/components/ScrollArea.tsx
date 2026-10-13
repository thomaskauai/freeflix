import { useEffect, useRef, useState, type FocusEvent, type ReactNode, type WheelEvent } from 'react';
import { isPointerFocus } from '../focus/FocusContext';
import { useStage } from './Stage';
import { useTouchScroll } from './useTouchScroll';

/** a esta distância do fim, avisa quem carrega conteúdo sob demanda */
const NEAR_END_PX = 1400;
export const NEAR_END_EVENT = 'freeflix:near-end';

/**
 * Rolagem vertical por transform. Com controle ou teclado, é guiada pelo foco:
 * ao focar algo dentro de um [data-scroll-anchor], o conteúdo desliza até a
 * âncora ficar no y indicado (em px), ou volta ao topo com "top". Com mouse ou
 * dedo, a roda e o arrasto rolam livres, como numa página comum.
 */
export function ScrollArea({ className, children }: { className?: string; children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [y, setY] = useState(0);
  // posição atual fora do estado: vários eventos de roda chegam entre dois renders
  const position = useRef(0);
  position.current = y;
  // rolagem livre acompanha a roda sem animação; a guiada por foco desliza
  const [free, setFree] = useState(false);
  const stage = useStage();

  const limit = () => {
    const box = outer.current;
    const root = inner.current;
    return box && root ? Math.max(0, root.scrollHeight - box.offsetHeight) : 0;
  };

  // Rolagem livre (roda ou dedo): sem animação e sem depender do foco.
  const scrollFree = (target: number) => {
    const max = limit();
    // quem rola assim está de mouse ou toque, mesmo sem ter mexido o ponteiro ainda
    document.documentElement.classList.add('is-pointer');
    setFree(true);
    const next = Math.min(max, Math.max(0, target));
    position.current = next;
    setY(next);
    if (max - next < NEAR_END_PX) window.dispatchEvent(new Event(NEAR_END_EVENT));
  };

  useTouchScroll(outer, { axis: 'y', scale: stage.scale, get: () => position.current, max: limit, set: scrollFree });

  // Janela redimensionada ou aparelho girado: a posição não pode passar do novo fim.
  useEffect(() => {
    const max = limit();
    if (position.current > max) setY(max);
  }, [stage.width, stage.height]);

  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    // Foco vindo do ponteiro não rola a página; quem rola é a roda do mouse.
    if (isPointerFocus()) return;
    const root = inner.current;
    const anchor = (e.target as HTMLElement).closest<HTMLElement>('[data-scroll-anchor]');
    if (!root || !anchor || !root.contains(anchor)) return;

    setFree(false);
    const rest = anchor.getAttribute('data-scroll-anchor');
    if (rest === 'top') {
      setY(0);
      return;
    }
    let top = 0;
    for (let node: HTMLElement | null = anchor; node && node !== root; node = node.offsetParent as HTMLElement | null) {
      top += node.offsetTop;
    }
    setY(Math.max(0, top - Number(rest)));
  };

  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    // roda mais horizontal que vertical é das fileiras
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    // o palco é escalado para caber na janela; a roda vem em pixels de tela
    scrollFree(position.current + e.deltaY / stage.scale);
  };

  return (
    <div ref={outer} className={`scroll-area${className ? ` ${className}` : ''}`} onFocus={onFocus} onWheel={onWheel}>
      <div
        ref={inner}
        className={`scroll-inner${free ? ' is-free' : ''}`}
        style={{ transform: `translate3d(0, ${-y}px, 0)` }}
      >
        {children}
      </div>
    </div>
  );
}
