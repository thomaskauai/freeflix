import { useEffect, useState } from 'react';
import type { Title } from '../data/types';
import { useFocusable } from '../focus/useFocusable';
import { Backdrop } from './Backdrop';
import { Button } from './Button';
import { KindTag, Meta } from './Meta';

interface HeroProps {
  /** destaques; com mais de um, aparecem os pontos para passar entre eles */
  titles: Title[];
  onPlay: (title: Title) => void;
  onInfo: (title: Title) => void;
  /** foco desceu para as fileiras: a imagem sai para não vazar no topo */
  away?: boolean;
  onFocus?: () => void;
}

/** os fundos dos outros destaques começam a baixar depois que a Home assentou */
const PRELOAD_AFTER_MS = 2500;

/** arte que não chega neste tempo dá lugar ao nome em texto */
const LOGO_WAIT_MS = 4000;

/**
 * Nome da obra: a arte de título do catálogo quando existe, senão texto.
 *
 * A arte é baixada fora da tela e só entra pronta, sem fade: na TV Tizen a
 * imagem escondida esperando o "load" às vezes nunca reaparecia. Enquanto
 * carrega, o espaço fica reservado; se falhar ou demorar, vira texto.
 */
export function TitleArt({ title, className }: { title: Title; className: string }) {
  const logo = title.logo;
  const [state, setState] = useState<{ logo: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (!logo) return;
    let alive = true;
    const img = new Image();
    const done = (ok: boolean) => {
      if (!alive) return;
      alive = false;
      window.clearTimeout(timer);
      setState({ logo, ok });
    };
    const timer = window.setTimeout(() => done(false), LOGO_WAIT_MS);
    img.onload = () => done(img.naturalWidth > 0);
    img.onerror = () => done(false);
    img.src = logo;
    if (img.complete && img.naturalWidth > 0) done(true);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [logo]);

  const current = logo && state?.logo === logo ? state : null;
  if (logo && (!current || current.ok)) {
    return (
      <div className={`${className} ${className}--logo`}>
        {current && <img src={logo} alt={title.title} />}
      </div>
    );
  }
  return (
    <h1 className={`${className} display${title.title.length > 18 ? ` ${className}--long` : ''}`}>{title.title}</h1>
  );
}

/** Um ponto por destaque: focar (ou clicar) mostra aquele. */
function Dot({
  index,
  current,
  label,
  onPick,
}: {
  index: number;
  current: boolean;
  label: string;
  onPick: () => void;
}) {
  const focus = useFocusable({ id: `hero-dot:${index}` });
  return (
    <div
      {...focus}
      className={`hero__dot${current ? ' is-current' : ''}`}
      aria-label={label}
      onFocus={onPick}
      onClick={onPick}
    />
  );
}

export function Hero({ titles, onPlay, onInfo, away, onFocus }: HeroProps) {
  const [index, setIndex] = useState(0);
  /** destaque anterior, que fica embaixo enquanto o novo fundo aparece */
  const [previous, setPrevious] = useState<number | null>(null);
  const title = titles[Math.min(index, titles.length - 1)];

  // Os fundos dos outros destaques já ficam no cache: passar entre eles não mostra preto.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      titles.forEach((t) => {
        if (t.backdrop) new Image().src = t.backdrop;
      });
    }, PRELOAD_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [titles]);

  const show = (i: number) => {
    if (i === index) return;
    setPrevious(index);
    setIndex(i);
  };

  const before = previous != null && previous !== index ? titles[previous] : null;

  return (
    <header className={`hero${away ? ' is-away' : ''}`} data-scroll-anchor="top" onFocus={onFocus}>
      {before && (
        <div key={before.id} className="hero__slide">
          <Backdrop title={before} />
        </div>
      )}
      <div key={title.id} className="hero__slide is-current">
        <Backdrop title={title} />
      </div>
      <div className="hero__body">
        <div key={title.id} className="hero__info">
          <KindTag type={title.type} />
          <TitleArt title={title} className="hero__title" />
          {title.tagline && <p className="hero__tagline">{title.tagline}</p>}
          <p className="hero__synopsis">{title.synopsis}</p>
        </div>
        <div className="hero__actions">
          <Button icon="play" id="hero-play" autoFocus onClick={() => onPlay(title)}>
            Assistir
          </Button>
          <Button id="hero-info" onClick={() => onInfo(title)}>
            Mais informações
          </Button>
          {titles.length > 1 && (
            <div className="hero__pager">
              {titles.map((t, i) => (
                <Dot
                  key={t.id}
                  index={i}
                  current={i === index}
                  label={`Destaque ${i + 1} de ${titles.length}: ${t.title}`}
                  onPick={() => show(i)}
                />
              ))}
            </div>
          )}
        </div>
        <Meta title={title} />
      </div>
    </header>
  );
}
