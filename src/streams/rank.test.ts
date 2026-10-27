import { describe, expect, it } from 'vitest';
import type { AddonStream } from '../data/addonClient';
import { parseStream } from './parse';
import { srtToVtt } from './subtitles';
import { audioChoice, describeStream, foreignOnly, offersAudio, hasOriginalAudio, rankStreams, resolutionCap, type RankContext } from './rank';

const stream = (name: string, title: string, extra: Partial<AddonStream> = {}): AddonStream => ({
  name,
  title,
  url: `https://cdn.example/${encodeURIComponent(name + title)}.mp4`,
  ...extra,
});

const ctx = (patch: Partial<RankContext> = {}): RankContext => ({
  mbps: 50,
  audio: 'original',
  originalLanguage: 'en',
  runtime: 120,
  canPlay: () => true,
  ...patch,
});

const rank = (streams: AddonStream[], context: RankContext) =>
  rankStreams(
    streams.map((s) => parseStream(s, 'Teste')),
    context,
  );

describe('parseStream', () => {
  it('lê resolução, tamanho, codec e contêiner do texto', () => {
    const p = parseStream(
      stream('Fonte\n1080p', 'Filme.2020.1080p.WEB-DL.x265.mkv\n👤 312 💾 2.1 GB', {
        behaviorHints: { filename: 'Filme.2020.1080p.WEB-DL.x265.mkv' },
      }),
      'Teste',
    );
    expect(p.resolution).toBe(1080);
    expect(p.sizeBytes).toBe(2.1e9);
    expect(p.codec).toBe('hevc');
    expect(p.container).toBe('mkv');
    expect(p.unplayable).toBeUndefined();
  });

  it('reconhece idioma por bandeira e por palavra', () => {
    expect(parseStream(stream('720p', 'Filme Dublado'), 'T').languages).toEqual(['pt']);
    expect(parseStream(stream('720p', 'Filme 🇧🇷 🇺🇸'), 'T').languages).toEqual(['pt', 'en']);
    expect(parseStream(stream('720p', 'Filme DUAL AUDIO'), 'T').multiAudio).toBe(true);
    expect(parseStream(stream('720p', 'Filme'), 'T').languages).toEqual([]);
  });

  it('"multi-sub" fala de legendas, não de áudio', () => {
    expect(parseStream(stream('720p', 'Filme MULTI-SUB'), 'T').multiAudio).toBe(false);
    expect(parseStream(stream('720p', 'Filme Multi Subs'), 'T').multiAudio).toBe(false);
    expect(parseStream(stream('720p', 'Filme MULTI'), 'T').multiAudio).toBe(true);
    expect(parseStream(stream('720p', 'Filme Dual Áudio'), 'T').multiAudio).toBe(true);
  });

  it('não confunde HDR ou HDTV com resolução', () => {
    expect(parseStream(stream('Fonte', 'Filme HDR HDTV'), 'T').resolution).toBe(0);
  });

  it('marca torrent e fonte que exige cabeçalhos como não tocáveis', () => {
    expect(parseStream({ name: '1080p', infoHash: 'abc' }, 'T').unplayable).toBe('torrent');
    expect(parseStream({ name: '1080p', externalUrl: 'https://x' }, 'T').unplayable).toBe('external');
    expect(
      parseStream(stream('1080p', 'x', { behaviorHints: { proxyHeaders: { request: { Referer: 'x' } } } }), 'T')
        .unplayable,
    ).toBe('headers');
  });
});

