import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Backdrop } from '../components/Backdrop';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { PlayerShell } from '../components/PlayerShell';
import { EmbedPlayer, VideoPlayer } from '../components/VideoPlayer';
import { findEpisode, followingEpisode } from '../data/episodes';
import { catalog, previewTitle } from '../data/provider';
import { clearPlayerSession, markPlayerSession, preferredSource, rememberSource, saveProgress } from '../data/storage';
import { syncProgress, syncStarted } from '../data/sync';
import type { Season, Title, TitleType } from '../data/types';
import { useFocusable, usePageFocus } from '../focus/useFocusable';
import { useGoBack, watchPath } from '../nav';
import { TORRENT_LABEL, TORRENT_START_MS, torrentAvailable, torrentCandidate } from '../streams/torrent';
import {
  firstWorking,
  hasFailed,
  markFailed,
  mergeCandidates,
  parkVideo,
  planFor,
  resumePoint,
  type Plan,
} from '../streams/playback';
import {
  audioChoice,
  audioName,
  audioOptions,
  offersAudio,
  preferenceOf,
  servesAudio,
  type AudioChoice,
  type SourceProfile,
} from '../streams/rank';
import { audioFor, forgetMovieAudio, rememberAudio } from '../streams/audioMemory';
import { undoSubtitle } from '../streams/subtitles';
import { resolvePlayback, type Candidate, type NoSourceReason } from '../streams/resolve';

const MESSAGES: Record<NoSourceReason | 'all-failed', { title: string; text: string; settings?: boolean }> = {
  'no-addons': {
    title: 'Nenhuma fonte de vídeo instalada',
    text: 'O catálogo mostra os títulos; quem traz o vídeo é uma fonte. Adicione uma em Configurações.',
    settings: true,
  },
  'not-found': {
    title: 'Nenhuma fonte tem este título',
    text: 'As fontes instaladas responderam, mas sem vídeo para ele.',
  },
  'torrent-only': {
    title: 'Só há fontes de torrent',
    text: 'As fontes instaladas só têm torrent para este título, e nenhum abriu (o motor de torrent pode estar fora do ar).',
    settings: true,
  },
  unreachable: {
    title: 'As fontes não responderam',
    text: 'Confira a conexão e tente de novo.',
  },
  'all-failed': {
    title: 'Nenhuma fonte tocou',
    text: 'As melhores fontes encontradas falharam ao carregar. Tente de novo em alguns minutos.',
  },
};

/** perto do fim do episódio, as fontes do próximo já são procuradas */
const WARM_NEXT_S = 120;

/** Enquanto a fonte é procurada: a mesma cara do player, com o título no alto e só o Voltar. */
/** pausa que dura isso com o app à vista apaga a anotação do player (ver onPlaying) */
const PAUSE_CLEARS_AFTER_MS = 1500;

function Waiting({ title, subtitle, onExit }: { title: string; subtitle?: string; onExit: () => void }) {
  const back = useFocusable({ autoFocus: true });
  return (
    <div className="shell">
      <div className="shell__top" data-focus-group="">
        <div {...back} className="shell__btn" aria-label="Voltar" onClick={onExit}>
          <Icon name="back" />
        </div>
      </div>
      <div className="shell__spinner" aria-label="Carregando" />
      <div className="shell__heading">
        <div className="shell__title display">{title}</div>
        {subtitle && <div className="shell__subtitle">{subtitle}</div>}
      </div>
    </div>
  );
}

