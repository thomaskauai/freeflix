import { useEffect, type ReactNode } from 'react';
import { actionFor, dispatchAction, type Action } from './keys';
import { findNext, type Direction } from './spatial';

// Engine de foco: foco nativo do DOM em elementos [data-focusable], movido por
// geometria. Atributos de grupo em [data-focus-group]:
//   data-focus-enter="up down"  só se entra no grupo por essas direções
//   data-focus-lock="up down"   nessas direções o foco não sai do grupo
// Ao entrar num grupo o foco vai para [data-focus-default], senão para o
// último elemento focado ali, senão para o vizinho geométrico.

const SELECTOR = '[data-focusable]';
const groupMemory = new WeakMap<Element, HTMLElement>();
const pageMemory: Record<string, string> = {};

const pageKey = () => window.location.hash || '#/';

export function forgetPage(hash: string) {
  delete pageMemory[hash];
}

function layerRoot(): HTMLElement {
  const layers = document.querySelectorAll<HTMLElement>('[data-focus-layer]');
  return layers.length ? layers[layers.length - 1] : document.body;
}

// Verdadeiro só durante um foco causado pelo ponteiro. Fileiras e páginas
// consultam para não rolar: o item sairia de baixo do cursor e o próximo
// movimento do mouse focaria outro, em cadeia.
let pointerFocus = false;
export const isPointerFocus = () => pointerFocus;

export function focusElement(el: HTMLElement | null | undefined): boolean {
  if (!el || !el.isConnected) return false;
  el.focus({ preventScroll: true });
  return document.activeElement === el;
}

/** Foca o elemento lembrado desta página, ou o [data-autofocus], ou o primeiro focável. */
export function focusPageDefault(): boolean {
  const root = layerRoot();
  const id = pageMemory[pageKey()];
  const remembered = id ? root.querySelector<HTMLElement>(`[data-focus-id="${id}"]`) : null;
  return (
    focusElement(remembered) ||
    focusElement(root.querySelector<HTMLElement>('[data-autofocus]')) ||
    focusElement(root.querySelector<HTMLElement>(`[data-focus-main] ${SELECTOR}`))
  );
}

const groupOf = (el: Element) => el.closest('[data-focus-group]');
const allows = (attr: string | null | undefined, dir: Direction) =>
  !!attr && attr.split(' ').indexOf(dir) >= 0;

function move(dir: Direction) {
  const root = layerRoot();
  const current = document.activeElement as HTMLElement | null;
  if (!current || !root.contains(current) || !current.matches(SELECTOR)) {
    focusPageDefault();
    return;
  }

  // Componentes podem assumir o movimento chamando preventDefault().
  const event = new CustomEvent('focusmove', { bubbles: true, cancelable: true, detail: { dir } });
  if (!current.dispatchEvent(event)) return;

  const currentGroup = groupOf(current);
  const locked = allows(currentGroup?.getAttribute('data-focus-lock'), dir);
  const candidates = Array.from(root.querySelectorAll<HTMLElement>(SELECTOR)).filter((el) => {
    const group = groupOf(el);
    if (group === currentGroup) return true;
    if (locked) return false;
    const enter = group?.getAttribute('data-focus-enter');
    return !enter || allows(enter, dir);
  });

  // Dentro de um grupo, o vizinho do próprio grupo vem primeiro: numa fileira,
  // esquerda volta um card e só chega ao menu a partir do primeiro. Sem isso o
  // item do menu, que é largo, ganhava do card anterior por estar "mais perto".
  const siblings = currentGroup ? candidates.filter((el) => groupOf(el) === currentGroup) : [];
  let next = findNext(current, dir, siblings) || findNext(current, dir, candidates);
  if (!next) return;

  const nextGroup = groupOf(next);
  if (nextGroup && nextGroup !== currentGroup) {
    const preferred = nextGroup.querySelector<HTMLElement>('[data-focus-default]');
    const remembered = groupMemory.get(nextGroup);
    if (preferred) next = preferred;
    else if (remembered && nextGroup.contains(remembered)) next = remembered;
  }
  focusElement(next);
}

function onKeyDown(e: KeyboardEvent) {
  const action: Action | undefined = actionFor(e);
  if (!action) return;
  document.documentElement.classList.remove('is-pointer');
  e.preventDefault();
  if (dispatchAction(action)) return;

  if (action === 'up' || action === 'down' || action === 'left' || action === 'right') {
    move(action);
  } else if (action === 'ok') {
    const current = document.activeElement as HTMLElement | null;
    if (current && current.matches(SELECTOR)) current.click();
    else focusPageDefault();
  }
}

function onFocusIn(e: FocusEvent) {
  const el = e.target as HTMLElement;
  if (!el.matches || !el.matches(SELECTOR)) return;

  const group = groupOf(el);
  if (group) groupMemory.set(group, el);
  const id = el.getAttribute('data-focus-id');
  if (id) pageMemory[pageKey()] = id;

  // WebViews sem preventScroll rolam o container recortado ao focar; a rolagem
  // aqui é toda por transform, então qualquer scroll nativo é desfeito.
  for (let node = el.parentElement; node; node = node.parentElement) {
    if (node.scrollLeft) node.scrollLeft = 0;
    if (node.scrollTop) node.scrollTop = 0;
  }
}

// Mouse: passar por cima foca, clicar seleciona (onClick dos próprios itens).
// mousemove, e não mouseover: só reage quando o ponteiro de fato se move, não
// quando o conteúdo rola por baixo dele.
function onMouseMove(e: MouseEvent) {
  document.documentElement.classList.add('is-pointer');
  const target = e.target as Element | null;
  const el = target && target.closest ? target.closest<HTMLElement>(SELECTOR) : null;
  if (!el || el === document.activeElement || !layerRoot().contains(el)) return;
  pointerFocus = true;
  focusElement(el);
  pointerFocus = false;
}

const WHEEL_EVERY_MS = 240;
const WHEEL_MIN_DELTA = 12;
let lastWheel = 0;

// Roda do mouse e trackpad viram passos de foco, pelo mesmo caminho das setas:
// vertical troca de fileira, horizontal anda dentro dela.
function onWheel(e: WheelEvent) {
  e.preventDefault();
  if (document.querySelector('.splash')) return;
  const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
  const delta = horizontal ? e.deltaX : e.deltaY;
  const now = Date.now();
  if (Math.abs(delta) < WHEEL_MIN_DELTA || now - lastWheel < WHEEL_EVERY_MS) return;
  lastWheel = now;
  const dir: Direction = horizontal ? (delta > 0 ? 'right' : 'left') : delta > 0 ? 'down' : 'up';
  if (!dispatchAction(dir)) move(dir);
}

export function FocusProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('wheel', onWheel);
    };
  }, []);
  return <>{children}</>;
}
