/**
 * src/pages/public/PublicQuotePage.tsx
 *
 * Public quote acceptance page — accessible via email link, no login required.
 * URL: /quote/:quoteId?token=TOKEN
 *
 * The one-time publicToken is generated when a quote is sent and stored on
 * the quote document. The getPublicQuote Cloud Function validates it.
 */

import React, { useEffect, useState } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { QRCodeSVG } from 'qrcode.react'
import { functions } from '../../lib/firebase'
import './PublicQuotePage.css'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PublicLineItem {
  description: string
  quantity:    number
  unitPrice:   number
  amount:      number
}

interface PublicQuoteData {
  id:          string
  quoteNumber: string
  status:      string
  validUntil:  string | null
  lineItems:   PublicLineItem[]
  subtotal:    number
  total:       number
  notes:       string
}

interface CompanyInfo {
  name:    string
  tagline: string
  phone:   string
  email:   string
  website: string
  logoUrl: string
}

interface RepInfo {
  name:  string
  email: string
  phone: string
}

interface PublicQuoteResponse {
  quote:       PublicQuoteData
  company:     CompanyInfo
  rep:         RepInfo | null
  discussNote: string
  setupUrl?:   string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatMoney(val: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val)
}

function formatDate(val: unknown): string {
  if (!val) return '—'
  try {
    let d: Date
    if (typeof val === 'object' && val !== null && 'toDate' in (val as object)) {
      d = (val as { toDate(): Date }).toDate()
    } else {
      d = new Date(val as string)
    }
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  } catch {
    return '—'
  }
}

// ── Page ──────────────────────────────────────────────────────────────────────

