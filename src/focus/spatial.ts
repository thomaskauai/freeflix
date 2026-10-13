export type Direction = 'up' | 'down' | 'left' | 'right';

// Candidato sem sobreposição no eixo perpendicular só ganha se não houver
// nenhum alinhado; a penalidade garante isso em uma tela de 1920 px.
const MISALIGNED_PENALTY = 4000;

/**
 * Vizinho mais próximo de `current` na direção pedida, por geometria.
 * Prefere quem está alinhado (sobrepõe no eixo perpendicular) e, entre
 * esses, o mais perto; empate vai para a maior sobreposição.
 */
export function findNext(
  current: HTMLElement,
  dir: Direction,
  candidates: HTMLElement[],
): HTMLElement | null {
  const c = current.getBoundingClientRect();
  const horizontal = dir === 'left' || dir === 'right';
  const cMid = horizontal ? c.left + c.width / 2 : c.top + c.height / 2;

  let best: HTMLElement | null = null;
  let bestScore = Infinity;

  for (const el of candidates) {
    if (el === current) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;

    const rMid = horizontal ? r.left + r.width / 2 : r.top + r.height / 2;
    const ahead = dir === 'right' || dir === 'down' ? rMid > cMid + 1 : rMid < cMid - 1;
    if (!ahead) continue;

    let dist: number;
    if (dir === 'right') dist = r.left - c.right;
    else if (dir === 'left') dist = c.left - r.right;
    else if (dir === 'down') dist = r.top - c.bottom;
    else dist = c.top - r.bottom;
    dist = Math.max(0, dist);

    const overlap = horizontal
      ? Math.min(c.bottom, r.bottom) - Math.max(c.top, r.top)
      : Math.min(c.right, r.right) - Math.max(c.left, r.left);

    const score = overlap > 0 ? dist - overlap * 0.001 : dist + -overlap * 3 + MISALIGNED_PENALTY;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}
