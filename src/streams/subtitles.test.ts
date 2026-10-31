import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FILM_ON_PAL,
  findSubtitles,
  lastSpeech,
  rankSubtitles,
  releaseKind,
  shiftVtt,
  streamRelease,
  timingScale,
  type SubtitleCandidate,
} from './subtitles';

const sub = (id: number, release: string, downloads = 0): SubtitleCandidate => ({
  url: `https://subs5.strem.io/en/download/subencoding-stremio-utf8/src-api/file/${id}`,
  lang: 'pob',
  release,
  downloads,
});

// Legendas pob reais de Interstellar (tt0816692), com o desvio medido contra o
// BluRay/WEB das fontes HTTP (duração 2:49:04).
const HDTS = sub(1954497730, 'Interstellar.2014.720p.HDTS.HC.AAC.x264-Pimp4003 Telesync', 53006); // −22 a −27 s
const CAM = sub(1954497723, 'HDCAM.XviD-AC3-STINKBOMB-CPG-SUMO Cam', 36034); // −47 a −52 s
const DVDSCR = sub(1954590424, 'Serve para todos os "DVDSCR" Interstellar.2014.DVDScr.srt DVD Screener', 32336); // +1 a −2 s
const TC = sub(1954564868, 'Interstellar 2014 R6 TC XviD AC3-NoGroup Telecine', 19894); // +8 a −3 s
const YIFY = sub(1954662573, 'Interstellar.2014.720p.BluRay.x264.YIFY/.1080p/.DAA/.RARBG/.', 135637); // +2 a −0,3 s
const RARBG_AAC = sub(1954659859, 'Interstellar.2014.1080p.BluRay.H264.AAC-RARBG', 47434); // +2,5 a −0,7 s
const RARBG_DTS = sub(1954664349, 'Interstellar.2014.1080p.BluRay.x264.DTS-RARBG', 11311); // −25 a −30 s
const ALL = [HDTS, CAM, DVDSCR, TC, YIFY, RARBG_AAC, RARBG_DTS];

describe('releaseKind', () => {
  it('separa loja/disco, screener e cinema', () => {
    expect(releaseKind(HDTS.release)).toBe('cam');
    expect(releaseKind(CAM.release)).toBe('cam');
    expect(releaseKind(TC.release)).toBe('cam');
    expect(releaseKind(DVDSCR.release)).toBe('screener');
    expect(releaseKind(YIFY.release)).toBe('retail');
    expect(releaseKind('Interstellar.2014.1080p.AMZN.WEB-DL.DDP5.1.H.264-G4RiS.mkv')).toBe('retail');
    expect(releaseKind('Interestelar 🇧🇷 Dual Áudio FenixHub')).toBe('unknown');
  });
});

describe('rankSubtitles', () => {
  it('com o nome do arquivo, fica a legenda do mesmo release', () => {
    const ranked = rankSubtitles(ALL, 'Interstellar.2014.1080p.BluRay.H264.AAC-RARBG.mp4');
    expect(ranked[0]).toBe(RARBG_AAC);
    // a de cinema, mesmo a mais baixada, vai para o fim
    expect(ranked.indexOf(HDTS)).toBeGreaterThan(ranked.indexOf(DVDSCR));
    expect(ranked.slice(-3)).toEqual(expect.arrayContaining([HDTS, CAM, TC]));
  });

  it('sem nome do arquivo, vai a de BluRay/WEB mais baixada', () => {
    expect(rankSubtitles(ALL, 'Interestelar 🇧🇷🇺🇸 Dual Áudio 📍 FenixHub')[0]).toBe(YIFY);
    expect(rankSubtitles(ALL)[0]).toBe(YIFY);
  });

  it('só com as de cinema e screener (o que o addon v3 traz), o screener vem antes', () => {
    expect(rankSubtitles([HDTS, CAM, DVDSCR, TC])[0]).toBe(DVDSCR);
  });

  it('versão estendida pede legenda estendida', () => {
    const plain = sub(1, 'Movie.2010.1080p.BluRay.x264-AAA', 9000);
    const extended = sub(2, 'Movie.2010.EXTENDED.1080p.BluRay.x264-BBB', 10);
    expect(rankSubtitles([plain, extended], 'Movie.2010.Extended.Cut.1080p.BluRay.x265-CCC.mkv')[0]).toBe(extended);
    expect(rankSubtitles([extended, plain], 'Movie.2010.1080p.WEB-DL-CCC.mkv')[0]).toBe(plain);
  });

  it('"forced" (só as falas em outra língua) fica por último', () => {
    const forced = sub(1956413887, 'Interestelar.2014.1080p.BluRay.FORCED', 5078);
    expect(rankSubtitles([forced, HDTS, YIFY], 'Interestelar 2014 Dublado')).toEqual([YIFY, HDTS, forced]);
  });

  it('vídeo de cinema prefere legenda de cinema', () => {
    expect(rankSubtitles([YIFY, HDTS], 'Interstellar.2014.HDTS.x264-Pimp4003')[0]).toBe(HDTS);
  });
});

describe('timingScale', () => {
  const D = 10144; // 2:49:04

  it('aceita a legenda que termina antes do vídeo (créditos)', () => {
    expect(timingScale(9820, D)).toBe(1);
    expect(timingScale(D + 60, D)).toBe(1);
  });

  it('recusa a de outra coisa (documentário, CD1) e a "forced"', () => {
    expect(timingScale(2459, D)).toBeNull();
    expect(timingScale(9800, D, 12)).toBeNull();
    expect(timingScale(9800, D, 2000)).toBe(1);
  });

  it('legenda de cinema (23,976) sobre vídeo PAL (25): encolhe os tempos', () => {
    const pal = D * FILM_ON_PAL; // o mesmo filme 4% mais rápido
    expect(timingScale(10100, pal)).toBeCloseTo(FILM_ON_PAL, 5);
  });

  it('passando muito do fim, não é deste vídeo', () => {
    expect(timingScale(D * 1.2, D)).toBeNull();
  });

  it('sem duração (vídeo ainda abrindo, ao vivo), não julga', () => {
    expect(timingScale(9820, NaN)).toBe(1);
    expect(timingScale(9820, Infinity)).toBe(1);
  });
});

