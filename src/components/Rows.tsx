import { useState } from 'react';
import type { Row as RowData } from '../data/types';
import { Card } from './Card';
import { Row } from './Row';

export interface RowWithProgress extends RowData {
  /** id do título -> 0..1 */
  progress?: Record<string, number>;
}

interface RowsProps {
  rows: RowWithProgress[];
  /** foco inicial no primeiro card (páginas sem hero) */
  autoFocusFirst?: boolean;
  /** primeira fileira não rola a página, para o cabeçalho continuar visível */
  keepHeader?: boolean;
  onFocus?: () => void;
}

/** Pilha de fileiras; enquanto uma está em foco, as outras recuam. */
export function Rows({ rows, autoFocusFirst, keepHeader, onFocus }: RowsProps) {
  const [focused, setFocused] = useState(false);
  const [activeRow, setActiveRow] = useState(0);

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
        <Row
          key={row.id}
          title={row.title}
          variant={row.style}
          anchor={keepHeader && r === 0 ? 'top' : undefined}
          passed={focused && r < activeRow}
          onActivate={() => setActiveRow(r)}
        >
          {row.items.map((title, i) => (
            <Card
              key={title.id}
              title={title}
              variant={row.style}
              focusId={`${row.id}:${title.id}`}
              autoFocus={autoFocusFirst && r === 0 && i === 0}
              progress={row.progress ? row.progress[title.id] : undefined}
            />
          ))}
        </Row>
      ))}
    </div>
  );
}
