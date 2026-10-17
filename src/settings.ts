// Preferências do espectador, guardadas no aparelho.

export type AudioLanguage = 'original' | 'pt' | 'en' | 'es';

const ADDON_PT = 'https://catalog.nuvio.tv/%7B%22language%22%3A%22pt-BR%22%2C%22region%22%3A%22BR%22%7D';
const ADDON_EN = 'https://catalog.nuvio.tv';

/** O catálogo vem no idioma do aparelho: português se for o caso, senão inglês. */
function prefersPortuguese(): boolean {
  const languages = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
  return /^pt\b/i.test(languages[0] || '');
}

/** Addon de catálogo; os nomes das listas são traduzidos no app quando o idioma é português. */
export const CATALOG = {
  base: prefersPortuguese() ? ADDON_PT : ADDON_EN,
  localized: prefersPortuguese(),
};

export const AUDIO_LANGUAGES: { id: AudioLanguage; label: string }[] = [
  { id: 'original', label: 'Original' },
  { id: 'pt', label: 'Português' },
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Español' },
];

export interface Settings {
  audio: AudioLanguage;
}

const KEY = 'freeflix.settings';
const DEFAULTS: Settings = { audio: 'original' };

export function getSettings(): Settings {
  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY) || '{}') as Partial<Settings>;
    const audio = AUDIO_LANGUAGES.some((a) => a.id === saved.audio) ? (saved.audio as AudioLanguage) : DEFAULTS.audio;
    return { audio };
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