describe('rankStreams', () => {
  it('descarta fonte só de torrent', () => {
    const ranked = rank([{ name: '1080p', title: '👤 9999', infoHash: 'abc' }, stream('720p', 'a')], ctx());
    expect(ranked).toHaveLength(1);
    expect(ranked[0].resolution).toBe(720);
  });

  it('no mesmo idioma, a fonte que vem antes em sources.json ganha, mesmo com resolução menor', () => {
    const from = (s: AddonStream, priority: number) => ({ ...parseStream(s, `Fonte ${priority + 1}`), priority });
    const ranked = rankStreams(
      [
        from(stream('1080p', 'Filme Dublado'), 1),
        from(stream('720p', 'Filme Dublado'), 0),
        from(stream('1080p', 'Filme'), 0),
      ],
      ctx({ audio: 'pt' }),
    );
    expect(ranked.map((s) => [s.addon, s.resolution])).toEqual([
      ['Fonte 1', 720],
      ['Fonte 2', 1080],
      ['Fonte 1', 1080],
    ]);
  });

  it('em série, a fonte escolhida no episódio anterior vem antes do idioma das configurações', () => {
    const from = (s: AddonStream, base: string) => ({ ...parseStream(s, base), base });
    const original = from(stream('1080p', 'Episodio'), 'b');
    const ranked = rankStreams(
      [from(stream('1080p', 'Episodio Dublado'), 'a'), from(stream('720p', 'Episodio'), 'a'), original],
      ctx({
        audio: 'pt',
        prefer: { base: 'b', label: describeStream(original), languages: [], multiAudio: false },
      }),
    );
    // mesma opção do mesmo addon; depois o mesmo áudio (original) em outro; o dublado por último
    expect(ranked.map((s) => [s.base, s.resolution, s.languages.join()])).toEqual([
      ['b', 1080, ''],
      ['a', 720, ''],
      ['a', 1080, 'pt'],
    ]);
  });

  it('prefere 1080p, inclusive a 4K, quando a rede aguenta', () => {
    const ranked = rank([stream('720p', 'a'), stream('2160p', 'b'), stream('1080p', 'c')], ctx({ mbps: 100 }));
    expect(ranked.map((s) => s.resolution)).toEqual([1080, 720, 2160]);
  });

  it('rede lenta derruba 1080p', () => {
    expect(resolutionCap(4)).toBe(480);
    expect(resolutionCap(8)).toBe(720);
    expect(resolutionCap(20)).toBe(1080);
    const ranked = rank([stream('1080p', 'a'), stream('720p', 'b'), stream('480p', 'c')], ctx({ mbps: 8 }));
    expect(ranked[0].resolution).toBe(720);
    expect(ranked[ranked.length - 1].resolution).toBe(1080);
  });

  it('arquivo pesado demais para a banda perde para um que cabe', () => {
    // 20 GB em 120 min ≈ 22 Mbps; a rede tem 20
    const ranked = rank([stream('1080p', 'pesado 💾 20 GB'), stream('1080p', 'leve 💾 4 GB')], ctx({ mbps: 20 }));
    expect(ranked[0].sizeBytes).toBe(4e9);
  });

  it('idioma preferido vence resolução', () => {
    const ranked = rank([stream('1080p', 'Filme'), stream('720p', 'Filme Dublado')], ctx({ audio: 'pt' }));
    expect(ranked[0].languages).toEqual(['pt']);
    expect(ranked[0].resolution).toBe(720);
  });

  it('sem preferência, o original vence a dublagem', () => {
    const ranked = rank([stream('1080p', 'Filme Dublado'), stream('1080p', 'Filme')], ctx());
    expect(ranked[0].languages).toEqual([]);
  });

  it('preferido indisponível: cai no original e depois no inglês', () => {
    const ranked = rank(
      [stream('1080p', 'Filme Latino'), stream('1080p', 'Filme English'), stream('1080p', 'Filme japanese')],
      ctx({ audio: 'pt', originalLanguage: 'ja' }),
    );
    expect(ranked.map((s) => s.languages[0])).toEqual(['ja', 'en', 'es']);
  });

  it('fontes equivalentes mantêm a ordem de chegada', () => {
    const ranked = rank([stream('1080p', 'a'), stream('1080p', 'b'), stream('1080p', 'c')], ctx());
    expect(ranked.map((s) => s.url)).toEqual(
      ['a', 'b', 'c'].map((t) => `https://cdn.example/${encodeURIComponent('1080p' + t)}.mp4`),
    );
  });

  it('codec que o aparelho não toca perde para um que toca, com a mesma resolução', () => {
    const ranked = rank(
      [stream('1080p', 'a x265 👤 900'), stream('1080p', 'b x264 👤 10')],
      ctx({ canPlay: (what) => what !== 'hevc' }),
    );
    expect(ranked[0].codec).toBe('h264');
  });
});

describe('hasOriginalAudio', () => {
  const parsed = (title: string) => parseStream(stream('1080p', title), 'T');

  it('sem marca de idioma é original', () => {
    expect(hasOriginalAudio(parsed('Filme'), 'en')).toBe(true);
  });

  it('marcada só com o idioma original da obra é original', () => {
    expect(hasOriginalAudio(parsed('Filme japanese'), 'ja')).toBe(true);
    expect(hasOriginalAudio(parsed('Filme Dublado'), 'en')).toBe(false);
  });

  it('dual e multi não contam como original', () => {
    expect(hasOriginalAudio(parsed('Filme DUAL'), 'en')).toBe(false);
  });
});

