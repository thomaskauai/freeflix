import { useRef, useState, type FocusEvent, type ReactNode } from 'react';
import { focusElement, isPointerFocus } from '../focus/FocusContext';
import { ROW_ANCHOR, ROW_CLIP_PAD, ROW_END_GAP } from '../styles/tokens';
import { Icon } from './Icon';

/** quantos cards as setas do mouse avançam por clique */
const ARROW_STEP = 4;

interface RowProps {
  title: string;
  variant: 'poster' | 'tall' | 'episode';
  /** y de repouso quando focada; "top" mantém a página no topo */
  anchor?: number | 'top';
  /** já ficou acima da fileira em foco: some, em vez de sobrar uma tira no topo */
  passed?: boolean;
  onActivate?: () => void;
  children: ReactNode;
}

/** Fileira horizontal: o item focado estaciona na primeira posição. */
export function Row({ title, variant, anchor = ROW_ANCHOR, passed, onActivate, children }: RowProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [x, setX] = useState(0);
  const [maxX, setMaxX] = useState(0);
  const [active, setActive] = useState(false);

  const limit = () => {
    const t = track.current;
    const v = viewport.current;
    const last = t ? (t.lastElementChild as HTMLElement | null) : null;
    if (!t || !v || !last) return 0;
    const visible = v.clientWidth - ROW_CLIP_PAD - ROW_END_GAP;
    return Math.max(0, last.offsetLeft + last.offsetWidth - visible);
  };

  const onFocus = (e: FocusEvent<HTMLElement>) => {
    setActive(true);
    if (onActivate) onActivate();
    const max = limit();
    setMaxX(max);
    // Foco que veio do ponteiro não rola: o card sairia de baixo do cursor.
    if (isPointerFocus()) return;
    const t = track.current;
    const item = (e.target as HTMLElement).closest<HTMLElement>('[data-focusable]');
    if (!t || !item || !t.contains(item)) return;
    setX(Math.min(item.offsetLeft, max));
  };

  // Setas do mouse: levam o foco alguns cards adiante ou atrás, pelo caminho do teclado.
  const page = (direction: 1 | -1) => {
    const t = track.current;
    if (!t) return;
    const items = Array.from(t.children) as HTMLElement[];
    let first = 0;
    items.forEach((item, i) => {
      if (Math.abs(item.offsetLeft - x) < Math.abs(items[first].offsetLeft - x)) first = i;
    });
    const target = Math.min(items.length - 1, Math.max(0, first + direction * ARROW_STEP));
    focusElement(items[target]);
  };

  return (
    <section
      className={`row row--${variant}${active ? ' is-active' : ''}${passed ? ' is-passed' : ''}`}
      data-focus-group=""
      data-focus-enter="up down"
      data-scroll-anchor={anchor}
      onFocus={onFocus}
      onBlur={() => setActive(false)}
      onMouseEnter={() => setMaxX(limit())}
    >
      <h2 className="row__title">{title}</h2>
      <div className="row__viewport" ref={viewport}>
        <div className="row__track" ref={track} style={{ transform: `translate3d(${-x}px, 0, 0)` }}>
          {children}
        </div>
      </div>
      {x > 0 && (
        <div className="row__arrow row__arrow--prev" aria-label="Anteriores" onClick={() => page(-1)}>
          <Icon name="prev" />
        </div>
      )}
      {x < maxX && (
        <div className="row__arrow row__arrow--next" aria-label="Próximos" onClick={() => page(1)}>
          <Icon name="next" />
        </div>
      )}
    </section>
  );
}
