// Preferências do espectador, guardadas no aparelho.

export type CatalogId = 'classics' | 'freeflix';
export type AudioLanguage = 'original' | 'pt' | 'en' | 'es';

export interface CatalogOption {
  id: CatalogId;
  label: string;
  note: string;
  /** endereço do addon de catálogo; sem ele, é o catálogo embutido */
  base?: string;
  /** os nomes das listas são traduzidos no app */
  localized?: boolean;
}

const ADDON_PT = 'https://catalog.nuvio.tv/%7B%22language%22%3A%22pt-BR%22%2C%22region%22%3A%22BR%22%7D';
const ADDON_EN = 'https://catalog.nuvio.tv';

/** O catálogo completo vem no idioma do aparelho: português se for o caso, senão inglês. */
function prefersPortuguese(): boolean {
  const languages = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
  return /^pt\b/i.test(languages[0] || '');
}

export const CATALOGS: CatalogOption[] = [
  {
    id: 'classics',
    label: 'Clássicos (Domínio Público)',
    note: 'Filmes que já tocam sem nenhuma fonte instalada',
  },
  {
    id: 'freeflix',
    label: 'Freeflix (Conteúdo completo)',
    note: 'Filmes e séries atuais, no idioma do aparelho; o vídeo depende das fontes instaladas',
    base: prefersPortuguese() ? ADDON_PT : ADDON_EN,
    localized: prefersPortuguese(),
  },
];

export const AUDIO_LANGUAGES: { id: AudioLanguage; label: string }[] = [
  { id: 'original', label: 'Original' },
  { id: 'pt', label: 'Português' },
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Español' },
];

export interface Settings {
  catalog: CatalogId;
  audio: AudioLanguage;
}

const KEY = 'freeflix.settings';
// Primeira abertura: o catálogo que funciona sozinho. A escolha feita em
// Configurações fica guardada no aparelho.
const DEFAULTS: Settings = { catalog: 'classics', audio: 'original' };

/** ids de versões anteriores, quando o idioma era escolhido à mão */
const LEGACY: Record<string, CatalogId> = { 'pt-BR': 'freeflix', en: 'freeflix' };

export function getSettings(): Settings {
  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY) || '{}') as Partial<Settings>;
    const wanted = LEGACY[saved.catalog as string] ?? saved.catalog;
    const catalog = CATALOGS.some((c) => c.id === wanted) ? (wanted as CatalogId) : DEFAULTS.catalog;
    const audio = AUDIO_LANGUAGES.some((a) => a.id === saved.audio) ? (saved.audio as AudioLanguage) : DEFAULTS.audio;
    return { catalog, audio };
  } catch {
    return DEFAULTS;
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* sem persistência nesta sessão */
  }
  return next;
}

export const currentCatalog = (): CatalogOption =>
  CATALOGS.filter((c) => c.id === getSettings().catalog)[0] ?? CATALOGS[0];
