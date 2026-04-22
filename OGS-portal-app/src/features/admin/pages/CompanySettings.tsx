/**
 * src/features/admin/pages/CompanySettings.tsx
 *
 * Admin page — company information used in PDFs, invoices, quotes, and emails.
 * Saved to /settings/company in Firestore; logo to Firebase Storage.
 */

import React, { useState, useEffect, useRef } from 'react'
import {
  getCompanySettings,
  updateCompanySettings,
  uploadCompanyLogo,
} from '../../../services/companySettingsService'
import type { CompanySettings } from '../../../types/companySettings'
import { DEFAULT_COMPANY_SETTINGS } from '../../../types/companySettings'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import { Modal } from '../../../components/ui/Modal'
import { useAuth } from '../../../hooks/useAuth'
import { clearAllTestData } from '../../../services/adminService'
import './CompanySettings.css'

const CompanySettingsPage: React.FC = () => {
  const { isAdmin }                    = useAuth()
  const [settings, setSettings]         = useState<CompanySettings>(DEFAULT_COMPANY_SETTINGS)
  const [loading, setLoading]           = useState(true)
  const [saving, setSaving]             = useState(false)
  const [saved, setSaved]               = useState(false)
  const [error, setError]               = useState<string | null>(null)
  const [logoFile, setLogoFile]         = useState<File | null>(null)
  const [logoPreview, setLogoPreview]   = useState<string>('')
  const [uploadPct, setUploadPct]       = useState<number | null>(null)
  const [showClearModal, setShowClearModal] = useState(false)
  const [clearConfirmText, setClearConfirmText] = useState('')
  const [clearing, setClearing] = useState(false)
  const [clearStatus, setClearStatus] = useState<string | null>(null)
  const fileInputRef                    = useRef<HTMLInputElement>(null)

  useEffect(() => {
    getCompanySettings()
      .then(setSettings)
      .catch(() => setError('Could not load company settings.'))
      .finally(() => setLoading(false))
  }, [])

  function set(field: keyof CompanySettings, value: string) {
    setSettings((prev) => ({ ...prev, [field]: value }))
    setSaved(false)
  }

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoFile(file)
    setLogoPreview(URL.createObjectURL(file))
    setSaved(false)
    // reset input so re-selecting same file fires onChange
    e.target.value = ''
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      let logoUrl = settings.logoUrl
      if (logoFile) {
        setUploadPct(0)
        logoUrl = await uploadCompanyLogo(logoFile, setUploadPct)
        setUploadPct(null)
        setLogoFile(null)
      }
      await updateCompanySettings({ ...settings, logoUrl })
      setSettings((prev) => ({ ...prev, logoUrl }))
      setSaved(true)
    } catch {
      setError('Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleClearAllTestData() {
    setClearing(true)
    setClearStatus(null)
    try {
      const result = await clearAllTestData(clearConfirmText)
      setClearStatus(`Success — cleared ${result.clearedCollections.join(', ')}.`)
      setShowClearModal(false)
      setClearConfirmText('')
    } catch (err) {
      setClearStatus(err instanceof Error ? err.message : 'Failed to clear test data.')
    } finally {
      setClearing(false)
    }
  }

  if (loading) return <div className="cs-loading">Loading company settings…</div>

  const logoSrc = logoPreview || settings.logoUrl

  return (
    <div className="cs-page">
      <header className="cs-header">
        <div>
          <h1 className="cs-header__title">Company Information</h1>
          <p className="cs-header__sub">
            This information appears on invoices, quotes, PDFs, and outgoing emails.
          </p>
        </div>
        <Button variant="primary" size="md" loading={saving} disabled={saving} onClick={handleSave}>
          {saved ? '✓ Saved' : 'Save changes'}
        </Button>
      </header>

      {error && <div className="cs-error" role="alert">{error}</div>}
      {clearStatus && <div className="cs-status" role="status">{clearStatus}</div>}

      <div className="cs-body">

        {/* ── Logo ── */}
        <section className="cs-card">
          <h2 className="cs-card__title">Company Logo</h2>
          <p className="cs-card__sub">Used on PDF headers, invoices, and quotes. PNG or SVG recommended, at least 300 px wide.</p>
          <div className="cs-logo-row">
            <div className="cs-logo-preview">
              {logoSrc
                ? <img src={logoSrc} alt="Company logo" className="cs-logo-preview__img" />
                : <span className="cs-logo-preview__placeholder">No logo</span>
              }
            </div>
            <div className="cs-logo-controls">
              <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
                {logoSrc ? 'Replace logo' : 'Upload logo'}
              </Button>
              {logoFile && !uploadPct && (
                <span className="cs-logo-pending">Unsaved — click Save changes to upload</span>
              )}
              {uploadPct !== null && (
                <div className="cs-progress">
                  <div className="cs-progress__bar" style={{ width: `${uploadPct}%` }} />
                  <span className="cs-progress__label">{uploadPct}%</span>
                </div>
              )}
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/svg+xml,image/jpeg,image/webp"
            style={{ display: 'none' }}
            onChange={handleLogoChange}
          />
        </section>

        {/* ── Identity ── */}
        <section className="cs-card">
          <h2 className="cs-card__title">Company Identity</h2>
          <div className="cs-grid cs-grid--2">
            <Input
              label="Company name"
              value={settings.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="OGS Gas Services"
            />
            <Input
              label="Tagline / slogan"
              value={settings.tagline}
              onChange={(e) => set('tagline', e.target.value)}
              placeholder="Reliable gas, delivered."
            />
          </div>
        </section>

        {/* ── Contact ── */}
        <section className="cs-card">
          <h2 className="cs-card__title">Contact Information</h2>
          <div className="cs-grid cs-grid--3">
            <Input
              label="Email address"
              type="email"
              value={settings.email}
              onChange={(e) => set('email', e.target.value)}
              placeholder="info@ogsgas.com"
            />
            <Input
              label="Phone number"
              type="tel"
              value={settings.phone}
              onChange={(e) => set('phone', e.target.value)}
              placeholder="(555) 000-0000"
            />
            <Input
              label="Website"
              type="url"
              value={settings.website}
              onChange={(e) => set('website', e.target.value)}
              placeholder="https://ogsgas.com"
            />
          </div>
        </section>

        {/* ── Address ── */}
        <section className="cs-card">
          <h2 className="cs-card__title">Business Address</h2>
          <div className="cs-grid cs-grid--1">
            <Input
              label="Street address"
              value={settings.address}
              onChange={(e) => set('address', e.target.value)}
              placeholder="123 Industrial Blvd"
            />
          </div>
          <div className="cs-grid cs-grid--3 cs-grid--mt">
            <Input
              label="City"
              value={settings.city}
              onChange={(e) => set('city', e.target.value)}
              placeholder="Houston"
            />
            <Input
              label="State"
              value={settings.state}
              onChange={(e) => set('state', e.target.value)}
              placeholder="TX"
            />
            <Input
              label="ZIP code"
              value={settings.zip}
              onChange={(e) => set('zip', e.target.value)}
              placeholder="77001"
            />
          </div>
        </section>

        {/* ── Customer Portal Links ── */}
        <section className="cs-card">
          <h2 className="cs-card__title">Customer Portal Links</h2>
          <p className="cs-card__sub">
            Printed on invoices and quotes so customers can log in or create an account.
            Leave blank to omit from documents.
          </p>
          <div className="cs-grid cs-grid--2">
            <Input
              label="Login link"
              type="url"
              value={settings.portalLoginUrl}
              onChange={(e) => set('portalLoginUrl', e.target.value)}
              placeholder="https://portal.ogsgas.com/login"
            />
            <Input
              label="Sign-up / create account link"
              type="url"
              value={settings.portalSignupUrl}
              onChange={(e) => set('portalSignupUrl', e.target.value)}
              placeholder="https://portal.ogsgas.com/signup"
            />
          </div>
        </section>

        {/* ── Legal ── */}
        <section className="cs-card">
          <h2 className="cs-card__title">Legal &amp; Billing</h2>
          <p className="cs-card__sub">Displayed on invoice footers and quote documents.</p>
          <div className="cs-grid cs-grid--2">
            <Input
              label="Tax ID / EIN"
              value={settings.taxId}
              onChange={(e) => set('taxId', e.target.value)}
              placeholder="XX-XXXXXXX"
            />
          </div>
        </section>

        {/* ── Terms & Conditions ── */}
        <section className="cs-card">
          <h2 className="cs-card__title">Terms &amp; Conditions</h2>
          <p className="cs-card__sub">
            Appended to the bottom of quote and invoice PDFs. Leave blank to omit.
          </p>
          <div className="ui-field">
            <label className="ui-field__label">Terms &amp; Conditions text</label>
            <textarea
              className="ui-input cs-textarea"
              rows={8}
              value={settings.termsAndConditions}
              onChange={(e) => set('termsAndConditions', e.target.value)}
              placeholder="All sales are subject to our standard terms. Payment is due within 30 days..."
            />
          </div>
        </section>

        {isAdmin && (
          <section className="cs-card cs-card--danger">
            <h2 className="cs-card__title">Danger Zone</h2>
            <p className="cs-card__sub">
              Remove all customers, contacts, quotes, invoices, orders, and runs so the system is ready for live data only.
            </p>
            <Button variant="danger" size="md" onClick={() => setShowClearModal(true)}>
              Clear All Test Data
            </Button>
          </section>
        )}

      </div>

      <Modal open={showClearModal} onClose={() => !clearing && setShowClearModal(false)} title="Clear All Test Data" size="md">
        <div className="cs-danger-modal">
          <p className="cs-danger-modal__warning">
            This will permanently delete all customers, contacts, runs, quotes, and invoices. This cannot be undone.
          </p>
          <Input
            label='Type "DELETE" to confirm'
            value={clearConfirmText}
            onChange={(e) => setClearConfirmText(e.target.value)}
            placeholder="DELETE"
          />
          <div className="cs-danger-modal__actions">
            <Button variant="secondary" onClick={() => setShowClearModal(false)} disabled={clearing}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleClearAllTestData}
              loading={clearing}
              disabled={clearConfirmText !== 'DELETE'}
            >
              Clear All Test Data
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

export default CompanySettingsPage
