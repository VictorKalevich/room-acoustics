// Кнопки Acoustic Lab: основная, вторичная, текстовая, опасная; кнопка-значок обязана иметь подпись.
import type { ButtonHTMLAttributes, ComponentChildren } from 'preact';
import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost';

type NativeButton = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'icon' | 'size' | 'type' | 'disabled'>;

export interface ButtonProps extends NativeButton {
  variant?: ButtonVariant;
  small?: boolean;
  block?: boolean;
  icon?: IconName;
  /** Действие выполняется: кнопка недоступна и показывает индикатор. */
  busy?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  children?: ComponentChildren;
}

export const buttonClass = (variant: ButtonVariant = 'secondary', small = false, block = false, extra?: string) =>
  ['al-btn', `al-btn--${variant}`, small && 'al-btn--small', block && 'al-btn--block', extra].filter(Boolean).join(' ');

export function Button({ variant = 'secondary', small, block, icon, busy, disabled, type = 'button', children, class: cls, ...rest }: ButtonProps) {
  return (
    <button {...rest} type={type} class={buttonClass(variant, small, block, cls as string | undefined)} disabled={disabled || busy} aria-busy={busy || undefined}>
      {busy ? <span class="al-btn__spinner" aria-hidden="true" /> : icon && <Icon name={icon} small={small} />}
      {children}
    </button>
  );
}

export interface IconButtonProps extends NativeButton {
  icon: IconName;
  label: string;
  variant?: ButtonVariant;
  small?: boolean;
  disabled?: boolean;
  pressed?: boolean;
}

export function IconButton({ icon, label, variant = 'ghost', small, pressed, class: cls, ...rest }: IconButtonProps) {
  return (
    <button {...rest} type="button" class={buttonClass(variant, small, false, ['al-btn--icon', cls].filter(Boolean).join(' '))} aria-label={label} title={label} aria-pressed={pressed}>
      <Icon name={icon} small={small} />
    </button>
  );
}
