export type IconName =
  | 'search'
  | 'home'
  | 'series'
  | 'movies'
  | 'plus'
  | 'check'
  | 'play'
  | 'pause'
  | 'back'
  | 'options'
  | 'restart'
  | 'erase'
  | 'prev'
  | 'next'
  | 'settings'
  | 'swap'
  | 'sync'
  | 'forward'
  | 'rewind';

const STROKED: Partial<Record<IconName, JSX.Element>> = {
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5 21 21" />
    </>
  ),
  home: <path d="M3 11.2 12 3.5l9 7.7M5.5 9.5V20h4.8v-5.8h3.4V20h4.8V9.5" />,
  series: (
    <>
      <rect x="2.5" y="4.5" width="19" height="12.5" rx="1.5" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  movies: (
    <>
      <path d="M3.5 10.5h17V20h-17zM3.5 10.5 3 7.2l16.6-3 .6 3.3-16.7 3" />
      <path d="m7.6 6.4 1.9 3M12.3 5.5l1.9 3M17 4.7l1.9 3" />
    </>
  ),
  plus: <path d="M12 4v16M4 12h16" />,
  // engrenagem (desenho do Feather Icons, licença MIT)
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
  swap: <path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5" />,
  sync: <path d="M19.5 10A8 8 0 0 0 5 7.2M4.5 3.5v4h4M4.5 14A8 8 0 0 0 19 16.8M19.5 20.5v-4h-4" />,
  prev: <path d="M15 4.5 7.5 12l7.5 7.5" />,
  next: <path d="M9 4.5 16.5 12 9 19.5" />,
  check: <path d="m4.5 12.5 5 5 10-11" />,
  back: <path d="M20.5 12h-17M10.5 5l-7 7 7 7" />,
  options: (
    <>
      <path d="M3 4.5h18v12.5H10.5L6.5 20.5V17H3z" />
      <path d="M7 9.3h4M13.5 9.3H17M7 12.7h2.5M12 12.7h5" />
    </>
  ),
  restart: (
    <>
      <path d="M3 12a9 9 0 1 0 2.64-6.36L3 8.3" />
      <path d="M3 3v5.3h5.3" />
    </>
  ),
  erase: (
    <>
      <path d="M8.5 5H21v14H8.5L2.5 12z" />
      <path d="m11.5 9.5 5 5M16.5 9.5l-5 5" />
    </>
  ),
};

const FILLED: Partial<Record<IconName, JSX.Element>> = {
  play: <path d="M6 3.5v17l15-8.5z" />,
  pause: <path d="M5.5 3.5h4.5v17H5.5zM14 3.5h4.5v17H14z" />,
  forward: <path d="M2 5v14l9.5-7zM12.5 5v14L22 12z" />,
  rewind: <path d="M22 5v14l-9.5-7zM11.5 5v14L2 12z" />,
};

export function Icon({ name }: { name: IconName }) {
  const filled = FILLED[name];
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {filled ?? STROKED[name]}
    </svg>
  );
}
