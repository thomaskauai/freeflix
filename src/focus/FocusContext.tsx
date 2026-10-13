import { useEffect, type ReactNode } from 'react';
import { actionFor, dispatchAction, type Action } from './keys';
import { findNext, type Direction } from './spatial';

// Engine de foco: foco nativo do DOM em elementos [data-focusable], movido por
// geometria. Atributos de grupo em [data-focus-group]:
//   data-focus-enter="up down"  só se entra no grupo por essas direções
//   data-focus-lock="up down"   nessas direções o foco não sai do grupo
//   data-focus-edge="left"      recebe o foco quando não há vizinho alinhado nessa direção
// Ao entrar num grupo o foco vai para [data-focus-default], senão para o
// último elemento focado ali, senão para o vizinho geométrico.

const SELECTOR = '[data-focusable]';
const groupMemory = new WeakMap<Element, HTMLElement>();
const pageMemory: Record<string, string> = {};

const pageKey = () => window.location.hash || '#/';

/** Id do último item focado nesta página, se houver. */
export const rememberedFocus = (): string | undefined => pageMemory[pageKey()];

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

/** Os dois elementos se sobrepõem no eixo perpendicular ao movimento. */
function sameLine(a: HTMLElement, b: HTMLElement, dir: Direction) {
  const ra = a.getBoundingClientRect();
  const rb = b.getBoundingClientRect();
  return dir === 'left' || dir === 'right'
    ? Math.min(ra.bottom, rb.bottom) > Math.max(ra.top, rb.top)
    : Math.min(ra.right, rb.right) > Math.max(ra.left, rb.left);
}

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

  // Menu que não fica ao lado do conteúdo (barra no pé da tela, no layout
  // compacto): a geometria não o acha, então a borda da tela leva até ele.
  const edge = root.querySelector<HTMLElement>(`[data-focus-edge~="${dir}"]`);
  if (edge && edge !== currentGroup && (!next || !sameLine(current, next, dir))) {
    next = edge.querySelector<HTMLElement>(SELECTOR) || next;
  }
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

  // Num campo de texto as teclas são do campo (letras, apagar, espaço, setas
  // laterais). Só cima/baixo saem dele e Esc volta.
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
    const leaves = action === 'up' || action === 'down' || e.keyCode === 27 || e.keyCode === 10009;
    if (!leaves) return;
  }
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

function keepInView(el: HTMLElement, box: HTMLElement) {
  const top = el.offsetTop;
  const bottom = top + el.offsetHeight;
  if (top < box.scrollTop) box.scrollTop = top;
  else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight;
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
    // Exceção: listas [data-native-scroll] rolam de verdade. Com o controle, o
    // item focado é mantido à vista; com ponteiro ou dedo, quem rola é o gesto.
    if (node.hasAttribute('data-native-scroll')) {
      if (!pointerFocus) keepInView(el, node);
      continue;
    }
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

// Dedo na tela vale como ponteiro desde o primeiro toque, antes de qualquer mousemove emulado.
function onTouchStart() {
  document.documentElement.classList.add('is-pointer');
}

export function FocusProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('touchstart', onTouchStart);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('touchstart', onTouchStart);
    };
  }, []);
  return <>{children}</>;
}
