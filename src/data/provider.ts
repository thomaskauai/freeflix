import { CATALOG } from '../settings';
import { createAddonProvider } from './addonProvider';
import { getMyList, getProgress, titleFromSnapshot } from './storage';
import type { CatalogProvider, Title, TitleType } from './types';

export const catalog: CatalogProvider = createAddonProvider(CATALOG.base, CATALOG.localized, CATALOG.fallback);

/**
 * O que já se sabe do título sem ir ao servidor: o cartão de onde ele foi
 * aberto (fileira, busca, semelhantes) ou o que ficou guardado em Minha lista
 * e Continuar assistindo.
 */
export function previewTitle(type: TitleType, id: string): Title | null {
  const known = catalog.peekTitle(type, id);
  if (known) return known;
  const saved = getProgress(id);
  if (saved && saved.title) return titleFromSnapshot(saved.title);
  const listed = getMyList().filter((t) => t.id === id)[0];
  return listed ? titleFromSnapshot(listed) : null;
}
