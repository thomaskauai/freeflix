import { useEffect, useRef, useState } from 'react';
import type { Title } from '../data/types';
import { useFocusable } from '../focus/useFocusable';
import { isLegacyTizen } from '../platform/tizen';
import { Backdrop } from './Backdrop';
import { Button } from './Button';
import { measureLogoInset, useLogo } from './logo';
import { HeroLine, KindTag, Meta } from './Meta';

interface HeroProps {
  /** destaques; com mais de um, aparecem os pontos para passar entre eles */
  titles: Title[];
  onPlay: (title: Title) => void;
  onInfo: (title: Title) => void;
  /** foco desceu para as fileiras: a imagem sai para não vazar no topo */
  away?: boolean;
  onFocus?: () => void;
}

/** destaque passa sozinho a cada tanto, enquanto o foco não está nos pontos */
const ROTATE_MS = 9000;

/** os fundos dos outros destaques começam a baixar depois que a Home assentou */
const PRELOAD_AFTER_MS = 2500;

/**
 * Nome da obra: a arte de título do catálogo quando existe, senão texto.
 *
 * A arte é baixada fora da tela e só entra pronta, sem fade: na TV Tizen a
 * imagem escondida esperando o "load" às vezes nunca reaparecia. Enquanto
 * carrega, o espaço fica reservado; se falhar ou demorar, vira texto.
 */
export function TitleArt({ title, className }: { title: Title; className: string }) {
  const logo = title.logo;
  const ready = useLogo(logo);
  const box = useRef<HTMLDivElement>(null);
  // vazio à esquerda da arte: puxa a imagem para o alinhamento do texto ao lado
  const [shift, setShift] = useState(0);
  useEffect(() => {
    if (!logo || !ready) return;
    let alive = true;
    measureLogoInset(logo).then((f) => {
      const el = box.current;
      const img = el && el.querySelector('img');
      if (!alive || !el || !img || !img.naturalWidth) return;
      const scale = Math.min(el.clientWidth / img.naturalWidth, el.clientHeight / img.naturalHeight);
      setShift(Math.round(f * img.naturalWidth * scale));
    });
    return () => {
      alive = false;
    };
  }, [logo, ready]);
  if (logo && ready !== false) {
    return (
      <div ref={box} className={`${className} ${className}--logo`}>
        {ready && (
          <img
            src={logo}
            alt={title.title}
            style={shift ? { marginLeft: -shift + 'px' } : undefined}
          />
        )}
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
  // destaques sorteados de novo: recomeça do primeiro
  const [shown, setShown] = useState(titles);
  if (shown !== titles) {
    setShown(titles);
    setIndex(0);
    setPrevious(null);
  }
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

  // passa sozinho; some na TV antiga (cada troca redesenha o painel inteiro) e
  // pausa quando o foco desceu para as fileiras
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (away || paused || titles.length < 2 || isLegacyTizen()) return;
    const timer = window.setTimeout(() => {
      setPrevious(index);
      setIndex((index + 1) % titles.length);
    }, ROTATE_MS);
    return () => window.clearTimeout(timer);
  }, [away, paused, index, titles.length]);

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
          <KindTag title={title} />
          <TitleArt title={title} className="hero__title" />
          <HeroLine title={title} />
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
            <div className="hero__pager" onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
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
          {title.rating && <div className="hero__badge">IMDb {title.rating}</div>}
        </div>
        <Meta title={title} />
      </div>
    </header>
  );
}
