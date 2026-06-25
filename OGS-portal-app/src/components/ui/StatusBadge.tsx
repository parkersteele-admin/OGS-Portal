import React from 'react'
import './StatusBadge.css'

export type StatusBadgeTone =
  | 'pending'
  | 'scheduled'
  | 'in_transit'
  | 'delivered'
  | 'invoice_sent'
  | 'paid'
  | 'cancelled'
  | 'draft'
  | 'accepted'
  | 'sent'

interface StatusBadgeProps {
  status: string
  label?: string
  className?: string
}

const STATUS_CLASS: Record<StatusBadgeTone, string> = {
  pending: 'ui-status-badge--pending',
  scheduled: 'ui-status-badge--scheduled',
  in_transit: 'ui-status-badge--in-transit',
  delivered: 'ui-status-badge--delivered',
  invoice_sent: 'ui-status-badge--invoice-sent',
  paid: 'ui-status-badge--paid',
  cancelled: 'ui-status-badge--cancelled',
  draft: 'ui-status-badge--draft',
  accepted: 'ui-status-badge--accepted',
  sent: 'ui-status-badge--sent',
}

function normalizeStatus(status: string): StatusBadgeTone {
  const value = status.toLowerCase().replace(/-/g, '_')

  if (value === 'assigned') return 'scheduled'
  if (value === 'ready_to_invoice' || value === 'invoice_sent_pending' || value === 'declined' || value === 'expired') return 'pending'

  if (value in STATUS_CLASS) return value as StatusBadgeTone
  return 'draft'
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, label, className = '' }) => {
  const tone = normalizeStatus(status)
  const classes = `ui-status-badge ${STATUS_CLASS[tone]} ${className}`.trim()

  return <span className={classes}>{label ?? status.replace(/_/g, ' ')}</span>
}
