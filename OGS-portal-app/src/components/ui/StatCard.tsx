import React from 'react'
import './StatCard.css'

interface StatCardProps {
  label: string
  value: string | number
  subLabel?: string
  accent?: boolean
  className?: string
}

export const StatCard: React.FC<StatCardProps> = ({ label, value, subLabel, accent = false, className = '' }) => {
  return (
    <article className={`ui-stat-card${accent ? ' ui-stat-card--accent' : ''} ${className}`.trim()}>
      <p className="ui-stat-card__label">{label}</p>
      <p className="ui-stat-card__value">{value}</p>
      {subLabel ? <p className="ui-stat-card__sub">{subLabel}</p> : null}
    </article>
  )
}
