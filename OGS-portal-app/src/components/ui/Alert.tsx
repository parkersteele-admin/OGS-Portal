import React from 'react';
import './Alert.css';

interface AlertProps {
  variant?: 'success' | 'warning' | 'danger' | 'info';
  title?: string;
  onDismiss?: () => void;
  children: React.ReactNode;
}

export const Alert: React.FC<AlertProps> = ({ variant = 'info', title, onDismiss, children }) => (
  <div className={`ui-alert ui-alert--${variant}`} role="alert">
    <div className="ui-alert__content">
      {title && <p className="ui-alert__title">{title}</p>}
      <div className="ui-alert__body">{children}</div>
    </div>
    {onDismiss && (
      <button className="ui-alert__dismiss" onClick={onDismiss} aria-label="Dismiss">
        ✕
      </button>
    )}
  </div>
);
