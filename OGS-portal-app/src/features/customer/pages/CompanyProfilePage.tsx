/**
 * src/features/customer/pages/CompanyProfilePage.tsx
 *
 * Customer portal — Our Company Profile
 * Route: /portal/company
 *
 * Shows and lets authorized users edit business-level information:
 *   • Business information (company name, type, tax-exempt status)
 *   • Primary billing contact & address
 *   • Delivery locations (multiple, from locations subcollection)
 *   • Payment method (read-only; managed via Billing/Settings)
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  subscribeToCompany,
  updateCompany,
  getLocations,
  saveLocation,
  deleteLocation,
} from '../../../services/onboardingService'
import { useAuth } from '../../../hooks/useAuth'
import type { Company, DeliveryLocation, PreferredDay } from '../../../types/company'
import './CompanyProfilePage.css'

// ── Constants ─────────────────────────────────────────────────────────────────

const BUSINESS_TYPE_LABELS: Record<string, string> = {
  restaurant:    'Restaurant / Food Service',
  brewery:       'Brewery / Winery',
  medical_dental:'Medical / Dental',
  fabricator:    'Metal Fabricator / Industrial',
  other:         'Other',
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cod:   'Cash on Delivery (COD)',
  card:  'Credit / Debit Card',
  ach:   'ACH / Bank Transfer',
  net30: 'Net 30',
}

const DAY_LABELS: Record<PreferredDay, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat',
}

const ALL_DAYS: PreferredDay[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat']

// ── Blank location form ───────────────────────────────────────────────────────

function blankLocation(): Omit<DeliveryLocation, 'id'> {
  return {
    nickname:        '',
    address:         { street: '', city: '', state: '', zip: '' },
    accessNotes:     '',
    preferredDays:   [],
    contactName:     '',
    contactPhone:    '',
    cylinderStorage: 'outdoors',
    currentProvider: null,
  }
}

// ── Toast helper type ─────────────────────────────────────────────────────────

type Toast = { msg: string; type: 'success' | 'error' }

// ── Component ─────────────────────────────────────────────────────────────────

const CompanyProfilePage: React.FC = () => {
  const { user } = useAuth()
  const companyId = user?.companyId ?? user?.customerId ?? user?.id ?? null

  // ── Company state ──────────────────────────────────────────────────────────
  const [company, setCompany] = useState<Company | null>(null)
  const [companyLoading, setCompanyLoading] = useState(true)

  // Company form (billing/contact section)
  const [companyForm, setCompanyForm] = useState<{
    companyName:       string
    billingContactName:string
    billingEmail:      string
    phone:             string
    billingStreet:     string
    billingCity:       string
    billingState:      string
    billingZip:        string
  } | null>(null)
  const [companyDirty, setCompanyDirty] = useState(false)
  const [companySaving, setCompanySaving] = useState(false)

  // ── Locations state ────────────────────────────────────────────────────────
  const [locations, setLocations] = useState<DeliveryLocation[]>([])
  const [locationsLoading, setLocationsLoading] = useState(true)

  // Location editor
  const [editingLocation, setEditingLocation] = useState<{ id?: string; data: Omit<DeliveryLocation, 'id'> } | null>(null)
  const [locationSaving, setLocationSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // ── Toast ──────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState<Toast | null>(null)

  function showToast(msg: string, type: Toast['type']) {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  // ── Subscribe company ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!companyId) return
    const unsub = subscribeToCompany(companyId, (c) => {
      setCompany(c ?? null)
      if (c && !companyDirty) {
        setCompanyForm({
          companyName:       c.companyName       ?? '',
          billingContactName:c.billingContactName ?? '',
          billingEmail:      c.billingEmail       ?? '',
          phone:             c.phone              ?? '',
          billingStreet:     c.billingAddress?.street ?? '',
          billingCity:       c.billingAddress?.city   ?? '',
          billingState:      c.billingAddress?.state  ?? '',
          billingZip:        c.billingAddress?.zip    ?? '',
        })
      }
      setCompanyLoading(false)
    })
    return unsub
  // companyDirty intentionally excluded
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  // ── Load locations ─────────────────────────────────────────────────────────
  const loadLocations = useCallback(async () => {
    if (!companyId) return
    setLocationsLoading(true)
    try {
      const locs = await getLocations(companyId)
      setLocations(locs)
    } finally {
      setLocationsLoading(false)
    }
  }, [companyId])

  useEffect(() => { loadLocations() }, [loadLocations])

  // ── Company form handlers ──────────────────────────────────────────────────
  const handleCompanyChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setCompanyForm((prev) => prev ? { ...prev, [name]: value } : prev)
    setCompanyDirty(true)
  }

  const handleCompanySubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!companyId || !companyForm) return
    setCompanySaving(true)
    try {
      await updateCompany(companyId, {
        companyName:        companyForm.companyName.trim(),
        billingContactName: companyForm.billingContactName.trim(),
        billingEmail:       companyForm.billingEmail.trim(),
        phone:              companyForm.phone.trim(),
        billingAddress: {
          street: companyForm.billingStreet.trim(),
          city:   companyForm.billingCity.trim(),
          state:  companyForm.billingState.trim(),
          zip:    companyForm.billingZip.trim(),
        },
      })
      setCompanyDirty(false)
      showToast('Company profile updated.', 'success')
    } catch {
      showToast('Failed to save. Please try again.', 'error')
    } finally {
      setCompanySaving(false)
    }
  }

  const handleCompanyReset = () => {
    if (company) {
      setCompanyForm({
        companyName:       company.companyName        ?? '',
        billingContactName:company.billingContactName ?? '',
        billingEmail:      company.billingEmail       ?? '',
        phone:             company.phone              ?? '',
        billingStreet:     company.billingAddress?.street ?? '',
        billingCity:       company.billingAddress?.city   ?? '',
        billingState:      company.billingAddress?.state  ?? '',
        billingZip:        company.billingAddress?.zip    ?? '',
      })
      setCompanyDirty(false)
    }
  }

  // ── Location editor handlers ───────────────────────────────────────────────
  const openNewLocation = () =>
    setEditingLocation({ data: blankLocation() })

  const openEditLocation = (loc: DeliveryLocation) =>
    setEditingLocation({ id: loc.id, data: { ...loc, address: { ...loc.address } } })

  const handleLocationFieldChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = e.target
    setEditingLocation((prev) => {
      if (!prev) return prev
      if (name.startsWith('addr.')) {
        const key = name.slice(5) as keyof DeliveryLocation['address']
        return { ...prev, data: { ...prev.data, address: { ...prev.data.address, [key]: value } } }
      }
      return { ...prev, data: { ...prev.data, [name]: value } }
    })
  }

  const togglePreferredDay = (day: PreferredDay) => {
    setEditingLocation((prev) => {
      if (!prev) return prev
      const days = prev.data.preferredDays.includes(day)
        ? prev.data.preferredDays.filter((d) => d !== day)
        : [...prev.data.preferredDays, day]
      return { ...prev, data: { ...prev.data, preferredDays: days } }
    })
  }

  const handleLocationSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!companyId || !editingLocation) return
    setLocationSaving(true)
    try {
      await saveLocation(companyId, editingLocation.data, editingLocation.id)
      await loadLocations()
      setEditingLocation(null)
      showToast('Location saved.', 'success')
    } catch {
      showToast('Failed to save location. Please try again.', 'error')
    } finally {
      setLocationSaving(false)
    }
  }

  const handleLocationDelete = async (locationId: string) => {
    if (!companyId) return
    setDeletingId(locationId)
    try {
      await deleteLocation(companyId, locationId)
      await loadLocations()
      showToast('Location removed.', 'success')
    } catch {
      showToast('Failed to remove location.', 'error')
    } finally {
      setDeletingId(null)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (companyLoading) {
    return (
      <div className="cp-loading">
        <span className="cp-spinner" />
      </div>
    )
  }

  if (!company || !companyForm) {
    return (
      <div className="cp-empty">
        <p>Could not load company profile. Please refresh the page.</p>
      </div>
    )
  }

  return (
    <div className="cp">
      {toast && (
        <div className={`cp-toast cp-toast--${toast.type}`} role="status">
          {toast.msg}
        </div>
      )}

      <header className="cp-header">
        <h1 className="cp-header__title">Our Company Profile</h1>
        <p className="cp-header__sub">Business information, billing contact, and delivery locations.</p>
      </header>

      {/* ── Business Info (read-only) ──────────────────────────────────────── */}
      <section className="cp-section">
        <h2 className="cp-section__title">Business Information</h2>
        <div className="cp-info-grid">
          <div className="cp-info-item">
            <span className="cp-info-item__label">Business Type</span>
            <span className="cp-info-item__value">
              {company.businessType
                ? BUSINESS_TYPE_LABELS[company.businessType] ?? company.businessType
                : <span className="cp-muted">—</span>}
            </span>
          </div>
          <div className="cp-info-item">
            <span className="cp-info-item__label">Tax Exempt</span>
            <span className="cp-info-item__value">
              {company.taxExempt
                ? <span className="cp-badge cp-badge--green">Yes</span>
                : <span className="cp-badge cp-badge--gray">No</span>}
            </span>
          </div>
          {company.taxExemptNumber && (
            <div className="cp-info-item">
              <span className="cp-info-item__label">Exemption Number</span>
              <span className="cp-info-item__value">{company.taxExemptNumber}</span>
            </div>
          )}
          <div className="cp-info-item">
            <span className="cp-info-item__label">Payment Method</span>
            <span className="cp-info-item__value">
              {company.paymentMethod
                ? PAYMENT_METHOD_LABELS[company.paymentMethod] ?? company.paymentMethod
                : <span className="cp-muted">—</span>}
            </span>
          </div>
        </div>
      </section>

      {/* ── Editable billing / contact form ──────────────────────────────── */}
      <form onSubmit={handleCompanySubmit} noValidate>

        <section className="cp-section">
          <h2 className="cp-section__title">Company Name</h2>
          <div className="cp-row">
            <label className="cp-field">
              <span className="cp-field__label">Company Name</span>
              <input
                className="cp-field__input"
                type="text"
                name="companyName"
                value={companyForm.companyName}
                onChange={handleCompanyChange}
                required
                autoComplete="organization"
              />
            </label>
          </div>
        </section>

        <section className="cp-section">
          <h2 className="cp-section__title">Primary Billing Contact</h2>

          <div className="cp-row">
            <label className="cp-field">
              <span className="cp-field__label">Contact Name</span>
              <input
                className="cp-field__input"
                type="text"
                name="billingContactName"
                value={companyForm.billingContactName}
                onChange={handleCompanyChange}
                autoComplete="name"
              />
            </label>
          </div>

          <div className="cp-row cp-row--2">
            <label className="cp-field">
              <span className="cp-field__label">Billing Email</span>
              <input
                className="cp-field__input"
                type="email"
                name="billingEmail"
                value={companyForm.billingEmail}
                onChange={handleCompanyChange}
                autoComplete="email"
              />
            </label>
            <label className="cp-field">
              <span className="cp-field__label">Phone</span>
              <input
                className="cp-field__input"
                type="tel"
                name="phone"
                value={companyForm.phone}
                onChange={handleCompanyChange}
                autoComplete="tel"
              />
            </label>
          </div>
        </section>

        <section className="cp-section">
          <h2 className="cp-section__title">Billing Address</h2>

          <div className="cp-row">
            <label className="cp-field">
              <span className="cp-field__label">Street Address</span>
              <input
                className="cp-field__input"
                type="text"
                name="billingStreet"
                value={companyForm.billingStreet}
                onChange={handleCompanyChange}
                autoComplete="street-address"
              />
            </label>
          </div>

          <div className="cp-row cp-row--3">
            <label className="cp-field cp-field--grow">
              <span className="cp-field__label">City</span>
              <input
                className="cp-field__input"
                type="text"
                name="billingCity"
                value={companyForm.billingCity}
                onChange={handleCompanyChange}
                autoComplete="address-level2"
              />
            </label>
            <label className="cp-field cp-field--state">
              <span className="cp-field__label">State</span>
              <input
                className="cp-field__input"
                type="text"
                name="billingState"
                value={companyForm.billingState}
                onChange={handleCompanyChange}
                maxLength={2}
                autoComplete="address-level1"
              />
            </label>
            <label className="cp-field cp-field--zip">
              <span className="cp-field__label">ZIP</span>
              <input
                className="cp-field__input"
                type="text"
                name="billingZip"
                value={companyForm.billingZip}
                onChange={handleCompanyChange}
                maxLength={10}
                autoComplete="postal-code"
              />
            </label>
          </div>
        </section>

        <div className="cp-actions">
          <button
            type="button"
            className="cp-btn cp-btn--ghost"
            onClick={handleCompanyReset}
            disabled={!companyDirty || companySaving}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="cp-btn cp-btn--primary"
            disabled={!companyDirty || companySaving}
          >
            {companySaving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </form>

      {/* ── Delivery Locations ────────────────────────────────────────────── */}
      <section className="cp-section cp-section--locations">
        <div className="cp-section__header-row">
          <h2 className="cp-section__title">Delivery Locations</h2>
          <button
            type="button"
            className="cp-btn cp-btn--secondary cp-btn--sm"
            onClick={openNewLocation}
          >
            + Add Location
          </button>
        </div>

        {locationsLoading ? (
          <div className="cp-locations-loading">
            <span className="cp-spinner cp-spinner--sm" />
          </div>
        ) : locations.length === 0 ? (
          <p className="cp-locations-empty">
            No delivery locations on file. Add one above.
          </p>
        ) : (
          <div className="cp-location-list">
            {locations.map((loc) => (
              <div key={loc.id} className="cp-location-card">
                <div className="cp-location-card__top">
                  <div>
                    <span className="cp-location-card__name">{loc.nickname || 'Unnamed Location'}</span>
                    <span className="cp-location-card__addr">
                      {[loc.address.street, loc.address.city, loc.address.state, loc.address.zip]
                        .filter(Boolean).join(', ')}
                    </span>
                  </div>
                  <div className="cp-location-card__actions">
                    <button
                      type="button"
                      className="cp-btn cp-btn--ghost cp-btn--sm"
                      onClick={() => openEditLocation(loc)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="cp-btn cp-btn--danger cp-btn--sm"
                      onClick={() => handleLocationDelete(loc.id)}
                      disabled={deletingId === loc.id}
                    >
                      {deletingId === loc.id ? '…' : 'Remove'}
                    </button>
                  </div>
                </div>

                <div className="cp-location-card__details">
                  {loc.contactName && (
                    <span className="cp-location-card__detail">
                      <span className="cp-location-card__detail-label">Contact:</span>
                      {loc.contactName}{loc.contactPhone ? ` · ${loc.contactPhone}` : ''}
                    </span>
                  )}
                  {loc.preferredDays.length > 0 && (
                    <span className="cp-location-card__detail">
                      <span className="cp-location-card__detail-label">Preferred days:</span>
                      {loc.preferredDays.map((d) => DAY_LABELS[d]).join(', ')}
                    </span>
                  )}
                  {loc.accessNotes && (
                    <span className="cp-location-card__detail">
                      <span className="cp-location-card__detail-label">Access notes:</span>
                      {loc.accessNotes}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Location editor modal ──────────────────────────────────────────── */}
      {editingLocation && (
        <div className="cp-modal-overlay" onClick={() => setEditingLocation(null)}>
          <div className="cp-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cp-modal__header">
              <h3 className="cp-modal__title">
                {editingLocation.id ? 'Edit Location' : 'Add Delivery Location'}
              </h3>
              <button
                type="button"
                className="cp-modal__close"
                onClick={() => setEditingLocation(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <form className="cp-modal__body" onSubmit={handleLocationSave} noValidate>

              <div className="cp-row">
                <label className="cp-field">
                  <span className="cp-field__label">Location Nickname <span className="cp-field__optional">(e.g. Main Office, Warehouse)</span></span>
                  <input
                    className="cp-field__input"
                    type="text"
                    name="nickname"
                    value={editingLocation.data.nickname}
                    onChange={handleLocationFieldChange}
                    required
                    placeholder="Main Office"
                  />
                </label>
              </div>

              <div className="cp-row">
                <label className="cp-field">
                  <span className="cp-field__label">Street Address</span>
                  <input
                    className="cp-field__input"
                    type="text"
                    name="addr.street"
                    value={editingLocation.data.address.street}
                    onChange={handleLocationFieldChange}
                    autoComplete="street-address"
                  />
                </label>
              </div>

              <div className="cp-row cp-row--3">
                <label className="cp-field cp-field--grow">
                  <span className="cp-field__label">City</span>
                  <input
                    className="cp-field__input"
                    type="text"
                    name="addr.city"
                    value={editingLocation.data.address.city}
                    onChange={handleLocationFieldChange}
                  />
                </label>
                <label className="cp-field cp-field--state">
                  <span className="cp-field__label">State</span>
                  <input
                    className="cp-field__input"
                    type="text"
                    name="addr.state"
                    value={editingLocation.data.address.state}
                    onChange={handleLocationFieldChange}
                    maxLength={2}
                  />
                </label>
                <label className="cp-field cp-field--zip">
                  <span className="cp-field__label">ZIP</span>
                  <input
                    className="cp-field__input"
                    type="text"
                    name="addr.zip"
                    value={editingLocation.data.address.zip}
                    onChange={handleLocationFieldChange}
                    maxLength={10}
                  />
                </label>
              </div>

              <div className="cp-row cp-row--2">
                <label className="cp-field">
                  <span className="cp-field__label">On-Site Contact Name <span className="cp-field__optional">(optional)</span></span>
                  <input
                    className="cp-field__input"
                    type="text"
                    name="contactName"
                    value={editingLocation.data.contactName}
                    onChange={handleLocationFieldChange}
                  />
                </label>
                <label className="cp-field">
                  <span className="cp-field__label">Contact Phone <span className="cp-field__optional">(optional)</span></span>
                  <input
                    className="cp-field__input"
                    type="tel"
                    name="contactPhone"
                    value={editingLocation.data.contactPhone}
                    onChange={handleLocationFieldChange}
                  />
                </label>
              </div>

              <div className="cp-row">
                <label className="cp-field">
                  <span className="cp-field__label">Cylinder Storage</span>
                  <select
                    className="cp-field__input"
                    name="cylinderStorage"
                    value={editingLocation.data.cylinderStorage}
                    onChange={handleLocationFieldChange}
                  >
                    <option value="outdoors">Outdoors</option>
                    <option value="indoors">Indoors</option>
                    <option value="dock">Loading Dock</option>
                  </select>
                </label>
              </div>

              <div className="cp-row">
                <label className="cp-field">
                  <span className="cp-field__label">Access Notes <span className="cp-field__optional">(optional)</span></span>
                  <textarea
                    className="cp-field__input cp-field__textarea"
                    name="accessNotes"
                    value={editingLocation.data.accessNotes}
                    onChange={handleLocationFieldChange}
                    rows={2}
                    placeholder="Gate code, key lockbox, special instructions…"
                  />
                </label>
              </div>

              <div className="cp-row">
                <span className="cp-field__label">Preferred Delivery Days <span className="cp-field__optional">(optional)</span></span>
                <div className="cp-day-toggles">
                  {ALL_DAYS.map((day) => (
                    <button
                      key={day}
                      type="button"
                      className={`cp-day-toggle${editingLocation.data.preferredDays.includes(day) ? ' cp-day-toggle--on' : ''}`}
                      onClick={() => togglePreferredDay(day)}
                    >
                      {DAY_LABELS[day]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="cp-modal__footer">
                <button
                  type="button"
                  className="cp-btn cp-btn--ghost"
                  onClick={() => setEditingLocation(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="cp-btn cp-btn--primary"
                  disabled={locationSaving}
                >
                  {locationSaving ? 'Saving…' : 'Save Location'}
                </button>
              </div>

            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default CompanyProfilePage
