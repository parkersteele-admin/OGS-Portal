import React from 'react';
import './Button.css';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'success' | 'danger' | 'destructive' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  children,
  ...props
}) => (
  <button
    className={`ui-btn ui-btn--${variant} ui-btn--${size} ${className}`.trim()}
    disabled={disabled || loading}
    aria-busy={loading}
    {...props}
  >
    {loading && <span className="ui-btn__spinner" aria-hidden="true" />}
    {children}
  </button>
);
