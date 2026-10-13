import { currentCatalog } from '../settings';
import { createAddonProvider } from './addonProvider';
import { localProvider } from './localProvider';
import type { CatalogProvider } from './types';

const option = currentCatalog();

/**
 * Catálogo escolhido em Configurações. Trocar de catálogo recarrega o app,
 * então basta resolver uma vez na partida.
 */
export const catalog: CatalogProvider = option.base
  ? createAddonProvider(option.base, !!option.localized)
  : localProvider;