const PublicQuotePage: React.FC = () => {
  const { quoteId }     = useParams<{ quoteId: string }>()
  const [params]        = useSearchParams()
  const token           = params.get('token') ?? ''

  const [data, setData]           = useState<PublicQuoteResponse | null>(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [accepting, setAccepting] = useState(false)
  const [accepted, setAccepted]   = useState(false)
  const [acceptError, setAcceptError] = useState<string | null>(null)
  const [setupUrl, setSetupUrl]   = useState<string | null>(null)

  useEffect(() => {
    if (!quoteId || !token) {
      setError('This link is missing required information. Please use the link from your email.')
      setLoading(false)
      return
    }

    const fn = httpsCallable<{ quoteId: string; token: string }, PublicQuoteResponse>(
      functions,
      'getPublicQuote',
    )
    fn({ quoteId, token })
      .then((res) => {
        setData(res.data)
        setLoading(false)
        // If quote was already accepted from a prior click, show success state
        if (res.data.quote.status === 'accepted') {
          setAccepted(true)
          if (res.data.setupUrl) setSetupUrl(res.data.setupUrl)
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Unable to load this quote.'
        setError(msg)
        setLoading(false)
      })
  }, [quoteId, token])

  async function handleAccept(): Promise<void> {
    if (!quoteId || !token) return
    setAccepting(true)
    setAcceptError(null)
    try {
      const fn = httpsCallable<
        { quoteId: string; token: string; response: string },
        { success: boolean; setupUrl?: string | null }
      >(functions, 'respondToQuotePublic')
      const result = await fn({ quoteId, token, response: 'accepted' })
      setAccepted(true)
      if (result.data.setupUrl) setSetupUrl(result.data.setupUrl)
      if (data) {
        setData({ ...data, quote: { ...data.quote, status: 'accepted' } })
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to accept the quote. Please try again.'
      setAcceptError(msg)
    } finally {
      setAccepting(false)
    }
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="pqp-shell">
        <div className="pqp-loading">
          <span className="pqp-spinner" />
          <p>Loading your quote…</p>
        </div>
      </div>
    )
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error || !data) {
    return (
      <div className="pqp-shell">
        <div className="pqp-error-card">
          <div className="pqp-error-icon">!</div>
          <h2>Unable to Load Quote</h2>
          <p>{error || 'Something went wrong. Please use the link from your email.'}</p>
          <p className="pqp-error-hint">
            If you believe this is an error, please contact us directly.
          </p>
        </div>
      </div>
    )
  }

  const { quote, company, rep, discussNote } = data

  // ── Accepted state ─────────────────────────────────────────────────────────
  if (accepted || quote.status === 'accepted') {
    return (
      <div className="pqp-shell">
        <div className="pqp-header" style={{ background: '#16a34a' }}>
          <h1>{company.name || 'Ohio Gas Supply'}</h1>
          {company.tagline && <p className="pqp-header__tagline">{company.tagline}</p>}
        </div>
        <div className="pqp-card">
          <div className="pqp-success">
            <div className="pqp-success__icon">✓</div>
            <h2>Quote Accepted!</h2>
            <p>
              Thank you for accepting Quote #{quote.quoteNumber}. Your account representative has
              been notified and will be in touch shortly to complete your setup.
            </p>

            {setupUrl ? (
              <div className="pqp-setup-block">
                <p className="pqp-setup-block__heading">Set up your portal account</p>
                <p className="pqp-setup-block__sub">
                  Track orders, view invoices, and manage your account online.
                  Scan the QR code or tap the button below.
                </p>
                <div className="pqp-setup-block__qr">
                  <QRCodeSVG value={setupUrl} size={160} includeMargin />
                </div>
                <a href={setupUrl} className="pqp-btn pqp-btn--primary pqp-btn--wide">
                  Create Your Portal Account
                </a>
              </div>
            ) : (
              <Link to="/signup" className="pqp-btn pqp-btn--primary pqp-btn--wide">
                Create Your Portal Account
              </Link>
            )}

            {rep && (
              <div className="pqp-rep pqp-rep--success">
                <p className="pqp-rep__name">{rep.name}</p>
                {rep.email && <p className="pqp-rep__contact"><a href={`mailto:${rep.email}`}>{rep.email}</a></p>}
                {rep.phone && <p className="pqp-rep__contact">{rep.phone}</p>}
              </div>
            )}
          </div>
        </div>
        {company.name && (
          <div className="pqp-footer">
            {[company.name, company.website, company.phone].filter(Boolean).join('  ·  ')}
          </div>
        )}
      </div>
    )
  }

  // ── Expired / Unavailable ──────────────────────────────────────────────────
  if (quote.status !== 'sent') {
    return (
      <div className="pqp-shell">
        <div className="pqp-header">
          <h1>{company.name || 'Ohio Gas Supply'}</h1>
        </div>
        <div className="pqp-card">
          <div className="pqp-status-note">
            <h2>Quote #{quote.quoteNumber}</h2>
            <p>
              This quote is no longer available for online acceptance
              (status: <strong>{quote.status}</strong>).
            </p>
            {rep && (
              <div className="pqp-rep">
                <p className="pqp-rep__label">Contact your representative:</p>
                <p className="pqp-rep__name">{rep.name}</p>
                {rep.email && <p className="pqp-rep__contact"><a href={`mailto:${rep.email}`}>{rep.email}</a></p>}
                {rep.phone && <p className="pqp-rep__contact">{rep.phone}</p>}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── Main quote view ────────────────────────────────────────────────────────
  return (
    <div className="pqp-shell">
      <div className="pqp-header">
        <h1>{company.name || 'Ohio Gas Supply'}</h1>
        {company.tagline && <p className="pqp-header__tagline">{company.tagline}</p>}
      </div>

      <div className="pqp-card">
        <div className="pqp-quote-meta">
          <div>
            <span className="pqp-label">Quote #</span>
            <span className="pqp-value">{quote.quoteNumber}</span>
          </div>
          {quote.validUntil && (
            <div>
              <span className="pqp-label">Valid Until</span>
              <span className="pqp-value">{formatDate(quote.validUntil)}</span>
            </div>
          )}
        </div>

        {/* Line items */}
        <table className="pqp-table">
          <thead>
            <tr>
              <th>Description</th>
              <th className="pqp-table__num">Qty</th>
              <th className="pqp-table__num">Unit Price</th>
              <th className="pqp-table__num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {quote.lineItems.map((item, i) => (
              <tr key={i}>
                <td>{item.description}</td>
                <td className="pqp-table__num">{item.quantity}</td>
                <td className="pqp-table__num">{formatMoney(item.unitPrice)}</td>
                <td className="pqp-table__num">{formatMoney(item.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="pqp-table__total-label">Total</td>
              <td className="pqp-table__total-val">{formatMoney(quote.total)}</td>
            </tr>
          </tfoot>
        </table>

        {quote.notes && (
          <div className="pqp-notes">
            <p className="pqp-label">Notes</p>
            <p>{quote.notes}</p>
          </div>
        )}

        {/* Accept action */}
        {acceptError && <p className="pqp-accept-error">{acceptError}</p>}

        <div className="pqp-actions">
          <button
            className="pqp-btn pqp-btn--primary"
            onClick={() => void handleAccept()}
            disabled={accepting}
          >
            {accepting ? 'Processing…' : '✓ Accept This Quote'}
          </button>
        </div>

        {/* Rep contact / questions block */}
        <div className="pqp-discuss">
          <p className="pqp-discuss__note">{discussNote}</p>
          {rep && (
            <div className="pqp-rep">
              <p className="pqp-rep__label">Your account representative:</p>
              <p className="pqp-rep__name">{rep.name}</p>
              {rep.email && (
                <p className="pqp-rep__contact">
                  <a href={`mailto:${rep.email}`}>{rep.email}</a>
                </p>
              )}
              {rep.phone && <p className="pqp-rep__contact">{rep.phone}</p>}
            </div>
          )}
          {!rep && company.email && (
            <p className="pqp-rep__contact">
              <a href={`mailto:${company.email}`}>{company.email}</a>
            </p>
          )}
          {!rep && company.phone && (
            <p className="pqp-rep__contact">{company.phone}</p>
          )}
        </div>
      </div>

      {company.name && (
        <div className="pqp-footer">
          {[company.name, company.website, company.phone].filter(Boolean).join('  ·  ')}
        </div>
      )}
    </div>
  )
}

export default PublicQuotePage
