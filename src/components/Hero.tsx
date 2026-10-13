import type { Title } from '../data/types';
import { Backdrop } from './Backdrop';
import { Button } from './Button';
import { KindTag, Meta } from './Meta';

interface HeroProps {
  title: Title;
  onPlay: () => void;
  onInfo: () => void;
  /** foco desceu para as fileiras: a imagem sai para não vazar no topo */
  away?: boolean;
  onFocus?: () => void;
}

export function Hero({ title, onPlay, onInfo, away, onFocus }: HeroProps) {
  return (
    <header className={`hero${away ? ' is-away' : ''}`} data-scroll-anchor="top" onFocus={onFocus}>
      <Backdrop title={title} />
      <div className="hero__body">
        <KindTag type={title.type} />
        <h1 className={`hero__title display${title.title.length > 18 ? ' hero__title--long' : ''}`}>
          {title.title}
        </h1>
        <p className="hero__tagline">{title.tagline}</p>
        <p className="hero__synopsis">{title.synopsis}</p>
        <div className="hero__actions">
          <Button icon="play" id="hero-play" autoFocus onClick={onPlay}>
            Assistir
          </Button>
          <Button id="hero-info" onClick={onInfo}>
            Mais informações
          </Button>
        </div>
        <Meta title={title} />
      </div>
    </header>
  );
}
