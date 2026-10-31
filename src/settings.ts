// Preferências do espectador, guardadas no aparelho.

/** 'original' ou o código do idioma; a escolha no player pode trazer um fora da lista de Configurações */
export type AudioLanguage = string;

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

/** Fileiras por streaming em Filmes e Séries, na ordem em que aparecem; o Crunchyroll só com "Incluir animes". */
export function streamingServices() {
  const { animes } = getSettings();
  return STREAMING_SERVICES.filter((s) => s.id !== 'cru' || animes);
}

export const AUDIO_LANGUAGES: { id: AudioLanguage; label: string }[] = [
  { id: 'original', label: 'Original' },
  { id: 'pt', label: 'Português' },
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Español' },
];

/** 'original' ou um código de idioma ("pt", "ja") */
export const isAudioLanguage = (value: unknown): value is AudioLanguage =>
  typeof value === 'string' && (value === 'original' || /^[a-z]{2,3}$/.test(value));

export interface Settings {
  audio: AudioLanguage;
  /** animes no catálogo (fileiras, destaques, semelhantes) e as fileiras do Crunchyroll */
  animes: boolean;
}

const KEY = 'freeflix.settings';
const DEFAULTS: Settings = { audio: 'original', animes: false };

export function getSettings(): Settings {
  try {
    // "crunchyroll" era o nome da opção antes de valer para todos os animes
    const saved = JSON.parse(window.localStorage.getItem(KEY) || '{}') as Partial<Settings> & { crunchyroll?: boolean };
    const audio = isAudioLanguage(saved.audio) ? saved.audio : DEFAULTS.audio;
    return { audio, animes: saved.animes != null ? saved.animes === true : saved.crunchyroll === true };
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
