/**
 * src/features/admin/pages/EmailTemplates.tsx
 *
 * Admin page — editable wording for outbound email templates.
 * Saved to /settings/emailTemplates in Firestore.
 *
 * Currently manages:
 *  - Quote email intro paragraph
 *  - "Want to discuss?" copy (shown instead of a Decline button)
 */

import React, { useState, useEffect } from 'react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase'
import { Button } from '../../../components/ui/Button'
import './EmailTemplates.css'

interface EmailTemplateSettings {
  quoteIntro:       string
  quoteDiscussNote: string
}

const DEFAULTS: EmailTemplateSettings = {
  quoteIntro:       '',
  quoteDiscussNote: '',
}

const PLACEHOLDERS: EmailTemplateSettings = {
  quoteIntro:
    'Thank you for your interest in {Company Name}. Please review your quote below.',
  quoteDiscussNote:
    "We want to ensure you're completely happy with our service. Please reach out to us to discuss any adjustments.",
}

async function getEmailTemplates(): Promise<EmailTemplateSettings> {
  const snap = await getDoc(doc(db, 'settings', 'emailTemplates'))
  if (!snap.exists()) return { ...DEFAULTS }
  return { ...DEFAULTS, ...(snap.data() as Partial<EmailTemplateSettings>) }
}

async function saveEmailTemplates(settings: EmailTemplateSettings): Promise<void> {
  await setDoc(doc(db, 'settings', 'emailTemplates'), settings, { merge: true })
}

// ── Page ──────────────────────────────────────────────────────────────────────

const EmailTemplatesPage: React.FC = () => {
  const [settings, setSettings] = useState<EmailTemplateSettings>(DEFAULTS)
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)
  const [error, setError]       = useState<string | null>(null)

  useEffect(() => {
    getEmailTemplates()
      .then(setSettings)
      .catch(() => setError('Failed to load template settings.'))
      .finally(() => setLoading(false))
  }, [])

  function handleChange(field: keyof EmailTemplateSettings, value: string): void {
    setSaved(false)
    setSettings((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSave(): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      await saveEmailTemplates(settings)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch {
      setError('Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="et-page">
        <div className="et-loading">Loading template settings…</div>
      </div>
    )
  }

  return (
    <div className="et-page">
      <div className="et-header">
        <h1 className="et-header__title">Email Templates</h1>
        <p className="et-header__sub">
          Customize the wording used in outbound emails. Leave a field blank to use the default text.
        </p>
      </div>

      {error && <div className="et-error">{error}</div>}

      {/* ── Quote Email ─────────────────────────────────────────────────── */}
      <section className="et-section">
        <div className="et-section__header">
          <h2 className="et-section__title">Quote Email</h2>
          <p className="et-section__desc">
            Sent to customers and leads when a quote is issued. The PDF is attached automatically.
            Company info is pulled from <strong>Admin › Company Info</strong>.
          </p>
        </div>

        <div className="et-field">
          <label className="et-field__label" htmlFor="quoteIntro">
            Opening Paragraph
          </label>
          <p className="et-field__hint">
            Shown at the top of the email, above the quote table.
          </p>
          <textarea
            id="quoteIntro"
            className="et-field__textarea"
            rows={3}
            value={settings.quoteIntro}
            onChange={(e) => handleChange('quoteIntro', e.target.value)}
            placeholder={PLACEHOLDERS.quoteIntro}
          />
        </div>

        <div className="et-field">
          <label className="et-field__label" htmlFor="quoteDiscussNote">
            "Have Questions?" Note
          </label>
          <p className="et-field__hint">
            Shown below the Accept button in place of a Decline button. Encourages prospects to
            reach out rather than decline. The account representative's contact info is displayed
            below this text automatically.
          </p>
          <textarea
            id="quoteDiscussNote"
            className="et-field__textarea"
            rows={3}
            value={settings.quoteDiscussNote}
            onChange={(e) => handleChange('quoteDiscussNote', e.target.value)}
            placeholder={PLACEHOLDERS.quoteDiscussNote}
          />
        </div>
      </section>

      <div className="et-actions">
        <Button
          variant="primary"
          size="lg"
          onClick={() => void handleSave()}
          loading={saving}
        >
          {saved ? '✓ Saved' : 'Save Templates'}
        </Button>
      </div>
    </div>
  )
}

export default EmailTemplatesPage
