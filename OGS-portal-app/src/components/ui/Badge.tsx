import React from 'react';
import './Badge.css';

interface BadgeProps {
  variant?: 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  children: React.ReactNode;
}

export const Badge: React.FC<BadgeProps> = ({ variant = 'brand', children }) => (
  <span className={`ui-badge ui-badge--${variant}`}>{children}</span>
);
