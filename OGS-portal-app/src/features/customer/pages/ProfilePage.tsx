/**
 * src/features/customer/pages/ProfilePage.tsx
 *
 * Customer portal — My Profile
 * Route: /portal/profile
 *
 * Lets customers edit their contact info (name, email, phone) and
 * delivery address.  Writes through updateCustomer() which re-geocodes
 * automatically when address fields change.
 */

import React, { useState, useEffect } from 'react'
import { subscribeToCustomer, updateCustomer } from '../../../services/customerService'
import { useAuth } from '../../../hooks/useAuth'
import type { Customer } from '../../../types/customer'
import './ProfilePage.css'

// ── Helpers ───────────────────────────────────────────────────────────────────

// The customers/{id} document holds BOTH the flat Customer fields and the
// richer Company/onboarding fields (billingAddress, deliveryAddress, etc.).
// Cast to this extended type so both shapes are accessible.
type CustomerDoc = Customer & {
  companyName?:         string
  billingContactName?:  string
  billingEmail?:        string
  phone?:               string
  billingAddress?:      { street?: string; city?: string; state?: string; zip?: string } | null
  deliveryAddress?:     { street?: string; city?: string; state?: string; zip?: string } | null
}

function initForm(raw: Customer) {
  const c = raw as CustomerDoc
  // For the delivery address, prefer deliveryAddress (if set), else billingAddress
  const addr = c.deliveryAddress ?? c.billingAddress
  return {
    name:    c.name    || c.billingContactName || c.companyName || '',
    email:   c.email   || c.billingEmail       || '',
    phone:   c.phone   || '',
    address: c.address || addr?.street         || '',
    city:    c.city    || addr?.city           || '',
    state:   c.state   || addr?.state          || '',
    zip:     c.zip     || addr?.zip            || '',
    notes:   (c as Customer & { notes?: string }).notes ?? '',
  }
}

type FormState = ReturnType<typeof initForm>

// ── Component ─────────────────────────────────────────────────────────────────

const ProfilePage: React.FC = () => {
  const { user } = useAuth()

  // Customers link to their record via AppUser.customerId (falls back to user.id)
  const customerId = user?.companyId ?? user?.customerId ?? user?.id ?? null

  const [customer, setCustomer] = useState<Customer | null>(null)
  const [form, setForm]         = useState<FormState | null>(null)
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [dirty, setDirty]       = useState(false)
  const [toast, setToast]       = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  // Subscribe to the customer doc in real-time
  useEffect(() => {
    if (!customerId) return
    const unsub = subscribeToCustomer(customerId, (c) => {
      setCustomer(c ?? null)
      if (c && !dirty) setForm(initForm(c))
      setLoading(false)
    })
    return unsub
  // dirty is intentionally excluded — we only seed the form once on first load
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setForm((prev) => prev ? { ...prev, [name]: value } : prev)
    setDirty(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!customer || !form) return
    setSaving(true)
    try {
      await updateCustomer(customer.id, {
        name:    form.name.trim(),
        email:   form.email.trim(),
        phone:   form.phone.trim(),
        address: form.address.trim(),
        city:    form.city.trim(),
        state:   form.state.trim(),
        zip:     form.zip.trim(),
        notes:   form.notes.trim() || undefined,
      })
      setDirty(false)
      showToast('Profile updated successfully.', 'success')
    } catch {
      showToast('Failed to save. Please try again.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    if (customer) {
      setForm(initForm(customer))
      setDirty(false)
    }
  }

  function showToast(msg: string, type: 'success' | 'error') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="pp-loading">
        <span className="pp-spinner" />
      </div>
    )
  }

  if (!customer || !form) {
    return (
      <div className="pp-empty">
        <p>Could not load your profile. Please refresh the page.</p>
      </div>
    )
  }

  return (
    <div className="pp">
      {toast && (
        <div className={`pp-toast pp-toast--${toast.type}`} role="status">
          {toast.msg}
        </div>
      )}

      <header className="pp-header">
        <h1 className="pp-header__title">My Profile</h1>
        <p className="pp-header__sub">Update your contact and delivery information.</p>
      </header>

      <form className="pp-form" onSubmit={handleSubmit} noValidate>

        {/* ── Contact info ────────────────────────────────────────────── */}
        <section className="pp-section">
          <h2 className="pp-section__title">Contact Information</h2>

          <div className="pp-row">
            <label className="pp-field">
              <span className="pp-field__label">Full Name</span>
              <input
                className="pp-field__input"
                type="text"
                name="name"
                value={form.name}
                onChange={handleChange}
                required
                autoComplete="name"
              />
            </label>
          </div>

          <div className="pp-row pp-row--2">
            <label className="pp-field">
              <span className="pp-field__label">Email Address</span>
              <input
                className="pp-field__input"
                type="email"
                name="email"
                value={form.email}
                onChange={handleChange}
                required
                autoComplete="email"
              />
            </label>
            <label className="pp-field">
              <span className="pp-field__label">Phone Number</span>
              <input
                className="pp-field__input"
                type="tel"
                name="phone"
                value={form.phone}
                onChange={handleChange}
                autoComplete="tel"
              />
            </label>
          </div>
        </section>

        {/* ── Delivery address ─────────────────────────────────────────── */}
        <section className="pp-section">
          <h2 className="pp-section__title">Delivery Address</h2>

          <div className="pp-row">
            <label className="pp-field">
              <span className="pp-field__label">Street Address</span>
              <input
                className="pp-field__input"
                type="text"
                name="address"
                value={form.address}
                onChange={handleChange}
                autoComplete="street-address"
              />
            </label>
          </div>

          <div className="pp-row pp-row--3">
            <label className="pp-field pp-field--grow">
              <span className="pp-field__label">City</span>
              <input
                className="pp-field__input"
                type="text"
                name="city"
                value={form.city}
                onChange={handleChange}
                autoComplete="address-level2"
              />
            </label>
            <label className="pp-field pp-field--state">
              <span className="pp-field__label">State</span>
              <input
                className="pp-field__input"
                type="text"
                name="state"
                value={form.state}
                onChange={handleChange}
                maxLength={2}
                autoComplete="address-level1"
              />
            </label>
            <label className="pp-field pp-field--zip">
              <span className="pp-field__label">ZIP</span>
              <input
                className="pp-field__input"
                type="text"
                name="zip"
                value={form.zip}
                onChange={handleChange}
                maxLength={10}
                autoComplete="postal-code"
              />
            </label>
          </div>
        </section>

        {/* ── Notes ────────────────────────────────────────────────────── */}
        <section className="pp-section">
          <h2 className="pp-section__title">Delivery Notes</h2>
          <div className="pp-row">
            <label className="pp-field">
              <span className="pp-field__label">Notes for the driver <span className="pp-field__optional">(optional)</span></span>
              <textarea
                className="pp-field__input pp-field__textarea"
                name="notes"
                value={form.notes}
                onChange={handleChange}
                rows={3}
                placeholder="e.g. Gate code, tank location, access instructions…"
              />
            </label>
          </div>
        </section>

        {/* ── Actions ──────────────────────────────────────────────────── */}
        <div className="pp-actions">
          <button
            type="button"
            className="pp-btn pp-btn--ghost"
            onClick={handleReset}
            disabled={!dirty || saving}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="pp-btn pp-btn--primary"
            disabled={!dirty || saving}
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default ProfilePage
