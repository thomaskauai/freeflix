import { useRef, useState, type FocusEvent, type ReactNode } from 'react';
import { isPointerFocus } from '../focus/FocusContext';

/**
 * Rolagem vertical por transform, guiada pelo foco. Ao focar algo dentro de um
 * [data-scroll-anchor], o conteúdo rola até a âncora ficar no y indicado
 * (em px), ou volta ao topo com data-scroll-anchor="top".
 */
export function ScrollArea({ className, children }: { className?: string; children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [y, setY] = useState(0);

  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    // Foco vindo do ponteiro não rola a página; quem rola é a roda do mouse.
    if (isPointerFocus()) return;
    const root = inner.current;
    const anchor = (e.target as HTMLElement).closest<HTMLElement>('[data-scroll-anchor]');
    if (!root || !anchor || !root.contains(anchor)) return;

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

  return (
    <div className={`scroll-area${className ? ` ${className}` : ''}`} onFocus={onFocus}>
      <div ref={inner} className="scroll-inner" style={{ transform: `translate3d(0, ${-y}px, 0)` }}>
        {children}
      </div>
    </div>
  );
}
