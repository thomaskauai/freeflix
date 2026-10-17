import { useRef, useState, type FocusEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { focusElement, focusPageDefault, forgetPage } from '../focus/FocusContext';
import { useFocusable, useFocusMove } from '../focus/useFocusable';
import { Icon, type IconName } from './Icon';
import { useStage } from './Stage';

const ITEMS: { path: string; label: string; icon: IconName }[] = [
  { path: '/search', label: 'Buscar', icon: 'search' },
  { path: '/', label: 'Início', icon: 'home' },
  { path: '/browse/series', label: 'Séries', icon: 'series' },
  { path: '/browse/movies', label: 'Filmes', icon: 'movies' },
  { path: '/list', label: 'Minha lista', icon: 'plus' },
  { path: '/settings', label: 'Configurações', icon: 'settings' },
];

function Item({
  label,
  icon,
  active,
  isDefault,
  onSelect,
}: {
  label: string;
  icon: IconName;
  active: boolean;
  isDefault: boolean;
  onSelect: () => void;
}) {
  const focus = useFocusable({ isDefault });
  return (
    <div {...focus} className={`sidebar__item${active ? ' is-active' : ''}`} aria-label={label} onClick={onSelect}>
      <Icon name={icon} />
      <span className="sidebar__label">{label}</span>
    </div>
  );
}

/**
 * Menu lateral: coluna de ícones em repouso, abre com rótulos ao receber foco.
 * No layout compacto vira uma barra de ícones no pé da tela, sem estado aberto.
 */
export function Sidebar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const nav = useRef<HTMLElement>(null);
  const cameFrom = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const { compact } = useStage();

  const activePath = ITEMS.some((i) => i.path === pathname) ? pathname : null;

  const backToContent = () => {
    if (!focusElement(cameFrom.current)) focusPageDefault();
  };

  // Direita (ou cima, na barra do pé da tela) devolve o foco para onde ele estava no conteúdo.
  useFocusMove(nav, (dir) => {
    if (dir !== (compact ? 'up' : 'right')) return false;
    backToContent();
    return true;
  });

  const onFocus = (e: FocusEvent<HTMLElement>) => {
    const from = e.relatedTarget as HTMLElement | null;
    if (from && nav.current && !nav.current.contains(from)) cameFrom.current = from;
    setOpen(true);
  };

  const select = (path: string) => {
    if (path === pathname) {
      backToContent();
      return;
    }
    // Entrar por menu começa a seção do topo, não de onde ela foi deixada.
    forgetPage(`#${path}`);
    cameFrom.current = null;
    navigate(path);
  };

  return (
    <aside className={`sidebar${open && !compact ? ' is-open' : ''}`}>
      <div className="sidebar__shade" />
      <div className="sidebar__shade sidebar__shade--open" />
      <div className="sidebar__brand display">Freeflix</div>
      <nav
        ref={nav}
        className="sidebar__nav"
        data-focus-group=""
        data-focus-enter={compact ? 'left down' : 'left'}
        data-focus-lock={compact ? 'down' : 'up down'}
        data-focus-edge={compact ? 'left' : undefined}
        onFocus={onFocus}
        onBlur={() => setOpen(false)}
      >
        {ITEMS.map((item) => (
          <Item
            key={item.path}
            label={item.label}
            icon={item.icon}
            active={item.path === activePath}
            isDefault={item.path === (activePath ?? '/')}
            onSelect={() => select(item.path)}
          />
        ))}
      </nav>
    </aside>
  );
}
