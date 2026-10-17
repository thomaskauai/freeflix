import { useEffect, useRef, useState } from 'react';
import type { RowStyle, Title } from '../data/types';
import { rememberedFocus } from '../focus/FocusContext';
import { Card } from './Card';
import { Row } from './Row';
import { NEAR_END_EVENT } from './ScrollArea';

export interface RowSource {
  id: string;
  title: string;
  style: RowStyle;
  /** itens já em mãos (ex.: continuar assistindo) */
  items?: Title[];
  /** ou como buscá-los quando a fileira entrar em cena */
  load?: () => Promise<Title[]>;
  /** id do título -> 0..1 */
  progress?: Record<string, number>;
  /** cards mostram a nota IMDb */
  showRating?: boolean;
}

/** quantas fileiras além da focada ficam carregadas */
const AHEAD = 3;
const SKELETONS = 8;

/** Separador entre fileira e título no id de foco; ids de título podem ter ":" (tmdb:123). */
const SEP = '|';

interface LazyRowProps {
  source: RowSource;
  wanted: boolean;
  anchor?: 'top';
  passed: boolean;
  autoFocusFirst?: boolean;
  onActivate: () => void;
  onSettled: () => void;
}

function LazyRow({ source, wanted, anchor, passed, autoFocusFirst, onActivate, onSettled }: LazyRowProps) {
  const [items, setItems] = useState<Title[] | null>(source.items ?? null);
  const settled = useRef(onSettled);
  settled.current = onSettled;

  useEffect(() => {
    if (items || !wanted || !source.load) return;
    let alive = true;
    source.load().then(
      (list) => alive && setItems(list),
      () => alive && setItems([]),
    );
    return () => {
      alive = false;
    };
    // a fonte de uma fileira não muda depois de montada
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);

  useEffect(() => {
    if (items) settled.current();
  }, [items]);

  if (!items && !wanted) return null;
  // lista vazia ou que falhou: a fileira some, em vez de ficar um título sem cards
  if (items && items.length === 0) return null;

  return (
    <Row title={source.title} variant={source.style} anchor={anchor} passed={passed} onActivate={onActivate}>
      {items
        ? items.map((title, i) => (
            <Card
              key={title.id}
              title={title}
              variant={source.style}
              focusId={`${source.id}${SEP}${title.id}`}
              autoFocus={autoFocusFirst && i === 0}
              progress={source.progress ? source.progress[title.id] : undefined}
              showRating={source.showRating}
            />
          ))
        : Array.from({ length: SKELETONS }, (_, i) => (
            <div key={i} className={`card card--${source.style} card--skeleton`}>
              <div className="card__art" />
            </div>
          ))}
    </Row>
  );
}

interface RowsProps {
  rows: RowSource[];
  /** foco inicial no primeiro card (páginas sem hero) */
  autoFocusFirst?: boolean;
  /** primeira fileira não rola a página, para o cabeçalho continuar visível */
  keepHeader?: boolean;
  onFocus?: () => void;
  /** chamado quando as fileiras necessárias para devolver o foco já têm cards */
  onReady?: () => void;
}

/**
 * Pilha de fileiras; enquanto uma está em foco, as outras recuam. As fileiras
 * só buscam seus itens quando o foco chega perto.
 */
export function Rows({ rows, autoFocusFirst, keepHeader, onFocus, onReady }: RowsProps) {
  // Ao voltar para a página, carrega até a fileira onde o foco estava.
  const [resumeRow] = useState(() => {
    const id = rememberedFocus();
    if (!id) return 0;
    const at = rows.map((r) => id.indexOf(r.id + SEP) === 0).indexOf(true);
    return Math.max(0, at);
  });
  const [focused, setFocused] = useState(false);
  const [activeRow, setActiveRow] = useState(resumeRow);
  const [reach, setReach] = useState(resumeRow + AHEAD);
  const settledRows = useRef<Record<number, boolean>>({});
  const announced = useRef(false);

  const settle = (index: number) => {
    settledRows.current[index] = true;
    if (announced.current) return;
    for (let i = 0; i <= Math.min(resumeRow, rows.length - 1); i++) {
      if (!settledRows.current[i]) return;
    }
    announced.current = true;
    if (onReady) onReady();
  };

  useEffect(() => {
    if (rows.length === 0 && !announced.current) {
      announced.current = true;
      if (onReady) onReady();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length]);

  // Rolando com o mouse o foco não desce; quem pede mais fileiras é a rolagem.
  useEffect(() => {
    const more = () => setReach((prev) => Math.min(rows.length, prev + 2));
    window.addEventListener(NEAR_END_EVENT, more);
    return () => window.removeEventListener(NEAR_END_EVENT, more);
  }, [rows.length]);

  return (
    <div
      className={`rows${focused ? ' has-focus' : ''}`}
      onFocus={() => {
        setFocused(true);
        if (onFocus) onFocus();
      }}
      onBlur={() => setFocused(false)}
    >
      {rows.map((row, r) => (
        <LazyRow
          key={row.id}
          source={row}
          wanted={r <= reach}
          anchor={keepHeader && r === 0 ? 'top' : undefined}
          passed={focused && r < activeRow}
          autoFocusFirst={autoFocusFirst && r === 0}
          onActivate={() => {
            setActiveRow(r);
            setReach((prev) => Math.max(prev, r + AHEAD));
          }}
          onSettled={() => settle(r)}
        />
      ))}
    </div>
  );
}
