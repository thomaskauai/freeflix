import { useEffect, useRef } from 'react';
import { usePageActive } from '../pageActive';

export type Action =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'ok'
  | 'back'
  | 'playpause'
  | 'play'
  | 'pause'
  | 'stop'
  | 'ff'
  | 'rw';

// Teclado do PC e controle Tizen no mesmo mapa. Os códigos de mídia são o
// padrão Samsung; registerMediaKeys() loga os reais na TV.
const KEYMAP: Record<number, Action> = {
  37: 'left',
  38: 'up',
  39: 'right',
  40: 'down',
  13: 'ok',
  27: 'back', // Esc
  8: 'back', // Backspace
  10009: 'back', // Back do controle
  32: 'playpause', // Espaço
  10252: 'playpause',
  415: 'play',
  19: 'pause',
  413: 'stop',
  417: 'ff',
  412: 'rw',
};

export const actionFor = (e: KeyboardEvent): Action | undefined => KEYMAP[e.keyCode];

type Handler = (action: Action) => boolean | void;
interface Entry {
  handler: Handler;
  priority: number;
}

const entries: Entry[] = [];

/** Entrega a ação ao handler de maior prioridade; empate vai para o mais recente. */
export function dispatchAction(action: Action): boolean {
  const ordered = entries
    .map((entry, i) => ({ entry, i }))
    .sort((a, b) => b.entry.priority - a.entry.priority || b.i - a.i);
  for (const { entry } of ordered) {
    if (entry.handler(action)) return true;
  }
  return false;
}

/**
 * Registra um handler de teclas enquanto o componente estiver montado.
 * Devolver true consome a tecla. Prioridades: app -1, página 0, player 10.
 */
export function useKeyHandler(handler: Handler, priority = 0) {
  const latest = useRef(handler);
  latest.current = handler;
  // página guardada por baixo de outra não reage ao controle
  const active = usePageActive();
  const isActive = useRef(active);
  isActive.current = active;
  useEffect(() => {
    const entry: Entry = { handler: (a) => isActive.current && latest.current(a), priority };
    entries.push(entry);
    return () => {
      const i = entries.indexOf(entry);
      if (i >= 0) entries.splice(i, 1);
    };
  }, [priority]);
}
