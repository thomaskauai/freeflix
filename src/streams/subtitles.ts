import { getJson } from '../data/addonClient';

// Legendas vêm do addon OpenSubtitles v3 (o oficial do Stremio), que responde
// em /subtitles/{tipo}/{id IMDb}.json com arquivos .srt por idioma.

const SUBTITLES_BASE = 'https://opensubtitles-v3.strem.io';
const KEY = 'freeflix.subtitles';

export type SubtitleLanguage = 'pt' | 'en' | 'es';

/** Idiomas oferecidos, com os códigos que o addon usa; o primeiro código é o preferido. */
export const SUBTITLE_LANGUAGES: { id: SubtitleLanguage; label: string; codes: string[] }[] = [
  { id: 'pt', label: 'Português (Brasil)', codes: ['pob', 'por'] },
  { id: 'en', label: 'English', codes: ['eng'] },
  { id: 'es', label: 'Español', codes: ['spa'] },
];

export interface SubtitleOption {
  language: SubtitleLanguage;
  label: string;
  /** endereço do .srt */
  url: string;
}

interface AddonSubtitle {
  url?: string;
  lang?: string;
}

/**
 * Uma legenda por idioma oferecido, para o título ou episódio. `videoId` é o
 * id IMDb (tt…), com :temporada:episódio em séries.
 */
export async function findSubtitles(type: string, videoId: string): Promise<SubtitleOption[]> {
  const data = await getJson<{ subtitles?: AddonSubtitle[] }>(
    `${SUBTITLES_BASE}/subtitles/${type}/${encodeURIComponent(videoId)}.json`,
  );
  const all = (data.subtitles ?? []).filter((s) => s.url && s.lang);
  const options: SubtitleOption[] = [];
  SUBTITLE_LANGUAGES.forEach((language) => {
    // a ordem dos códigos manda: pt-BR antes de pt-PT
    for (const code of language.codes) {
      const hit = all.filter((s) => s.lang === code)[0];
      if (hit) {
        options.push({ language: language.id, label: language.label, url: hit.url as string });
        return;
      }
    }
  });
  return options;
}

/** .srt → WebVTT, o único formato que <track> aceita. */
export function srtToVtt(srt: string): string {
  const body = srt
    .replace(/^﻿/, '')
    .replace(/\r/g, '')
    // 00:01:02,345 → 00:01:02.345
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return `WEBVTT\n\n${body.trim()}\n`;
}

/** Baixa a legenda e devolve um endereço local que <track> consegue ler. */
export async function loadSubtitle(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`http ${res.status}`);
  const vtt = srtToVtt(await res.text());
  return URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
}

/** Idioma de legenda usado da última vez; vale para o próximo vídeo. */
export function rememberedSubtitle(): SubtitleLanguage | null {
  try {
    const saved = window.localStorage.getItem(KEY);
    return SUBTITLE_LANGUAGES.some((l) => l.id === saved) ? (saved as SubtitleLanguage) : null;
  } catch {
    return null;
  }
}

export function rememberSubtitle(language: SubtitleLanguage | null) {
  try {
    if (language) window.localStorage.setItem(KEY, language);
    else window.localStorage.removeItem(KEY);
  } catch {
    /* sem persistência nesta sessão */
  }
}
