/**
 * src/features/onboarding/OnboardingDefaultsEditor.tsx
 *
 * Admin › Email Templates → "Onboarding packet" section.
 * Edits the defaults pre-filled into the Send onboarding packet modal
 * (saved to /settings/onboardingDefaults).
 */

import React, { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import {
  getOnboardingDefaults, saveOnboardingDefaults, BUILT_IN_ONBOARDING_DEFAULTS,
  type OnboardingDefaults, type RateLine,
} from './onboardingService'
import './onboarding.css'

export const OnboardingDefaultsEditor: React.FC = () => {
  const [d, setD] = useState<OnboardingDefaults | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void getOnboardingDefaults().then((v) => { if (!cancelled) setD(v) })
    return () => { cancelled = true }
  }, [])

  if (!d) return <section className="et-section"><p className="obs-muted">Loading onboarding defaults…</p></section>

  const set = <K extends keyof OnboardingDefaults>(k: K, v: OnboardingDefaults[K]) => { setSaved(false); setD({ ...d, [k]: v }) }
  const updateRate = (i: number, k: keyof RateLine, v: string) =>
    set('rateSchedule', d.rateSchedule.map((row, idx) => (idx === i ? { ...row, [k]: v } : row)))

  const save = async () => {
    setSaving(true); setError('')
    try {
      await saveOnboardingDefaults(d)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch {
      setError('Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const resetToBuiltIn = () => {
    if (!window.confirm('Replace these fields with the original built-in defaults? Nothing is saved until you click Save.')) return
    setSaved(false)
    setD({ ...BUILT_IN_ONBOARDING_DEFAULTS, rateSchedule: BUILT_IN_ONBOARDING_DEFAULTS.rateSchedule.map((r) => ({ ...r })) })
  }

  return (
    <section className="et-section">
      <div className="et-section__header">
        <h2 className="et-section__title">Onboarding Packet</h2>
        <p className="et-section__desc">
          Defaults pre-filled when staff send a digital onboarding packet from a customer record. Staff can still
          change them per customer before sending.
        </p>
      </div>

      {error && <div className="et-error">{error}</div>}

      <div className="et-field">
        <label className="et-field__label" htmlFor="obMessage">Email message</label>
        <p className="et-field__hint">
          Use <code>{'{firstName}'}</code> for the recipient's first name and <code>{'{repName}'}</code> for the sender's name.
        </p>
        <textarea id="obMessage" className="et-field__textarea" rows={10} value={d.messageTemplate}
          onChange={(e) => set('messageTemplate', e.target.value)} />
      </div>

      <div className="et-field">
        <span className="et-field__label">Initial rate schedule</span>
        <table className="obs-rates">
          <thead><tr><th>Product or service</th><th>Initial charge</th><th>Billing basis</th><th /></tr></thead>
          <tbody>
            {d.rateSchedule.map((r, i) => (
              <tr key={i}>
                <td><input className="ui-input" value={r.label} onChange={(e) => updateRate(i, 'label', e.target.value)} /></td>
                <td><input className="ui-input" value={r.charge} onChange={(e) => updateRate(i, 'charge', e.target.value)} /></td>
                <td><input className="ui-input" value={r.basis} onChange={(e) => updateRate(i, 'basis', e.target.value)} /></td>
                <td><button type="button" className="obs-icon-btn" aria-label="Remove row"
                  onClick={() => set('rateSchedule', d.rateSchedule.filter((_, idx) => idx !== i))}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="obs-link"
          onClick={() => set('rateSchedule', [...d.rateSchedule, { label: '', charge: '', basis: '' }])}>+ Add line</button>
      </div>

      <div className="obs-grid obs-grid--3 et-field">
        <label className="obs-field"><span>Onboarding fee</span>
          <select className="ui-input" value={d.feeWaived ? 'waived' : 'charge'} onChange={(e) => set('feeWaived', e.target.value === 'waived')}>
            <option value="waived">Waived</option>
            <option value="charge">Charge fee</option>
          </select></label>
        {!d.feeWaived && (
          <label className="obs-field"><span>Fee amount ($)</span>
            <input className="ui-input" type="number" min="0" step="0.01" value={d.feeAmount}
              onChange={(e) => set('feeAmount', Number(e.target.value) || 0)} /></label>
        )}
        <label className="obs-field"><span>Service method</span>
          <select className="ui-input" value={d.serviceMethod} onChange={(e) => set('serviceMethod', e.target.value)}>
            <option>Cylinder exchange</option>
            <option>Cylinder refill</option>
            <option>Bulk delivery</option>
          </select></label>
        <label className="obs-field"><span>Payment terms</span>
          <input className="ui-input" value={d.paymentTerms} onChange={(e) => set('paymentTerms', e.target.value)} /></label>
      </div>
      <label className="obs-check et-field">
        <input type="checkbox" checked={d.askCageChoice} onChange={(e) => set('askCageChoice', e.target.checked)} />
        Ask the customer to choose purchase or rent for the 12-cylinder cage
      </label>

      <div className="obs-actions">
        <button type="button" className="obs-link obs-actions__left" onClick={resetToBuiltIn}>Reset to built-in defaults</button>
        <Button variant="primary" onClick={() => void save()} loading={saving}>
          {saved ? '✓ Saved' : 'Save Onboarding Defaults'}
        </Button>
      </div>
    </section>
  )
}
