// Códigos de idioma: o app usa ISO 639-1 ("pt", "en", "ja"). O catálogo já
// manda assim (original_language do TMDB), mas outros caminhos trazem o nome
// ("English"), o código de 3 letras ("eng", "por") ou com região ("pt-BR").

/** ISO 639-2 (bibliográfico e terminológico) → ISO 639-1 */
const ISO3: Record<string, string> = {
  por: 'pt', pob: 'pt', eng: 'en', spa: 'es', fre: 'fr', fra: 'fr', ita: 'it', ger: 'de', deu: 'de',
  jpn: 'ja', kor: 'ko', chi: 'zh', zho: 'zh', hin: 'hi', tam: 'ta', tel: 'te', ukr: 'uk', rus: 'ru',
  tur: 'tr', ara: 'ar', pol: 'pl', dut: 'nl', nld: 'nl', swe: 'sv', dan: 'da', nor: 'no', fin: 'fi',
  tha: 'th', ind: 'id', vie: 'vi', heb: 'he', gre: 'el', ell: 'el', cze: 'cs', ces: 'cs', hun: 'hu',
  rum: 'ro', ron: 'ro', per: 'fa', fas: 'fa', mal: 'ml', kan: 'kn', ben: 'bn', tgl: 'tl', fil: 'tl',
};

/** nome em inglês ou português → ISO 639-1 */
const NAMES: Record<string, string> = {
  english: 'en', ingles: 'en', portuguese: 'pt', portugues: 'pt', spanish: 'es', espanol: 'es', espanhol: 'es',
  french: 'fr', frances: 'fr', italian: 'it', italiano: 'it', german: 'de', alemao: 'de', japanese: 'ja',
  japones: 'ja', korean: 'ko', coreano: 'ko', chinese: 'zh', mandarin: 'zh', cantonese: 'zh', chines: 'zh',
  hindi: 'hi', tamil: 'ta', telugu: 'te', ukrainian: 'uk', ucraniano: 'uk', russian: 'ru', russo: 'ru',
  turkish: 'tr', turco: 'tr', arabic: 'ar', arabe: 'ar', polish: 'pl', dutch: 'nl', swedish: 'sv',
  danish: 'da', norwegian: 'no', finnish: 'fi', thai: 'th', indonesian: 'id', vietnamese: 'vi',
  hebrew: 'he', greek: 'el', czech: 'cs', hungarian: 'hu', romanian: 'ro', persian: 'fa', tagalog: 'tl',
};

/** "cn" é o cantonês no TMDB; "xx" é "sem idioma" (filme mudo, documentário sem fala). */
const ALIASES: Record<string, string> = { cn: 'zh', iw: 'he', in: 'id', nb: 'no', nn: 'no' };

/** Qualquer forma de idioma → ISO 639-1; vazio quando não dá para saber. */
export function normalizeLanguage(value?: string | null): string {
  if (!value) return '';
  // "English, French" (OMDb): o primeiro é o original
  const first = value.split(/[,/|]/)[0].trim().toLowerCase();
  const plain = first.normalize ? first.normalize('NFD').replace(/[̀-ͯ]/g, '') : first;
  if (NAMES[plain]) return NAMES[plain];
  const code = plain.split(/[-_]/)[0];
  if (ALIASES[code]) return ALIASES[code];
  if (code === 'xx' || code === 'und') return '';
  if (code.length === 2 && /^[a-z]{2}$/.test(code)) return code;
  if (code.length === 3) return ISO3[code] ?? '';
  return '';
}

/** ISO 639-1 → códigos de legenda do OpenSubtitles (o preferido primeiro) */
const SUBTITLE_CODES: Record<string, string[]> = { pt: ['pob', 'por'], zh: ['chi', 'zht', 'zhe'], el: ['ell'] };

export function subtitleCodes(language: string): string[] {
  if (SUBTITLE_CODES[language]) return SUBTITLE_CODES[language];
  // o OpenSubtitles usa o ISO 639-2 bibliográfico (fre, ger, dut), o primeiro da tabela
  for (const code in ISO3) if (ISO3[code] === language && code !== 'pob') return [code];
  return [];
}
