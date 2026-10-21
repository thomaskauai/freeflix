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
  /** mesmo catálogo em inglês: completa episódio e sinopse que o TMDB ainda não traduziu */
  fallback: prefersPortuguese() ? ADDON_EN : undefined,
};

// Addon "Streaming Catalogs": o que está em cada streaming no país (dados do
// JustWatch). Configuração no endereço, em base64: "serviços::país:…".
// Netflix, Disney+ e Prime Video já vêm do catálogo acima, com nomes em português.
const STREAMING_ADDON = 'https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club';
const STREAMING_BR = 'aGJtLGF0cCxwbXAsZ29wLGNydTo6QlI6MTc2MDAwMDAwMDAwMDowOjA6'; // hbm,atp,pmp,gop,cru::BR
const STREAMING_US = 'aGJtLGF0cCxwbXAsY3J1OjpVUzoxNzYwMDAwMDAwMDAwOjA6MDo%3D'; // hbm,atp,pmp,cru::US

/** Fileiras por streaming em Filmes e Séries, na ordem em que aparecem. */
export const STREAMING = {
  base: `${STREAMING_ADDON}/${prefersPortuguese() ? STREAMING_BR : STREAMING_US}`,
  services: [
    { id: 'hbm', name: 'HBO Max' },
    { id: 'atp', name: 'Apple TV+' },
    { id: 'pmp', name: 'Paramount+' },
    ...(prefersPortuguese() ? [{ id: 'gop', name: 'Globoplay' }] : []),
    { id: 'cru', name: 'Crunchyroll' },
  ],
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