describe('describeStream', () => {
  const label = (title: string) => describeStream(parseStream(stream('1080p', title), 'Fonte'));

  it('diz os idiomas quando a fonte informa, mesmo em dual', () => {
    expect(label('Filme')).toBe('1080p, áudio original, Fonte');
    expect(label('Filme Dublado')).toBe('1080p, português, Fonte');
    expect(label('Filme 🇧🇷 Dual Áudio')).toBe('1080p, dual: português, Fonte');
    expect(label('Filme MULTI')).toBe('1080p, mais de um áudio, Fonte');
  });
});

describe('srtToVtt', () => {
  it('converte o .srt para WebVTT', () => {
    const srt =
      '\uFEFF1\r\n00:00:01,000 --> 00:00:07,190\r\nA General\r\n\r\n2\r\n00:00:51,620 --> 00:00:59,800\r\nLinha um\r\nLinha dois\r\n';
    expect(srtToVtt(srt)).toBe(
      'WEBVTT\n\n1\n00:00:01.000 --> 00:00:07.190\nA General\n\n2\n00:00:51.620 --> 00:00:59.800\nLinha um\nLinha dois\n',
    );
  });
});

describe('audioChoice', () => {
  it('nomeia como a Netflix', () => {
    expect(audioChoice({ languages: [], multiAudio: false }, 'en')).toMatchObject({ key: 'original', label: 'Inglês [original]', original: true });
    expect(audioChoice({ languages: ['en'], multiAudio: false }, 'en').key).toBe('original');
    expect(audioChoice({ languages: ['pt'], multiAudio: false }, 'en')).toMatchObject({ label: 'Português', lang: 'pt', original: false });
    expect(audioChoice({ languages: ['pt', 'en'], multiAudio: true }, 'en').label).toBe('Dual: Português e Inglês');
    expect(audioChoice({ languages: [], multiAudio: false }).label).toBe('Original');
  });
});

describe('foreignOnly', () => {
  const ctx = { audio: 'original' as const, originalLanguage: 'en' };
  const stream = (title: string) => parseStream({ name: 'X', title, url: 'http://x/v.mp4' }, 'X');
  it('dublagem russa sai; português, inglês, original e dual ficam', () => {
    expect(foreignOnly(stream('Filme.1080p 🇷🇺'), ctx)).toBe(true);
    expect(foreignOnly(stream('Filme.1080p.RUS'), ctx)).toBe(true);
    expect(foreignOnly(stream('Filme.1080p 🇧🇷'), ctx)).toBe(false);
    expect(foreignOnly(stream('Filme.1080p.English'), ctx)).toBe(false);
    expect(foreignOnly(stream('Filme.1080p'), ctx)).toBe(false);
    expect(foreignOnly(stream('Filme.1080p.Dual.Audio RUS'), ctx)).toBe(false);
    expect(foreignOnly(stream('Anime.1080p.Japanese'), { audio: 'original', originalLanguage: 'ja' })).toBe(false);
  });
});

describe('legenda gravada e FenixFlix', () => {
  const fenix = (title: string) => parseStream(stream('FenixFlix 1080p', title), 'FenixFlix');
  const other = (title: string) => parseStream(stream('Outra 1080p', title), 'Outra');

  it('marca "Legendado" como legenda gravada', () => {
    expect(fenix('Moana\n🇺🇸 Legendado').hardSubs).toBe(true);
    expect(fenix('Moana\n🇧🇷 Dublado').hardSubs).toBe(false);
  });

  it('fora do português, FenixFlix fica por último, mesmo melhor no resto', () => {
    const list = [fenix('Moana\n🇺🇸 Legendado'), other('Moana.2026.720p')];
    expect(rankStreams(list, ctx()).map((s) => s.addon)).toEqual(['Outra', 'FenixFlix']);
  });

  it('em português, FenixFlix concorre normalmente', () => {
    const list = [fenix('Moana\n🇧🇷 Dublado'), other('Moana.2026.1080p')];
    expect(rankStreams(list, ctx({ audio: 'pt' }))[0].addon).toBe('FenixFlix');
  });

  it('legenda gravada fica atrás da limpa no mesmo áudio', () => {
    const list = [other('Moana.2026.1080p Legendado'), other('Moana.2026.1080p')];
    expect(rankStreams(list, ctx())[0].hardSubs).toBe(false);
  });
});

