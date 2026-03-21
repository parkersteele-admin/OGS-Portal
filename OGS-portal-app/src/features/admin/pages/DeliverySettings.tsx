/**
 * src/pages/admin/DeliverySettings.tsx
 *
 * Admin-only page to configure delivery tier fees and upcharges.
 * Saved to /settings/delivery in Firestore.
 */

import React, { useState, useEffect } from 'react'
import { getDeliverySettings, updateDeliverySettings } from '../../../services/orderService'
import type { DeliverySettings, DeliveryTier } from '../../../types/order'
import { DEFAULT_DELIVERY_SETTINGS } from '../../../types/order'
import { Button } from '../../../components/ui/Button'
import './DeliverySettings.css'

const TIER_LABELS: Record<DeliveryTier, string> = {
  standard:   'Standard',
  'next-day': 'Next Day',
  'same-day': 'Same Day',
}

const TIER_HINTS: Record<DeliveryTier, string> = {
  standard:   'Default delivery — no upcharge on products.',
  'next-day': 'Delivered the next business day.',
  'same-day': 'Delivered today — subject to availability.',
}

const TIERS: DeliveryTier[] = ['standard', 'next-day', 'same-day']

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function fmtPct(n: number) {
  return `${(n * 100).toFixed(0)}%`
}

const DeliverySettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<DeliverySettings>(DEFAULT_DELIVERY_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getDeliverySettings()
      .then(setSettings)
      .catch(() => setError('Could not load delivery settings.'))
      .finally(() => setLoading(false))
  }, [])

  const updateField = (tier: DeliveryTier, field: 'deliveryFee' | 'upchargePercent', raw: string) => {
    const num = parseFloat(raw)
    if (Number.isNaN(num)) return
    const value = field === 'upchargePercent' ? Math.min(Math.max(num / 100, 0), 1) : Math.max(num, 0)
    setSettings((prev) => ({
      ...prev,
      [tier]: { ...prev[tier], [field]: value },
    }))
    setSaved(false)
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await updateDeliverySettings(settings)
      setSaved(true)
    } catch {
      setError('Failed to save delivery settings. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="ds-loading">Loading delivery settings…</div>
  }

  return (
    <div className="ds-page">
      <header className="ds-header">
        <div>
          <h1 className="ds-header__title">Delivery Settings</h1>
          <p className="ds-header__sub">
            Configure delivery fees and product upcharges by tier.
            Changes apply immediately to all new customer orders.
          </p>
        </div>
        <Button
          variant="primary"
          size="md"
          loading={saving}
          disabled={saving}
          onClick={handleSave}
        >
          {saved ? '✓ Saved' : 'Save changes'}
        </Button>
      </header>

      {error && <div className="ds-error" role="alert">{error}</div>}

      <div className="ds-tiers">
        {TIERS.map((tier) => {
          const config = settings[tier]
          const exampleTotal = 2 * 45 * (1 + config.upchargePercent) + config.deliveryFee

          return (
            <div key={tier} className="ds-tier-card">
              <div className="ds-tier-card__head">
                <h2 className="ds-tier-card__title">{TIER_LABELS[tier]}</h2>
                <p className="ds-tier-card__hint">{TIER_HINTS[tier]}</p>
              </div>

              <div className="ds-tier-card__fields">
                <div className="ds-field">
                  <label className="ds-label" htmlFor={`fee-${tier}`}>
                    Delivery fee
                    <span className="ds-label__hint">Flat fee added to the order total</span>
                  </label>
                  <div className="ds-input-wrap ds-input-wrap--prefix">
                    <span className="ds-input__affix">$</span>
                    <input
                      id={`fee-${tier}`}
                      type="number"
                      className="ds-input"
                      min={0}
                      step={0.01}
                      value={config.deliveryFee.toFixed(2)}
                      onChange={(e) => updateField(tier, 'deliveryFee', e.target.value)}
                    />
                  </div>
                </div>

                <div className="ds-field">
                  <label className="ds-label" htmlFor={`upcharge-${tier}`}>
                    Product upcharge
                    <span className="ds-label__hint">% added to each product price for this tier</span>
                  </label>
                  <div className="ds-input-wrap ds-input-wrap--suffix">
                    <input
                      id={`upcharge-${tier}`}
                      type="number"
                      className="ds-input"
                      min={0}
                      max={100}
                      step={1}
                      value={(config.upchargePercent * 100).toFixed(0)}
                      onChange={(e) => updateField(tier, 'upchargePercent', e.target.value)}
                    />
                    <span className="ds-input__affix">%</span>
                  </div>
                </div>
              </div>

              <div className="ds-tier-card__preview">
                <span className="ds-preview__label">Example: 2 cylinders @ $45.00</span>
                <span className="ds-preview__val">
                  {fmtCurrency(exampleTotal)} total
                  {config.upchargePercent > 0 && ` · +${fmtPct(config.upchargePercent)} upcharge`}
                  {` · ${fmtCurrency(config.deliveryFee)} delivery`}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default DeliverySettingsPage
