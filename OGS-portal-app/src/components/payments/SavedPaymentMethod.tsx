/**
 * src/components/payments/SavedPaymentMethod.tsx
 *
 * Displays a saved card or US bank account with:
 *   - Brand icon + last 4 digits
 *   - Expiry (cards only)
 *   - Autopay status badge
 *   - "Set as default" and "Remove" actions
 *
 * Usage:
 *   <SavedPaymentMethod
 *     method={pm}
 *     autopayEnabled={customer.autopayEnabled}
 *     onSetDefault={handleSetDefault}
 *     onRemove={handleRemove}
 *   />
 */

import React, { useState } from 'react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import type { PaymentMethod } from '../../types/billing'

interface SavedPaymentMethodProps {
  method: PaymentMethod
  /** Whether autopay is enabled on the customer account. */
  autopayEnabled?: boolean
  /** Called when the user clicks "Set as default". */
  onSetDefault?: (pmId: string) => Promise<void>
  /** Called when the user clicks "Remove". */
  onRemove?: (pmId: string) => Promise<void>
}

// Simple card brand → display label map
const BRAND_LABELS: Record<string, string> = {
  visa:       'Visa',
  mastercard:  'Mastercard',
  amex:        'Amex',
  discover:    'Discover',
  jcb:         'JCB',
  unionpay:    'UnionPay',
  diners:      'Diners',
}

function CardIcon() {
  return (
    <svg width="32" height="22" viewBox="0 0 32 22" fill="none" aria-hidden="true">
      <rect width="32" height="22" rx="4" fill="#F0F0F0" />
      <rect y="5" width="32" height="5" fill="#D0D0D0" />
      <rect x="4" y="14" width="8" height="3" rx="1" fill="#BDBDBD" />
    </svg>
  )
}

function BankIcon() {
  return (
    <svg width="32" height="22" viewBox="0 0 32 22" fill="none" aria-hidden="true">
      <rect width="32" height="22" rx="4" fill="#EDF4FF" />
      <path d="M16 4L26 9H6L16 4Z" fill="#378ADD" />
      <rect x="8"  y="10" width="3" height="6" fill="#378ADD" />
      <rect x="14" y="10" width="3" height="6" fill="#378ADD" />
      <rect x="20" y="10" width="3" height="6" fill="#378ADD" />
      <rect x="6"  y="17" width="20" height="2" rx="1" fill="#378ADD" />
    </svg>
  )
}

export const SavedPaymentMethod: React.FC<SavedPaymentMethodProps> = ({
  method,
  autopayEnabled,
  onSetDefault,
  onRemove,
}) => {
  const [settingDefault, setSettingDefault] = useState(false)
  const [removing, setRemoving]             = useState(false)
  const isCard = method.type === 'card'

  async function handleSetDefault() {
    if (!onSetDefault) return
    setSettingDefault(true)
    try { await onSetDefault(method.id) } finally { setSettingDefault(false) }
  }

  async function handleRemove() {
    if (!onRemove) return
    setRemoving(true)
    try { await onRemove(method.id) } finally { setRemoving(false) }
  }

  const brandLabel = isCard
    ? (BRAND_LABELS[method.brand?.toLowerCase() ?? ''] ?? method.brand ?? 'Card')
    : 'Bank account'

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '14px',
      padding: '14px 16px',
      background: 'var(--color-bg)',
      border: `1px solid ${method.isDefault ? 'var(--color-brand)' : 'var(--color-border)'}`,
      borderRadius: '8px',
      transition: 'border-color 0.15s',
    }}>
      {/* Payment method icon */}
      <div style={{ flexShrink: 0 }}>
        {isCard ? <CardIcon /> : <BankIcon />}
      </div>

      {/* Details */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          flexWrap: 'wrap',
        }}>
          <span style={{
            fontSize: 'var(--font-size-14)',
            fontWeight: 500,
            color: 'var(--color-text)',
          }}>
            {brandLabel} ···· {method.last4}
          </span>

          {method.isDefault && (
            <Badge variant="brand">Default</Badge>
          )}

          {autopayEnabled && method.isDefault && (
            <Badge variant="success">Autopay on</Badge>
          )}
        </div>

        {isCard && method.expMonth && method.expYear && (
          <span style={{
            fontSize: 'var(--font-size-12)',
            color: 'var(--color-text-3)',
            marginTop: '2px',
            display: 'block',
          }}>
            Expires {String(method.expMonth).padStart(2, '0')} / {method.expYear}
          </span>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
        {!method.isDefault && onSetDefault && (
          <Button
            variant="ghost"
            size="sm"
            loading={settingDefault}
            onClick={handleSetDefault}
          >
            Set default
          </Button>
        )}
        {onRemove && (
          <Button
            variant="danger"
            size="sm"
            loading={removing}
            onClick={handleRemove}
          >
            Remove
          </Button>
        )}
      </div>
    </div>
  )
}