const VTT =
  'WEBVTT\n\n1\n00:01:12.907 --> 00:01:14.993\nMeu pai era fazendeiro.\n\n' +
  '2\n00:00:00.300 --> 00:00:01.000\nÀs 10:30:00.000 em ponto\n\n' +
  '3\n02:43:40.186 --> 02:43:42.230\nno nosso novo lar.\n\n' +
  '4\n02:48:50.000 --> 02:48:55.000\nLegendas: equipe\n\n' +
  '5\n02:49:30.000 --> 02:49:35.000\nAnuncie aqui\n';

describe('lastSpeech', () => {
  it('é a última fala, sem os créditos e a propaganda do fim', () => {
    expect(lastSpeech(VTT)).toBeCloseTo(9822.23, 2);
  });
});

describe('shiftVtt', () => {
  it('desloca só as linhas de tempo e não deixa tempo negativo', () => {
    const out = shiftVtt(VTT, -0.5);
    expect(out).toContain('00:01:12.407 --> 00:01:14.493');
    expect(out).toContain('00:00:00.000 --> 00:00:00.500');
    expect(out).toContain('Às 10:30:00.000 em ponto');
  });

  it('escala e desloca', () => {
    expect(shiftVtt('00:00:25.000 --> 00:00:50.000', 1, 0.96)).toBe('00:00:25.000 --> 00:00:49.000');
  });

  it('sem ajuste, devolve igual', () => {
    expect(shiftVtt(VTT, 0)).toBe(VTT);
  });
});

describe('streamRelease', () => {
  it('usa o filename do addon, sem as marcas coladas depois', () => {
    expect(
      streamRelease({
        url: 'https://pengu.uk/direct/external/abc',
        behaviorHints: {
          filename: 'Interstellar.2014.1080p.BluRay.H264.AAC-RARBG.mp4|^|1080pMP4BluRayx264~2.6Mbps.pad-2Peckle',
        },
      }),
    ).toBe('Interstellar.2014.1080p.BluRay.H264.AAC-RARBG.mp4');
  });

  it('ou o nome do arquivo no endereço', () => {
    expect(
      streamRelease({ url: 'https://h.example/v/Interstellar.2014.1080p.AMZN.WEB-DL.DDP5.1.H.264.DUAL-G4RiS_agiwr.mkv' }),
    ).toBe('Interstellar.2014.1080p.AMZN.WEB-DL.DDP5.1.H.264.DUAL-G4RiS_agiwr.mkv');
  });

  it('senão, o texto da fonte', () => {
    expect(streamRelease({ url: 'http://cdn.example/movie/a/b/202916.mp4', name: 'Fonte 4K', title: 'Interstellar (2014)' })).toBe(
      'Interstellar (2014) Fonte 4K',
    );
  });
});

describe('findSubtitles', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('junta o addon e a busca REST, sem repetir arquivo, e ordena pelo vídeo', async () => {
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    const fetchMock = vi.fn((url: string) => {
      let body: unknown = [];
      if (url.indexOf('opensubtitles-v3') >= 0) {
        body = { subtitles: [{ url: HDTS.url, lang: 'pob', movieReleaseName: HDTS.release }] };
      } else if (url.indexOf('sublanguageid-pob') >= 0) {
        body = [
          { IDSubtitleFile: '1954497730', SubLanguageID: 'pob', MovieReleaseName: HDTS.release, SubDownloadsCnt: '53006' },
          { IDSubtitleFile: '1954659859', SubLanguageID: 'pob', MovieReleaseName: RARBG_AAC.release, SubDownloadsCnt: '47434' },
          { IDSubtitleFile: '1', SubLanguageID: 'pob', MovieReleaseName: 'Ruim BluRay', SubBad: '1' },
          { IDSubtitleFile: '2', SubLanguageID: 'pob', MovieReleaseName: 'Em dois BluRay', SubSumCD: '2' },
        ];
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const options = await findSubtitles('movie', 'tt0816692', 'Interstellar.2014.1080p.BluRay.H264.AAC-RARBG.mp4');
    expect(options.map((o) => o.language)).toEqual(['pt']);
    expect(options[0].candidates.map((c) => c.url)).toEqual([RARBG_AAC.url, HDTS.url]);
    expect(options[0].url).toBe(RARBG_AAC.url);
    expect(fetchMock.mock.calls.map((c) => c[0])).toContain(
      'https://rest.opensubtitles.org/search/imdbid-0816692/sublanguageid-pob',
    );
  });

  it('série vai com episódio e temporada; REST fora do ar fica só o addon', async () => {
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    const fetchMock = vi.fn((url: string) =>
      url.indexOf('opensubtitles-v3') >= 0
        ? Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ subtitles: [{ url: 'https://x/file/9', lang: 'eng', movieReleaseName: 'S01E01' }] }),
          })
        : Promise.reject(new Error('fora do ar')),
    );
    vi.stubGlobal('fetch', fetchMock);

    const options = await findSubtitles('series', 'tt0903747:1:2');
    expect(options.map((o) => o.language)).toEqual(['en']);
    expect(fetchMock.mock.calls.map((c) => c[0])).toContain(
      'https://rest.opensubtitles.org/search/episode-2/imdbid-0903747/season-1/sublanguageid-eng',
    );
  });
});
