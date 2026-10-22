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

// Streamings que o catálogo acima não tem, pelo api/justwatch.ts do site (dados
// do JustWatch, no Brasil). Netflix, Disney+ e Prime Video já vêm do catálogo.
// O id é o código do streaming no JustWatch.
const STREAMING_SERVICES = [
  { id: 'mxx', name: 'HBO Max' },
  { id: 'atp', name: 'Apple TV+' },
  { id: 'pmp', name: 'Paramount+' },
  { id: 'gop', name: 'Globoplay' },
  { id: 'cru', name: 'Crunchyroll' },
];

// Reserva, se o JustWatch falhar: addon "Streaming Catalogs" (o mesmo dado, por
// um servidor de terceiro: 100 títulos por streaming, nomes em inglês).
// Configuração no endereço, em base64: "serviços::país:…". Lá a HBO Max é hbm.
const STREAMING_ADDON = 'https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club';
const STREAMING_ADDON_BR = 'aGJtLGF0cCxwbXAsZ29wLGNydTo6QlI6MTc2MDAwMDAwMDAwMDowOjA6'; // hbm,atp,pmp,gop,cru::BR
export const STREAMING_FALLBACK = {
  base: `${STREAMING_ADDON}/${STREAMING_ADDON_BR}`,
  /** código do streaming no addon */
  idOf: (service: string) => (service === 'mxx' ? 'hbm' : service),
};

/** Fileiras por streaming em Filmes e Séries, na ordem em que aparecem; o Crunchyroll só se ligado nas Configurações. */
export function streamingServices() {
  const { crunchyroll } = getSettings();
  return STREAMING_SERVICES.filter((s) => s.id !== 'cru' || crunchyroll);
}

export const AUDIO_LANGUAGES: { id: AudioLanguage; label: string }[] = [
  { id: 'original', label: 'Original' },
  { id: 'pt', label: 'Português' },
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Español' },
];

export interface Settings {
  audio: AudioLanguage;
  /** fileiras do Crunchyroll em Filmes e Séries */
  crunchyroll: boolean;
}

const KEY = 'freeflix.settings';
const DEFAULTS: Settings = { audio: 'original', crunchyroll: false };

export function getSettings(): Settings {
  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY) || '{}') as Partial<Settings>;
    const audio = AUDIO_LANGUAGES.some((a) => a.id === saved.audio) ? (saved.audio as AudioLanguage) : DEFAULTS.audio;
    return { audio, crunchyroll: saved.crunchyroll === true };
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
