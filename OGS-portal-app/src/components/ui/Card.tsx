import React from 'react';
import './Card.css';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  padding?: boolean;
}

export const Card: React.FC<CardProps> = ({ children, className = '', padding = true, ...divProps }) => (
  <div {...divProps} className={`ui-card${padding ? ' ui-card--padded' : ''} ${className}`.trim()}>
    {children}
  </div>
);

interface CardSectionProps {
  children: React.ReactNode;
  className?: string;
}

export const CardHeader: React.FC<CardSectionProps> = ({ children, className = '' }) => (
  <div className={`ui-card__header ${className}`.trim()}>{children}</div>
);

export const CardBody: React.FC<CardSectionProps> = ({ children, className = '' }) => (
  <div className={`ui-card__body ${className}`.trim()}>{children}</div>
);

export const CardFooter: React.FC<CardSectionProps> = ({ children, className = '' }) => (
  <div className={`ui-card__footer ${className}`.trim()}>{children}</div>
);
