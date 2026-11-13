import { memo, useEffect, useRef, useState } from 'react';
import { catalog } from '../data/provider';
import { kindLabel, type Title } from '../data/types';
import { useFocusable } from '../focus/useFocusable';
import { navigateTo, titlePath } from '../nav';
import { warmTitle } from '../streams/playback';
import { TitleArt } from './Hero';
import { loadLogo } from './logo';
import { HeroLine, KindTag } from './Meta';

interface CardProps {
  title: Title;
  variant: 'poster' | 'tall' | 'wide';
  focusId: string;
  autoFocus?: boolean;
  /** 0..1, mostra a barra de "continuar assistindo" */
  progress?: number;
  /** y de repouso em grades; fileiras ancoram pela própria Row */
  anchor?: number;
  /** nota IMDb no lugar do ano */
  showRating?: boolean;
  /** imagem no lugar do cartaz (no cartão horizontal, a do episódio ou o fotograma) */
  image?: string;
  /** linha de informação no lugar de ano e tipo */
  info?: string;
  /** escolher o card; sem isso, abre os detalhes */
  onSelect?: () => void;
  /** foco parado no card por DWELL_MS (ex.: já preparar o vídeo) */
  onDwell?: () => void;
  /** o foco saiu do card */
  onLeave?: () => void;
  /**
   * Em foco, o cartaz abre em 16:9 com o fundo da obra, a arte de título e,
   * abaixo, a linha de informação e a sinopse (Home experimental).
   */
  expand?: boolean;
}

/** foco parado por este tempo conta como interesse no card (onDwell) */
const DWELL_MS = 500;

/**
 * Imagens já mostradas nesta abertura do app: voltando a uma página, o cartão
 * aparece com a imagem na hora (o navegador já a tem), sem o fade da primeira vez.
 */
const shown: Record<string, boolean> = {};

/** foco parado por este tempo num cartão adianta a busca dos detalhes */
const PREFETCH_AFTER_MS = 400;
/** foco parado por este tempo num card sem onDwell: as fontes do título já são procuradas */
const WARM_SOURCES_MS = 1000;

// Matiz estável por título, para as cartelas sem pôster não ficarem iguais.
function hueOf(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

/** Fundo das cartelas e miniaturas de um título sem imagem. */
export function fallbackArt(id: string) {
  const hue = hueOf(id);
  return `linear-gradient(160deg, hsl(${hue}, 32%, 20%) 0%, hsl(${hue}, 40%, 7%) 100%)`;
}

/**
 * Cartaz arredondado com título e uma linha de informação embaixo. memo: a
 * fileira que renderiza de novo (foco entrando ou saindo) não refaz os cards.
 */
/**
 * Arte do card largo (520 px): o fundo do TMDB vem em w1280 ou original, e na
 * TV antiga cada imagem grande custa dezenas de ms para decodificar. w780 basta.
 */
const wideArt = (url?: string) => (url ? url.replace(/\/t\/p\/(w1280|original)\//, '/t/p/w780/') : undefined);

/** Fundo da obra no card aberto: entra por cima do cartaz assim que baixa, sem fade. */
function WideArt({ src }: { src: string }) {
  const [ready, setReady] = useState(!!shown[src]);
  return (
    <img
      className={`card__wide${ready ? ' is-loaded' : ''}`}
      src={src}
      alt=""
      decoding="async"
      onLoad={() => {
        shown[src] = true;
        setReady(true);
      }}
    />
  );
}

export const Card = memo(function Card({
  title,
  variant,
  focusId,
  autoFocus,
  progress,
  anchor,
  showRating,
  image,
  info,
  onSelect,
  onDwell,
  onLeave,
  expand,
}: CardProps) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const expanded = !!expand && focused;
  const [failed, setFailed] = useState(false);
  const focus = useFocusable({ id: focusId, autoFocus });
  const picture = expand
    ? (title.poster ?? image ?? wideArt(title.backdrop))
    : (image ?? (variant === 'wide' ? (wideArt(title.backdrop) ?? title.poster) : title.poster));
  /** a arte larga só baixa quando o card abre */
  const widePicture = expand ? (image ?? wideArt(title.backdrop)) : undefined;
  const hasImage = !!picture && !failed;
  const loaded = !!picture && (loadedSrc === picture || !!shown[picture]);

  // Foco parado no cartão: os detalhes deste título já começam a ser buscados,
  // porque o servidor do catálogo leva segundos. Passando direto, nada é pedido.
  const prefetch = useRef(0);
  const dwell = useRef(0);
  useEffect(
    () => () => {
      window.clearTimeout(prefetch.current);
      window.clearTimeout(dwell.current);
    },
    [],
  );
  const onFocus = () => {
    if (expand) setFocused(true);
    window.clearTimeout(prefetch.current);
    window.clearTimeout(dwell.current);
    if (onDwell) dwell.current = window.setTimeout(onDwell, DWELL_MS);
    else {
      // o título completo (idioma, ids) escolhe as mesmas fontes que os detalhes vão escolher
      dwell.current = window.setTimeout(() => {
        catalog.getTitle(title.type, title.id).then((full) => full && warmTitle(full), () => undefined);
      }, WARM_SOURCES_MS);
    }
    prefetch.current = window.setTimeout(() => {
      catalog.getTitle(title.type, title.id).catch(() => undefined);
      // a arte de título também: os detalhes abrem com ela pronta
      if (title.logo) loadLogo(title.logo);
    }, PREFETCH_AFTER_MS);
  };

  return (
    <div
      {...focus}
      className={`card card--${variant}${expand ? ' card--expand' : ''}${expanded ? ' is-expanded' : ''}`}
      aria-label={title.title}
      data-scroll-anchor={anchor}
      // a fileira já baixa a arte larga dos vizinhos: a seta abre o próximo pronto
      data-wide={widePicture}
      onFocus={onFocus}
      onBlur={() => {
        if (expand) setFocused(false);
        window.clearTimeout(prefetch.current);
        window.clearTimeout(dwell.current);
        if (onLeave) onLeave();
      }}
      onClick={
        onSelect ??
        (() => {
          if (title.logo) loadLogo(title.logo);
          navigateTo(titlePath(title));
        })
      }
    >
      <div className="card__art">
        {hasImage ? (
          <img
            className={`card__img${loaded ? ' is-loaded' : ''}`}
            src={picture}
            alt=""
            decoding="async"
            onLoad={() => {
              shown[picture] = true;
              setLoadedSrc(picture);
            }}
            onError={() => setFailed(true)}
          />
        ) : (
          <div className="titlecard" style={{ background: fallbackArt(title.id) }}>
            <span className="titlecard__name display">{title.title}</span>
          </div>
        )}
        {expanded && widePicture && <WideArt src={widePicture} />}
        {expanded && (
          <div className="card__overlay">
            <KindTag title={title} />
            <TitleArt title={title} className="card__logo" />
          </div>
        )}
        {progress != null && (
          <div className="card__progress">
            <i style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
      </div>
      {expanded && (
        <div className="card__details">
          <HeroLine title={title} kind={false} />
          {(info || title.synopsis) && <p className="card__synopsis">{info ?? title.synopsis}</p>}
        </div>
      )}
      <div className="card__text">
        <div className="card__title">{title.title}</div>
        <div className="card__info">
          {info ?? (
            <>
              {showRating && title.rating ? (
                <span className="card__rating">IMDb {title.rating} • </span>
              ) : title.year ? (
                `${title.year} • `
              ) : (
                ''
              )}
              {kindLabel(title)}
            </>
          )}
        </div>
      </div>
    </div>
  );
});