export default function Watch() {
  const params = useParams();
  const id = params.id ?? '';
  const type: TitleType = params.type === 'series' ? 'series' : 'movie';
  const season = params.season ? Number(params.season) : undefined;
  const episode = params.episode ? Number(params.episode) : undefined;
  const navigate = useNavigate();
  const goBack = useGoBack();
  const [title, setTitle] = useState<Title | null>(null);
  const [seasons, setSeasons] = useState<{ id: string; list: Season[] } | null>(null);
  /** null enquanto procura a fonte */
  const [plan, setPlan] = useState<Plan | null>(null);
  /**
   * <video> em uso, com a chave de quem o criou: trocando de episódio ou de
   * fonte, o shell novo não pode pegar o anterior (que fica guardado, vivo).
   */
  const [mediaOf, setMediaOf] = useState<{ key: string; el: HTMLVideoElement } | null>(null);
  /** o vídeo já mostrou imagem: o fundo esmaecido da espera sai */
  const [started, setStarted] = useState(false);
  const warmed = useRef('');
  /** o espectador aceitou outro áudio porque o escolhido não existe (vale para esta abertura) */
  const [audioAccepted, setAudioAccepted] = useState('');
  /**
   * Troca de fonte que leva tempo (torrent abrindo, fontes que ainda vão
   * chegar): o vídeo sai da tela e fica o carregamento com este texto (chave da abertura).
   */
  const [switching, setSwitching] = useState<{ key: string; text: string } | null>(null);
  /** segundo em que a última troca de fonte começou: a fonte nova começa nele (chave da abertura) */
  const [resumeAt, setResumeAt] = useState<{ key: string; time: number } | null>(null);
  /** onde o vídeo em tela está, ao segundo */
  const position = useRef({ key: '', time: 0 });
  /** nem fonte nem torrent com o áudio em uso: pergunta se troca */
  const [lost, setLost] = useState<{ key: string; want: AudioChoice } | null>(null);
  const torrentTried = useRef('');
  /** idioma do áudio escolhido no player: a faixa do arquivo que toca primeiro (chave da abertura) */
  const [trackLang, setTrackLang] = useState<{ key: string; lang: string } | null>(null);
  const liveKey = useRef('');
  /** idioma preferido: o escolhido no player para este título, senão o de Configurações */
  const [audioPref, setAudioPref] = useState(() => audioFor({ id, type }));
  // outro título, outro áudio; o do filme é esquecido quando o player fecha
  useEffect(() => {
    setAudioPref(audioFor({ id, type }));
    return () => {
      if (type === 'movie') forgetMovieAudio(id);
    };
  }, [id, type]);
  /** busca nova já feita neste episódio e idioma ("chave/idioma") */
  const refetched = useRef('');

  const key = `${type}/${id}/${season}/${episode}`;
  liveKey.current = key;
  const isEpisode = season != null && episode != null;

  // Torrent: opção do menu de fontes, só com o motor local no ar.
  const [torrentOk, setTorrentOk] = useState(false);
  const [notice, setNotice] = useState<{ text: string; at: number } | null>(null);
  const say = (text: string) => setNotice({ text, at: Date.now() });
  useEffect(() => {
    let alive = true;
    torrentAvailable().then((ok) => alive && setTorrentOk(ok));
    return () => {
      alive = false;
    };
  }, []);

  // Vídeo tocando fica anotado: TV desligada ou app fechado com ele tocando,
  // a próxima abertura volta para o player. Pausado, parado ou fora do player,
  // não. A pausa só apaga depois de um instante e com o app à vista: ao desligar
  // a TV o próprio sistema pausa o vídeo, e essa pausa não conta.
  const path = watchPath({ type, id }, season, episode);
  const pauseTimer = useRef(0);
  const onPlaying = (playing: boolean) => {
    window.clearTimeout(pauseTimer.current);
    if (playing) markPlayerSession(path);
    else pauseTimer.current = window.setTimeout(() => !document.hidden && clearPlayerSession(), PAUSE_CLEARS_AFTER_MS);
  };
  useEffect(
    () => () => {
      window.clearTimeout(pauseTimer.current);
      clearPlayerSession();
    },
    [path],
  );

  useEffect(() => {
    let alive = true;
    setTitle(null);
    setPlan(null);
    catalog.getTitle(type, id).then(
      (t) => {
        if (!alive) return;
        if (!t) {
          navigate('/', { replace: true });
          return;
        }
        setTitle(t);
        // Se a página de detalhes já procurou (e até pré-carregou), isto volta na hora.
        planFor(t, season, episode).then((next) => alive && setPlan(firstWorking(next, t, season, episode)));
      },
      () => alive && navigate('/', { replace: true }),
    );
    return () => {
      alive = false;
    };
  }, [key, type, id, season, episode, navigate]);

  // Episódios: nome e imagem do que está tocando e qual vem depois.
  useEffect(() => {
    if (type !== 'series') return;
    let alive = true;
    catalog.getSeasons(type, id).then(
      (list) => alive && setSeasons({ id, list }),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [type, id]);

  // Com uma fonte escolhida antes, o plano sai só com o addon dela; as outras chegam depois, como reserva.
  useEffect(() => {
    if (!plan || plan.status !== 'play' || !plan.more) return;
    let alive = true;
    const more = plan.more;
    more.then((list) => {
      if (!alive) return;
      setPlan((p) =>
        p && p.status === 'play' && p.more === more
          ? { ...p, candidates: mergeCandidates(p.candidates, list), more: undefined }
          : p,
      );
    });
    return () => {
      alive = false;
    };
  }, [plan]);

  const playingIndex = plan && plan.status === 'play' ? plan.index : -1;
  const videoKey = `video:${key}:${playingIndex}`;
  const media = mediaOf && mediaOf.key === videoKey ? mediaOf.el : null;

  // O fundo da espera cobre o vídeo até ele andar de verdade. Na TV o evento
  // "playing" pode chegar antes da imagem (ou nem chegar, no vídeo
  // pré-carregado), e o primeiro quadro pintado ainda fica parado um tempo: só
  // o tempo andando com o vídeo tocando conta. Pausa do espectador antes disso,
  // com imagem pronta, também revela o quadro.
  useEffect(() => {
    setStarted(false);
    if (!media) return;
    let last = media.currentTime;
    /** o vídeo andou tocando */
    let went = false;
    const show = () => setStarted(true);
    // Onde o vídeo está, para a troca de fonte começar no mesmo segundo. O vídeo
    // novo passa pelo zero antes de pular para o ponto de partida (e o descartado
    // volta a zero): abaixo de 1 s só conta o pulo pedido depois de o vídeo
    // andar (Recomeçar do início).
    const note = () => {
      if (media.currentTime < 1 && !(went && media.seeking)) return;
      position.current = { key: liveKey.current, time: media.currentTime };
    };
    // pulo para onde o espectador parou também muda o tempo; só conta o vídeo andando
    const moved = () => {
      if (!media.paused && !media.seeking && media.currentTime > last + 0.05 && media.currentTime - last < 2) {
        went = true;
        show();
      }
      last = media.currentTime;
      note();
    };
    const paused = () => media.readyState >= 2 && !media.seeking && show();
    media.addEventListener('timeupdate', moved);
    media.addEventListener('seeking', note);
    media.addEventListener('pause', paused);
    return () => {
      media.removeEventListener('timeupdate', moved);
      media.removeEventListener('seeking', note);
      media.removeEventListener('pause', paused);
    };
  }, [media]);

  // O foco muda de dono a cada estado: Voltar enquanto procura, linha do tempo quando toca.
  usePageFocus(!!title, `${key}:${plan ? plan.status : 'searching'}:${playingIndex}:${audioAccepted === key}`);

  const list = seasons && seasons.id === id ? seasons.list : [];
  const current = isEpisode ? findEpisode(list, season, episode) : undefined;
  const following = isEpisode ? followingEpisode(list, season, episode) : null;
  const subtitle = isEpisode
    ? `Temporada ${season}, episódio ${episode}${current && current.title ? ` · ${current.title}` : ''}`
    : undefined;
  const thumb = current ? current.thumbnail : undefined;

  // Até a imagem chegar, o fundo do título aparece esmaecido atrás do
  // carregamento. Antes dos detalhes completos chegarem, vale o que a lista já
  // sabia do título: o fundo não fica preto nem por um instante.
  const known = title ?? previewTitle(type, id);
  // Fica montado depois de o vídeo andar, só some aos poucos.
  const veil = known && (!plan || plan.status === 'play') && (
    <div className={`player__veil${started ? ' is-gone' : ''}`}>
      <Backdrop title={known} shade={false} />
    </div>
  );

  if (!title || !plan) {
    return (
      <div className="page player" data-focus-main="">
        {veil}
        <Waiting
          title={title ? title.title : known ? known.title : ''}
          subtitle={subtitle}
          onExit={goBack}
        />
      </div>
    );
  }

  if (plan.status === 'none') {
    const message = MESSAGES[plan.reason];
    return (
      <div className="page player" data-focus-main="">
        <Backdrop title={title} />
        <div className="player__message">
          <p className="player__message-title">{message.title}</p>
          <p className="player__message-text">{message.text}</p>
          <div className="player__message-actions">
            <Button icon="back" id="watch-back" autoFocus onClick={goBack}>
              Voltar
            </Button>
            {message.settings && (
              <Button id="watch-settings" onClick={() => navigate('/settings')}>
                Abrir Configurações
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (plan.status === 'embed') {
    return (
      <div className="page player" data-focus-main="">
        <EmbedPlayer url={plan.url} title={title.title} />
        <PlayerShell
          title={title.title}
          subtitle={subtitle}
          mode="embed"
          media={null}
          duration={0}
          startAt={0}
          onProgress={() => undefined}
          onExit={goBack}
        />
      </div>
    );
  }

  // Áudios: o idioma que se ouve em cada fonte (o preferido, se ela tem; dual com
  // português conta como português). Opções: o preferido, o original e o português.
  const audio = audioPref;
  const originalLanguage = title.originalLanguage;
  const prefs = { audio, originalLanguage };
  const audioOf = plan.candidates.map((c) => audioChoice(c.profile, originalLanguage, audio));
  const serves = (want: AudioChoice, s: Pick<SourceProfile, 'languages' | 'multiAudio' | 'dualAudio'>) =>
    servesAudio(want, s, originalLanguage);
  /** áudios das fontes que ainda não falharam */
  const freshAudios = () =>
    audioOptions(
      plan.candidates.filter((c) => !hasFailed(c.url)).map((c) => c.profile),
      prefs,
    );
  /**
   * A fonte para ouvir `want`: a primeira com ele que não falhou (`skip` fica de
   * fora). No original, a pura antes da dual, cuja faixa inicial varia.
   */
  const indexFor = (want: AudioChoice, skip = -1) => {
    const all = plan.candidates.map((c, i) => (i !== skip && serves(want, c.profile) ? i : -1)).filter((i) => i >= 0);
    const fresh = all.filter((i) => !hasFailed(plan.candidates[i].url));
    const list = fresh.length ? fresh : all;
    const pure = want.original ? list.filter((i) => !plan.candidates[i].profile.multiAudio) : [];
    const found = (pure.length ? pure : list)[0];
    return found === undefined ? -1 : found;
  };
  /**
   * A escolha de áudio no player vale para este título (a série toda, ou o
   * filme enquanto o player está aberto): troca de fonte não muda o idioma.
   * Configurações não muda.
   */
  const chooseAudio = (a: AudioChoice) => {
    const pref = preferenceOf(a);
    if (!pref) return;
    setAudioAccepted(key);
    if (pref === audioFor(title)) return;
    rememberAudio(title, pref);
    setAudioPref(pref);
  };
  // Só a melhor fonte de cada outro áudio vem na lista: escolhido um deles, as
  // fontes são procuradas de novo com a preferência nova (uma vez por idioma).
  const refetch = () => {
    refetched.current = `${key}/${audioFor(title)}`;
    return resolvePlayback(title, season, episode).then(
      (r) => ('reason' in r ? [] : r.later || r.candidates),
      () => [] as Candidate[],
    );
  };
  const fetchMore = (want: AudioChoice) => {
    if (refetched.current === `${key}/${audioFor(title)}`) return;
    if (plan.candidates.filter((c) => serves(want, c.profile) && !hasFailed(c.url)).length >= 2) return;
    const extra = refetch();
    setPlan((p) =>
      p && p.status === 'play'
        ? {
            ...p,
            more: p.more ? Promise.all([p.more, extra]).then((both) => mergeCandidates(both[0], both[1])) : extra,
          }
        : p,
    );
  };

  // Nenhuma fonte com o áudio das Configurações: não troca sozinho, pergunta.
  // Episódio que segue a fonte do anterior (no mesmo áudio) já teve a escolha feita.
  const rememberedInAudio = () => {
    const remembered = preferredSource(title.id);
    return !!remembered && offersAudio(remembered, prefs);
  };
  const missingAudio =
    audioAccepted !== key &&
    !plan.more &&
    !(isEpisode && rememberedInAudio()) &&
    !plan.candidates.some((c) => offersAudio(c.profile, prefs));
  if (missingAudio) {
    const wantedName = audio === 'original' ? 'original' : `em ${audioName(audio)}`;
    const offered = freshAudios();
    return (
      <div className="page player" data-focus-main="">
        <Backdrop title={title} />
        <div className="player__message">
          <p className="player__message-title">Sem áudio {wantedName}</p>
          <p className="player__message-text">
            Nenhuma fonte tem este título com o áudio escolhido nas Configurações.
          </p>
          <div className="player__message-actions">
            {offered.map((a, i) => (
              <Button
                key={a.key}
                id={`watch-audio-${i}`}
                autoFocus={i === 0}
                onClick={() => {
                  // escolha explícita: vira a preferência
                  chooseAudio(a);
                  setPlan({ ...plan, index: Math.max(0, indexFor(a)) });
                  fetchMore(a);
                }}
              >
                {`Assistir: ${a.label}`}
              </Button>
            ))}
            <Button icon="back" id="watch-back" onClick={goBack}>
              Voltar
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Troca de fonte em andamento: o vídeo atual já parou; a nova começa no segundo guardado.
  if (switching && switching.key === key) {
    return (
      <div className="page player" data-focus-main="">
        {veil}
        <Waiting title={title.title} subtitle={switching.text} onExit={goBack} />
      </div>
    );
  }
  if (lost && lost.key === key) {
    const want = lost.want;
    const offered = freshAudios().filter((a) => a.key !== want.key);
    return (
      <div className="page player" data-focus-main="">
        <Backdrop title={title} />
        <div className="player__message">
          <p className="player__message-title">{`Sem fonte com áudio ${want.label}`}</p>
          <p className="player__message-text">
            {offered.length
              ? 'Nenhuma fonte com este áudio tocou. Quer assistir com outro?'
              : 'Nenhuma fonte com este áudio tocou, e não há outro áudio disponível.'}
          </p>
          <div className="player__message-actions">
            {offered.map((a, i) => (
              <Button
                key={a.key}
                id={`watch-lost-${i}`}
                autoFocus={i === 0}
                onClick={() => {
                  setLost(null);
                  chooseAudio(a);
                  setPlan({ ...plan, index: Math.max(0, indexFor(a)) });
                  fetchMore(a);
                }}
              >
                {`Assistir: ${a.label}`}
              </Button>
            ))}
            <Button icon="back" id="watch-back" autoFocus={!offered.length} onClick={goBack}>
              Voltar
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const candidate = plan.candidates[plan.index];
  // no player, o original aparece sempre (escolhido sem fonte carregada, é procurado), e o que toca também
  const audios = audioOptions(
    plan.candidates.map((c) => c.profile),
    prefs,
    { withOriginal: true, current: audioOf[plan.index] },
  );
  const audioKeys = audios.map((a) => a.key);
  const saved = resumePoint(title, season, episode);
  // Depois de uma troca de fonte, a nova começa no segundo em que a troca
  // começou, não no progresso salvo (que anda de 5 em 5 s).
  const startAt = resumeAt && resumeAt.key === key ? resumeAt.time : saved.startAt;
  const duration = saved.duration;
  // Legendas são buscadas pelo id IMDb; títulos sem ele ficam sem.
  const imdbId = title.imdbId ?? (/^tt\d+$/.test(title.id) ? title.id : undefined);
  const subtitleId = imdbId ? (isEpisode ? `${imdbId}:${season}:${episode}` : imdbId) : undefined;
  // A lista mostra uma linha por opção distinta, só as do áudio preferido (todas,
  // se nenhuma tem); a que toca aparece sempre. As de outro áudio ficam para os
  // atalhos. Espelhos da mesma opção não aparecem: são a reserva que o player
  // usa sozinho se o primeiro falhar.
  const inAudio = plan.candidates.filter((c) => offersAudio(c.profile, prefs));
  const listed = inAudio.length ? inAudio : plan.candidates;
  const labels = plan.candidates
    .filter((c) => c === candidate || listed.indexOf(c) >= 0)
    .map((c) => c.label)
    .filter((label, i, all) => all.indexOf(label) === i);
  // "Torrent" no fim da lista enquanto não foi escolhido; escolhido, vira uma fonte como as outras
  const hasTorrent = plan.candidates.some((c) => !!c.torrent);
  const options = torrentOk && !hasTorrent ? labels.concat(TORRENT_LABEL) : labels;
  // Toda troca de fonte começa aqui: o vídeo atual para na hora e o segundo em
  // que estava fica guardado. A fonte nova (ou esta mesma, se a troca não der
  // certo) começa nele.
  const stopHere = () => {
    const time = position.current.key === key ? position.current.time : startAt;
    setResumeAt({ key, time });
    if (media) media.pause();
  };
  const switchTo = (index: number) => {
    stopHere();
    setPlan((p) => (p && p.status === 'play' ? { ...p, index } : p));
  };
  /** troca que espera algo (torrent abrindo, fontes chegando): carregamento no lugar do vídeo */
  const waitFor = (text: string) => {
    stopHere();
    setSwitching({ key, text });
  };
  const addAndPlay = (found: typeof candidate) =>
    setPlan((p) =>
      p && p.status === 'play' ? { ...p, candidates: p.candidates.concat(found), index: p.candidates.length } : p,
    );
  // O torrent abre no motor com o vídeo atual parado; não abrindo, este volta no mesmo segundo.
  const pickTorrent = () => {
    waitFor('Preparando o torrent…');
    const forKey = key;
    const done = (found: typeof candidate | null) => {
      if (liveKey.current !== forKey) return;
      setSwitching(null);
      if (!found) return say('Nenhum torrent abriu. Continua na fonte atual.');
      addAndPlay(found);
    };
    torrentCandidate(title, season, episode).then(done, () => done(null));
  };
  // Fonte ruim fica marcada: a próxima abertura deste título já começa pela
  // seguinte. O áudio em uso se mantém: a próxima fonte é uma com ele (pura ou
  // dual); acabou a lista e as outras fontes ainda vão chegar (ou podem ser
  // procuradas de novo neste idioma), espera por elas; nenhuma com ele, tenta o
  // torrent desse áudio e, por fim, pergunta se troca de áudio.
  // fonte que já falhou não volta: torrent que caiu para HTTP não pode voltar a ele (laço)
  const nextWith = (want: AudioChoice, list: typeof plan.candidates, from: number) => {
    for (let i = from + 1; i < list.length; i++) {
      if (!hasFailed(list[i].url) && serves(want, list[i].profile)) return i;
    }
    for (let i = 0; i < from; i++) {
      if (!hasFailed(list[i].url) && serves(want, list[i].profile)) return i;
    }
    return -1;
  };
  const lastResort = (want: AudioChoice) => {
    const forKey = key;
    if (!torrentOk || hasTorrent || torrentTried.current === key) return setLost({ key, want });
    torrentTried.current = key;
    setSwitching({ key, text: `Procurando o áudio ${want.label} no torrent…` });
    const done = (found: typeof candidate | null) => {
      if (liveKey.current !== forKey) return;
      setSwitching(null);
      if (!found) return setLost({ key: forKey, want });
      addAndPlay(found);
    };
    torrentCandidate(title, season, episode, (t) => serves(want, t)).then(done, () => done(null));
  };
  // O original sem fonte carregada: uma das que chegam depois (dual/multi conta)
  // ou um torrent com ele; nada disso, segue na atual com o aviso.
  const pickOriginal = (want: AudioChoice) => {
    const name = audioName(want.lang || '');
    const forKey = key;
    const from = plan.index;
    // a pura (só o original) antes da dual; a que está tocando não conta
    const find = (list: typeof plan.candidates) => {
      const fresh = list
        .map((c, j) => (j !== from && !c.torrent && !hasFailed(c.url) && serves(want, c.profile) ? j : -1))
        .filter((j) => j >= 0);
      const pure = fresh.filter((j) => !list[j].profile.multiAudio)[0];
      return pure ?? fresh[0] ?? -1;
    };
    // o atalho "original com legendas" não liga a legenda sobre o áudio de agora
    const missing = () => {
      undoSubtitle();
      say(`Nenhuma fonte com áudio ${name}. Continua na atual.`);
    };
    const viaTorrent = () => {
      if (!torrentOk || hasTorrent) {
        setSwitching(null);
        return missing();
      }
      setSwitching({ key, text: `Procurando o áudio ${name} no torrent…` });
      const done = (found: typeof candidate | null) => {
        if (liveKey.current !== forKey) return;
        setSwitching(null);
        if (!found) return missing();
        addAndPlay(found);
      };
      torrentCandidate(title, season, episode, (t) => serves(want, t)).then(done, () => done(null));
    };
    const loaded = find(plan.candidates);
    if (loaded >= 0) return switchTo(loaded);
    const more = plan.more;
    if (!more) {
      if (!torrentOk || hasTorrent) return missing();
      stopHere();
      return viaTorrent();
    }
    waitFor(`Procurando o áudio ${name}…`);
    more.then((list) => {
      if (liveKey.current !== forKey) return;
      const merged = mergeCandidates(plan.candidates, list);
      const index = find(merged);
      setPlan((p) =>
        p && p.status === 'play' ? { ...p, candidates: merged, index: index >= 0 ? index : p.index, more: undefined } : p,
      );
      if (index >= 0) return setSwitching(null);
      viaTorrent();
    });
  };
  // A escolha vira a preferência. No torrent, trocar o áudio busca outro torrent
  // com ele; nunca cai numa fonte HTTP.
  const pickAudio = (i: number) => {
    const want = audios[i];
    chooseAudio(want);
    // o arquivo novo começa na faixa deste idioma (dual com o original, por exemplo)
    if (want.lang) setTrackLang({ key, lang: want.lang });
    if (!candidate.torrent) {
      // a fonte atual já tem só este áudio: nada a trocar
      if (serves(want, candidate.profile) && !candidate.profile.multiAudio) return;
      const other = indexFor(want, plan.index);
      if (other >= 0) {
        fetchMore(want);
        return switchTo(other);
      }
      // dual que já tem o áudio: a faixa do arquivo é que muda (TV)
      if (serves(want, candidate.profile)) return;
      if (want.original) return pickOriginal(want);
      return say(`Nenhuma fonte com áudio ${want.label}. Continua na atual.`);
    }
    const torrents = plan.candidates.map((c, j) => (c.torrent && j !== plan.index ? j : -1)).filter((j) => j >= 0);
    const loaded =
      torrents.find((j) => audioOf[j].key === want.key) ?? torrents.find((j) => serves(want, plan.candidates[j].profile));
    if (loaded !== undefined) return switchTo(loaded);
    const name = want.lang ? audioName(want.lang) : want.label;
    const current = candidate.torrent.infoHash;
    const forKey = key;
    waitFor(`Procurando torrent em ${name}…`);
    const done = (found: typeof candidate | null) => {
      if (liveKey.current !== forKey) return;
      setSwitching(null);
      if (!found) return say(`Nenhum torrent em ${name}. Continua no atual.`);
      addAndPlay(found);
    };
    torrentCandidate(title, season, episode, (t) => t.infoHash !== current && serves(want, t)).then(done, () =>
      done(null),
    );
  };
  // Torrent que não tocou volta para as fontes HTTP, no mesmo segundo: a
  // primeira que não falhou com o mesmo áudio, senão com o das Configurações,
  // senão qualquer uma. Daqui não sai outro torrent (torrent → HTTP → torrent
  // seria um laço); sem fonte HTTP, não há o que tocar.
  const httpAfterTorrent = (want: AudioChoice, list: typeof plan.candidates) => {
    const fresh = list.map((c, i) => (!c.torrent && !hasFailed(c.url) ? i : -1)).filter((i) => i >= 0);
    const first = (ok: (c: (typeof list)[number]) => boolean) => fresh.filter((i) => ok(list[i]))[0];
    const i = first((c) => serves(want, c.profile)) ?? first((c) => offersAudio(c.profile, prefs)) ?? fresh[0];
    return i === undefined ? -1 : i;
  };
  const leaveTorrent = (want: AudioChoice, list: typeof plan.candidates) => {
    const index = httpAfterTorrent(want, list);
    if (index < 0) return setPlan({ status: 'none', reason: 'all-failed' });
    if (!serves(want, list[index].profile)) say(`O torrent não tocou. Seguindo em ${list[index].label}.`);
    setPlan((p) => (p && p.status === 'play' ? { ...p, candidates: list, index, more: undefined } : p));
  };
  const next = () => {
    stopHere();
    markFailed(candidate.url);
    const want = audioOf[plan.index];
    const forKey = key;
    const from = plan.index;
    const { candidates } = plan;
    // fontes que ainda vão chegar: espera por elas com o carregamento na tela
    const later = (more: Promise<Candidate[]> | undefined, then: (merged: Candidate[]) => void) => {
      if (!more) return then(candidates);
      setSwitching({ key, text: 'Procurando outra fonte…' });
      more.then((list) => {
        if (liveKey.current !== forKey) return;
        setSwitching(null);
        then(mergeCandidates(candidates, list));
      });
    };
    if (candidate.torrent) return later(plan.more, (merged) => leaveTorrent(want, merged));
    const found = nextWith(want, plan.candidates, from);
    if (found >= 0) return setPlan({ ...plan, index: found });
    // acabou a lista deste áudio: as que ainda chegam ou, uma vez, uma busca nova neste idioma
    const more = plan.more || (refetched.current !== `${key}/${audio}` ? refetch() : undefined);
    if (!more) return lastResort(want);
    later(more, (merged) => {
      const index = nextWith(want, merged, from);
      setPlan((p) =>
        p && p.status === 'play' ? { ...p, candidates: merged, index: index >= 0 ? index : p.index, more: undefined } : p,
      );
      if (index < 0) lastResort(want);
    });
  };
  const upNext = following
    ? {
        label: `Temporada ${following.season}, episódio ${following.episode.number}`,
        title: following.episode.title,
        thumb: following.episode.thumbnail ?? title.backdrop,
      }
    : undefined;
  // O próximo episódio entra no lugar deste: Voltar continua levando aos detalhes.
  const playNext = following
    ? () => navigate(watchPath(title, following.season, following.episode.number), { replace: true })
    : undefined;

  return (
    <div className="page player" data-focus-main="">
      <VideoPlayer
        key={videoKey}
        url={candidate.url}
        hls={candidate.hls}
        onMedia={(el) => setMediaOf((m) => (el ? { key: videoKey, el } : m && m.key === videoKey ? null : m))}
        onRelease={(video, detach) => parkVideo(title, season, episode, candidate.url, video, detach)}
      />
      {/* por cima do vídeo e por baixo dos controles e do carregamento */}
      {veil}
      <PlayerShell
        key={`shell:${key}:${plan.index}`}
        title={title.title}
        subtitle={subtitle}
        mode="video"
        media={media}
        duration={duration}
        startAt={startAt}
        subtitlesFor={subtitleId ? { type: title.type, videoId: subtitleId, release: candidate.release } : undefined}
        sources={options}
        sourceIndex={options.indexOf(candidate.label)}
        audios={audios}
        audioIndex={audioKeys.indexOf(audioOf[plan.index].key)}
        onPickAudio={pickAudio}
        onPickSource={(option) =>
          options[option] === TORRENT_LABEL && !hasTorrent
            ? pickTorrent()
            : switchTo(plan.candidates.map((c) => c.label).indexOf(options[option]))
        }
        // fonte ruim: passa para a próxima sem perguntar
        onFail={next}
        // faixa escolhida dentro do arquivo também vira a preferência
        onChooseAudio={chooseAudio}
        // a fonte que tocou vale para os outros episódios: mesmo addon, mesmo áudio
        onStart={() => {
          // torrent não vira a fonte padrão dos próximos episódios
          if (isEpisode && !candidate.torrent) rememberSource(title.id, candidate.profile);
          syncStarted(title, season, episode);
        }}
        onProgress={(time, length, moment) => {
          saveProgress(title, { season, episode, time, duration: length }, thumb);
          syncProgress(title, season, episode, moment);
          // perto do fim, as fontes do próximo episódio já vão sendo procuradas
          if (following && length > 0 && length - time < WARM_NEXT_S && warmed.current !== key) {
            warmed.current = key;
            planFor(title, following.season, following.episode.number);
          }
        }}
        upNext={upNext}
        onNext={playNext}
        onPlaying={onPlaying}
        burnedSubtitles={candidate.hardSubs}
        notice={notice}
        startTimeout={candidate.torrent ? TORRENT_START_MS : undefined}
        torrentUrl={candidate.torrent ? candidate.url : undefined}
        originalLanguage={title.originalLanguage}
        preferredAudio={
          trackLang && trackLang.key === key ? trackLang.lang : audio === 'original' ? title.originalLanguage : audio
        }
        onExit={goBack}
      />
    </div>
  );
}
