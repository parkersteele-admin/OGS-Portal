/**
 * src/features/customer/pages/ProfilePage.tsx
 *
 * Customer portal — My Profile
 * Route: /portal/profile
 *
 * Personal contact information for the logged-in user.
 * For company/billing/delivery information see CompanyProfilePage (/portal/company).
 */

import React, { useState, useEffect } from 'react'
import { subscribeToCustomer, updateCustomer } from '../../../services/customerService'
import { useAuth } from '../../../hooks/useAuth'
import type { Customer } from '../../../types/customer'
import './ProfilePage.css'

// ── Helpers ───────────────────────────────────────────────────────────────────

type CustomerDoc = Customer & {
  companyName?:        string
  billingContactName?: string
  billingEmail?:       string
}

function initForm(raw: Customer) {
  const c = raw as CustomerDoc
  return {
    name:  c.name  || c.billingContactName || c.companyName || '',
    email: c.email || c.billingEmail       || '',
    phone: c.phone || '',
  }
}

type FormState = ReturnType<typeof initForm>

// ── Component ─────────────────────────────────────────────────────────────────

const ProfilePage: React.FC = () => {
  const { user } = useAuth()
  const customerId = user?.companyId ?? user?.customerId ?? user?.id ?? null

  const [customer, setCustomer] = useState<Customer | null>(null)
  const [form, setForm]         = useState<FormState | null>(null)
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [dirty, setDirty]       = useState(false)
  const [toast, setToast]       = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  useEffect(() => {
    if (!customerId) return
    const unsub = subscribeToCustomer(customerId, (c) => {
      setCustomer(c ?? null)
      if (c && !dirty) setForm(initForm(c))
      setLoading(false)
    })
    return unsub
  // dirty intentionally excluded — seed form once on first load
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
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
        name:  form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
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
        <p className="pp-header__sub">Your personal contact information.</p>
      </header>

      <form className="pp-form" onSubmit={handleSubmit} noValidate>

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
