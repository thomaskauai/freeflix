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
import { audioChoice, audioName, effectiveLanguages, offersAudio, type AudioChoice, type SourceProfile } from '../streams/rank';
import { getSettings } from '../settings';
import type { NoSourceReason } from '../streams/resolve';

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
  /** as fontes do áudio em uso acabaram: o torrent dele está sendo procurado (chave da abertura) */
  const [hunting, setHunting] = useState('');
  /** nem fonte nem torrent com o áudio em uso: pergunta se troca */
  const [lost, setLost] = useState<{ key: string; want: AudioChoice } | null>(null);
  const torrentTried = useRef('');
  const liveKey = useRef('');

  const key = `${type}/${id}/${season}/${episode}`;
  liveKey.current = key;
  const isEpisode = season != null && episode != null;

  // Torrent: opção do menu de fontes, só com o motor local no ar.
  const [torrentOk, setTorrentOk] = useState(false);
  const [preparingTorrent, setPreparingTorrent] = useState(false);
  const [notice, setNotice] = useState<{ text: string; at: number } | null>(null);
  const say = (text: string) => setNotice({ text, at: Date.now() });
  useEffect(() => {
    let alive = true;
    torrentAvailable().then((ok) => alive && setTorrentOk(ok));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => setPreparingTorrent(false), [key]);

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
    const show = () => setStarted(true);
    // pulo para onde o espectador parou também muda o tempo; só conta o vídeo andando
    const moved = () => {
      if (!media.paused && !media.seeking && media.currentTime > last + 0.05 && media.currentTime - last < 2) show();
      last = media.currentTime;
    };
    const paused = () => media.readyState >= 2 && !media.seeking && show();
    media.addEventListener('timeupdate', moved);
    media.addEventListener('pause', paused);
    return () => {
      media.removeEventListener('timeupdate', moved);
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

  // Áudios: um por tipo entre as fontes (dublada, original, dual), na ordem da melhor fonte de cada.
  const audioOf = plan.candidates.map((c) => audioChoice(c.profile, title.originalLanguage));
  const audios = audioOf.filter((a, i) => audioOf.map((b) => b.key).indexOf(a.key) === i);
  const audioKeys = audios.map((a) => a.key);

  // Nenhuma fonte com o áudio das Configurações: não troca sozinho, pergunta.
  // Episódio que segue a fonte do anterior já teve a escolha feita.
  const audio = getSettings().audio;
  const missingAudio =
    audioAccepted !== key &&
    !plan.more &&
    !(isEpisode && preferredSource(title.id)) &&
    !plan.candidates.some((c) => offersAudio(c.profile, { audio, originalLanguage: title.originalLanguage }));
  if (missingAudio) {
    const wantedName = audio === 'original' ? 'original' : `em ${audioName(audio)}`;
    // o original primeiro: é a troca mais natural
    const offered = audios.filter((a) => a.original).concat(audios.filter((a) => !a.original));
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
                  setAudioAccepted(key);
                  setPlan({ ...plan, index: audioOf.map((b) => b.key).indexOf(a.key) });
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

  // O áudio em uso some de todas as fontes: procura o torrent dele, senão pergunta.
  if (hunting === key) {
    return (
      <div className="page player" data-focus-main="">
        {veil}
        <Waiting title={title.title} subtitle={`Procurando o áudio ${audioOf[plan.index].label} no torrent…`} onExit={goBack} />
      </div>
    );
  }
  if (lost && lost.key === key) {
    const want = lost.want;
    const others = audios.filter((a) => a.key !== want.key);
    const offered = others.filter((a) => a.original).concat(others.filter((a) => !a.original));
    // a primeira fonte daquele áudio que ainda não falhou
    const indexFor = (a: AudioChoice) => {
      const all = audioOf.map((b, i) => (b.key === a.key ? i : -1)).filter((i) => i >= 0);
      const fresh = all.filter((i) => !hasFailed(plan.candidates[i].url));
      return (fresh.length ? fresh : all)[0];
    };
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
                  setPlan({ ...plan, index: indexFor(a) });
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
  const { startAt, duration } = resumePoint(title, season, episode);
  // Legendas são buscadas pelo id IMDb; títulos sem ele ficam sem.
  const imdbId = title.imdbId ?? (/^tt\d+$/.test(title.id) ? title.id : undefined);
  const subtitleId = imdbId ? (isEpisode ? `${imdbId}:${season}:${episode}` : imdbId) : undefined;
  const hasNext = plan.index + 1 < plan.candidates.length;
  // A lista mostra uma linha por opção distinta. Espelhos da mesma opção não
  // aparecem: são a reserva que o player usa sozinho se o primeiro falhar.
  const labels = plan.candidates.map((c) => c.label).filter((label, i, all) => all.indexOf(label) === i);
  // "Torrent" no fim da lista enquanto não foi escolhido; escolhido, vira uma fonte como as outras
  const hasTorrent = plan.candidates.some((c) => !!c.torrent);
  const options = torrentOk && !hasTorrent ? labels.concat(TORRENT_LABEL) : labels;
  // O vídeo atual segue tocando enquanto o torrent abre no motor; pronto, troca.
  const pickTorrent = () => {
    if (preparingTorrent) return say('Preparando o torrent…');
    setPreparingTorrent(true);
    say('Preparando o torrent… o vídeo atual segue até ele abrir.');
    const forKey = key;
    torrentCandidate(title, season, episode).then(
      (found) => {
        if (forKey !== key) return;
        setPreparingTorrent(false);
        if (!found) return say('Nenhum torrent abriu. Continua na fonte atual.');
        setPlan((p) =>
          p && p.status === 'play' ? { ...p, candidates: p.candidates.concat(found), index: p.candidates.length } : p,
        );
      },
      () => {
        setPreparingTorrent(false);
        say('O torrent não abriu. Continua na fonte atual.');
      },
    );
  };
  // Fonte ruim fica marcada: a próxima abertura deste título já começa pela
  // seguinte. O áudio em uso se mantém: a próxima fonte é uma com ele; acabou a
  // lista e as outras fontes ainda vão chegar, espera por elas; nenhuma com ele,
  // tenta o torrent desse áudio e, por fim, pergunta se troca de áudio.
  const sameAudio = (want: AudioChoice, s: Pick<SourceProfile, 'languages' | 'multiAudio' | 'dualAudio'>) => {
    if (audioChoice(s, title.originalLanguage).key === want.key) return true;
    if (want.original) return offersAudio(s, { audio: 'original', originalLanguage: title.originalLanguage });
    return !!want.lang && effectiveLanguages(s, title.originalLanguage).indexOf(want.lang) >= 0;
  };
  const nextWith = (want: AudioChoice, list: typeof plan.candidates, from: number) => {
    for (let i = from + 1; i < list.length; i++) if (sameAudio(want, list[i].profile)) return i;
    return -1;
  };
  const lastResort = (want: AudioChoice) => {
    const forKey = key;
    if (!torrentOk || hasTorrent || torrentTried.current === key) return setLost({ key, want });
    torrentTried.current = key;
    setHunting(key);
    const done = (found: typeof candidate | null) => {
      if (liveKey.current !== forKey) return;
      setHunting('');
      if (!found) return setLost({ key: forKey, want });
      setPlan((p) =>
        p && p.status === 'play' ? { ...p, candidates: p.candidates.concat(found), index: p.candidates.length } : p,
      );
    };
    torrentCandidate(title, season, episode, (t) => sameAudio(want, t)).then(done, () => done(null));
  };
  // No torrent, trocar o áudio busca outro torrent com ele; nunca cai numa fonte HTTP.
  const pickAudio = (i: number) => {
    const want = audios[i];
    if (!candidate.torrent) return setPlan({ ...plan, index: audioOf.map((a) => a.key).indexOf(want.key) });
    if (preparingTorrent) return say('Procurando…');
    const torrents = plan.candidates.map((c, j) => (c.torrent && j !== plan.index ? j : -1)).filter((j) => j >= 0);
    const loaded =
      torrents.find((j) => audioOf[j].key === want.key) ?? torrents.find((j) => sameAudio(want, plan.candidates[j].profile));
    if (loaded !== undefined) return setPlan({ ...plan, index: loaded });
    const name = want.lang && !want.label.startsWith('Dual') ? audioName(want.lang) : want.label;
    const current = candidate.torrent.infoHash;
    const forKey = key;
    setPreparingTorrent(true);
    say(`Procurando torrent em ${name}…`);
    const done = (found: typeof candidate | null) => {
      if (liveKey.current !== forKey) return;
      setPreparingTorrent(false);
      if (!found) return say(`Nenhum torrent em ${name}. Continua no atual.`);
      setPlan((p) =>
        p && p.status === 'play' ? { ...p, candidates: p.candidates.concat(found), index: p.candidates.length } : p,
      );
    };
    torrentCandidate(title, season, episode, (t) => t.infoHash !== current && sameAudio(want, t)).then(done, () =>
      done(null),
    );
  };
  const next = () => {
    markFailed(candidate.url);
    const want = audioOf[plan.index];
    const found = nextWith(want, plan.candidates, plan.index);
    if (found >= 0) return setPlan({ ...plan, index: found });
    if (!plan.more) return lastResort(want);
    const from = plan.index;
    plan.more.then((list) => {
      if (liveKey.current !== key) return;
      const merged = mergeCandidates(plan.candidates, list);
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
        subtitlesFor={subtitleId ? { type: title.type, videoId: subtitleId } : undefined}
        sources={options}
        sourceIndex={options.indexOf(candidate.label)}
        audios={audios}
        audioIndex={audioKeys.indexOf(audioOf[plan.index].key)}
        onPickAudio={pickAudio}
        onPickSource={(option) =>
          options[option] === TORRENT_LABEL && !hasTorrent
            ? pickTorrent()
            : setPlan({ ...plan, index: plan.candidates.map((c) => c.label).indexOf(options[option]) })
        }
        // fonte ruim: passa para a próxima sem perguntar
        onFail={next}
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
        preferredAudio={audio === 'original' ? title.originalLanguage : audio}
        onExit={goBack}
      />
    </div>
  );
}
