import { useEffect, useRef, type RefObject } from 'react';
import { focusPageDefault } from './FocusContext';
import type { Direction } from './spatial';

export interface FocusableOptions {
  /** identidade estável, usada para devolver o foco ao voltar para a página */
  id?: string;
  /** foco inicial da página */
  autoFocus?: boolean;
  /** alvo preferido ao entrar no grupo */
  isDefault?: boolean;
}

/** Props que tornam um elemento alcançável pelo controle. */
export function useFocusable(options: FocusableOptions = {}) {
  return {
    tabIndex: -1,
    role: 'button',
    'data-focusable': '',
    'data-focus-id': options.id,
    'data-autofocus': options.autoFocus ? '' : undefined,
    'data-focus-default': options.isDefault ? '' : undefined,
  };
}

/** Quando a página fica pronta, devolve o foco ao último item usado nela ou ao padrão. */
export function usePageFocus(ready: boolean, key?: string) {
  useEffect(() => {
    if (ready) focusPageDefault();
  }, [ready, key]);
}

/** Intercepta o movimento de foco a partir de `ref`; devolver true cancela o movimento padrão. */
export function useFocusMove<T extends HTMLElement>(
  ref: RefObject<T>,
  handler: (dir: Direction) => boolean | void,
) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const listener = (e: Event) => {
      if (latest.current((e as CustomEvent<{ dir: Direction }>).detail.dir)) e.preventDefault();
    };
    el.addEventListener('focusmove', listener);
    return () => el.removeEventListener('focusmove', listener);
  }, [ref]);
}
