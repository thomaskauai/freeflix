import { createHttpProvider } from './httpProvider';
import { localProvider } from './localProvider';
import type { CatalogProvider } from './types';

const apiBase = import.meta.env.VITE_API_BASE_URL as string | undefined;

/** Trocar de fonte de catálogo = definir VITE_API_BASE_URL. */
export const catalog: CatalogProvider = apiBase ? createHttpProvider(apiBase) : localProvider;