describe('offersAudio', () => {
  const dub = { languages: ['pt'], multiAudio: false };
  const plain = { languages: [], multiAudio: false };
  const dual = { languages: [], multiAudio: true };
  it('o idioma escolhido, ou o original quando é ele; multi sem dizer quais não conta', () => {
    expect(offersAudio(dub, { audio: 'pt', originalLanguage: 'en' })).toBe(true);
    expect(offersAudio(plain, { audio: 'pt', originalLanguage: 'en' })).toBe(false);
    expect(offersAudio(dual, { audio: 'pt', originalLanguage: 'en' })).toBe(false);
    expect(offersAudio(dual, { audio: 'original', originalLanguage: 'en' })).toBe(true);
    expect(offersAudio(plain, { audio: 'en', originalLanguage: 'en' })).toBe(true);
    expect(offersAudio(dub, { audio: 'en', originalLanguage: 'en' })).toBe(false);
    expect(offersAudio(dub, { audio: 'original', originalLanguage: 'en' })).toBe(false);
    expect(offersAudio(plain, { audio: 'original', originalLanguage: 'en' })).toBe(true);
  });
});

describe('gravação de cinema e arquivos que não são vídeo', () => {
  const file = (filename: string, title = '') =>
    parseStream(stream('PenguPlay 1080p', title, { behaviorHints: { filename } }), 'PenguPlay');

  it('exclui TELESYNC, HDTS, CAM, TC e SCREENER', () => {
    expect(file('Spider-Man.Brand.New.Day.2026.1080p.TELESYNC.x264-DKS.mkv').unplayable).toBe('cam');
    expect(file('Filme.2026.HDTS.x264.mkv').unplayable).toBe('cam');
    expect(file('Filme 2026 1080p TS x264.mkv').unplayable).toBe('cam');
    expect(file('Filme.2026.HDCAM.x264.mp4').unplayable).toBe('cam');
    expect(file('Filme.2026.CAMRip.mp4').unplayable).toBe('cam');
    expect(file('Filme.2026.TC.x264.mkv').unplayable).toBe('cam');
    expect(file('Filme.2026.DVDSCR.x264.mkv').unplayable).toBe('cam');
  });

  it('depois do ano no nome do arquivo, a etiqueta vale em qualquer caixa', () => {
    expect(file('Clayface.2026.Tc.1080p.MULTi.mkv|^|1080pMKV').unplayable).toBe('cam');
    expect(file('Clayface.2026.tc.1080p.mkv').unplayable).toBe('cam');
    expect(file('Filme.2026.hdcam.mkv').unplayable).toBe('cam');
    expect(file('Filme.2026.1080p.WEB-DL.ts').unplayable).toBeUndefined();
    expect(file('Ts.Tc.Filme.2026.1080p.WEB-DL.mkv').unplayable).toBeUndefined();
  });

  it('mantém WEB-DL, DTS e segmentos .ts', () => {
    expect(file('Filme.2026.1080p.AMZN.WEB-DL.DDP5.1.H.264.mkv').unplayable).toBeUndefined();
    expect(file('Filme.2026.1080p.BluRay.DTS-HD.MA.5.1.x264.mkv').unplayable).toBeUndefined();
    expect(file('segmento.ts').unplayable).toBeUndefined();
  });

  it('nome de filme com "cam" ou "screener" não é gravação de cinema', () => {
    expect(file('', '🍿 Cam Girl (2025) / 1080p WEB-DL').unplayable).toBeUndefined();
    expect(file('', '🍿 Cam (2018) / 1080p').unplayable).toBeUndefined();
    expect(file('', 'The Screener 2020 1080p').unplayable).toBeUndefined();
    expect(file('Telecine.Pipoca.2020.1080p.mkv').unplayable).toBeUndefined();
    expect(file('Cam.Girl.2025.1080p.WEB-DL.mkv').unplayable).toBeUndefined();
    expect(file('Cam.Girl.2025.HDCAM.mkv').unplayable).toBe('cam');
  });

  it('exclui arquivo que não é vídeo', () => {
    expect(file('ShowBox_2024-06-04-19-27_11.7_131_webRelease_sign.apk|^|ORGMKV').unplayable).toBe('not-video');
  });

  it('nenhuma gravação de cinema entra no ranking', () => {
    const list = [file('Filme.2026.1080p.TELESYNC.x264.mkv'), file('Filme.2026.720p.WEB-DL.mkv')];
    const ranked = rankStreams(list, ctx());
    expect(ranked).toHaveLength(1);
    expect(ranked[0].unplayable).toBeUndefined();
  });
});

