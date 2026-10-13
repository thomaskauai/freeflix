import type { ReactNode } from 'react';
import { useFocusable, type FocusableOptions } from '../focus/useFocusable';
import { Icon, type IconName } from './Icon';

interface ButtonProps extends FocusableOptions {
  icon?: IconName;
  variant?: 'pill';
  selected?: boolean;
  onClick: () => void;
  children: ReactNode;
}

/** Cinza em repouso, branco em foco: o estado é o foco, não a hierarquia. */
export function Button({ icon, variant, selected, onClick, children, ...focusOptions }: ButtonProps) {
  const focus = useFocusable(focusOptions);
  const classes = ['btn', variant ? `btn--${variant}` : '', selected ? 'is-selected' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div {...focus} className={classes} onClick={onClick}>
      {icon && <Icon name={icon} />}
      {children}
    </div>
  );
}
