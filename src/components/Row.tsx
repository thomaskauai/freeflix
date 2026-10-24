import { useLayoutEffect, useRef, useState, type FocusEvent, type ReactNode, type WheelEvent } from 'react';
import { focusElement, isPointerFocus } from '../focus/FocusContext';
import { ROW_ANCHOR, ROW_CLIP_PAD, ROW_END_GAP } from '../styles/tokens';
import { Icon } from './Icon';
import { useStage } from './Stage';
import { useTouchScroll } from './useTouchScroll';

/** quantos cards as setas do mouse avançam por clique */
const ARROW_STEP = 4;
/** foco a esta distância do último card pede mais itens */
const NEAR_END_ITEMS = 6;

interface RowProps {
  title: string;
  variant: 'poster' | 'tall' | 'wide' | 'episode' | 'pills';
  /** y de repouso quando focada; "top" mantém a página no topo */
  anchor?: number | 'top';
  /** já ficou acima da fileira em foco: some, em vez de sobrar uma tira no topo */
  passed?: boolean;
  onActivate?: () => void;
  /** foco ou rolagem perto do último card: hora de trazer mais */
  onNearEnd?: () => void;
  /** abre já mostrando este item na primeira posição (ex.: o episódio da vez) */
  startIndex?: number;
  children: ReactNode;
}

/** Fileira horizontal: o item focado estaciona na primeira posição. */
export function Row({ title, variant, anchor = ROW_ANCHOR, passed, onActivate, onNearEnd, startIndex, children }: RowProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [x, setX] = useState(0);
  const [maxX, setMaxX] = useState(0);
  const [active, setActive] = useState(false);
  // arrastar com a roda/trackpad ou o dedo acompanha o gesto, sem animação
  const [free, setFree] = useState(false);
  const { scale } = useStage();
  // posição atual fora do estado: vários eventos de toque chegam entre dois renders
  const position = useRef(0);
  position.current = x;

  const limit = () => {
    const t = track.current;
    const v = viewport.current;
    const last = t ? (t.lastElementChild as HTMLElement | null) : null;
    if (!t || !v || !last) return 0;
    const visible = v.clientWidth - ROW_CLIP_PAD - ROW_END_GAP;
    return Math.max(0, last.offsetLeft + last.offsetWidth - visible);
  };

  // Posição inicial: o item pedido já à vista, sem deslizar até ele. Vale até o
  // foco entrar na fileira; daí em diante quem manda é o foco.
  const touched = useRef(false);
  const count = Array.isArray(children) ? children.length : 0;
  useLayoutEffect(() => {
    const t = track.current;
    if (touched.current || !t || !startIndex || startIndex < 0 || startIndex >= t.children.length) return;
    const max = limit();
    setMaxX(max);
    setFree(true);
    setX(Math.min((t.children[startIndex] as HTMLElement).offsetLeft, max));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startIndex, count]);

  const onFocus = (e: FocusEvent<HTMLElement>) => {
    touched.current = true;
    setActive(true);
    if (onActivate) onActivate();
    const max = limit();
    setMaxX(max);
    const t = track.current;
    const item = (e.target as HTMLElement).closest<HTMLElement>('[data-focusable]');
    if (!t || !item || !t.contains(item)) return;
    if (onNearEnd && Array.prototype.indexOf.call(t.children, item) >= t.children.length - NEAR_END_ITEMS) onNearEnd();
    // Foco que veio do ponteiro não rola: o card sairia de baixo do cursor.
    if (isPointerFocus()) return;
    setFree(false);
    setX(Math.min(item.offsetLeft, max));
  };

  const slideFree = (target: number) => {
    const max = limit();
    const next = Math.min(max, Math.max(0, target));
    setMaxX(max);
    if (onNearEnd && next >= max - viewport.current!.clientWidth) onNearEnd();
    setFree(true);
    position.current = next;
    setX(next);
  };

  // Mouse: roda horizontal (trackpad, Shift+roda) desliza a fileira livremente.
  const onWheel = (e: WheelEvent<HTMLElement>) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    slideFree(position.current + e.deltaX / scale);
  };

  // Toque: arrastar para o lado desliza a fileira.
  useTouchScroll(viewport, { axis: 'x', scale, get: () => position.current, max: limit, set: slideFree });

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
    setFree(false);
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
      onWheel={onWheel}
    >
      <h2 className="row__title">{title}</h2>
      <div className="row__viewport" ref={viewport}>
        <div
          className={`row__track${free ? ' is-free' : ''}`}
          ref={track}
          style={{ transform: `translate3d(${-x}px, 0, 0)` }}
        >
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
