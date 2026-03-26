/**
 * src/pages/customer/PayInvoicePage.tsx
 *
 * Manual invoice payment flow for the customer portal.
 *
 * Route: /portal/invoices/:invoiceId/pay
 *
 * Flow:
 *  1. Load invoice + saved payment methods
 *  2. Call createStripePaymentIntent → get clientSecret
 *  3. Option A — one-click with a saved card/bank
 *  4. Option B — PaymentElement for a new card/bank
 *  5. After confirmation, subscribe to invoice Firestore doc
 *  6. When invoice.status === 'paid' → show success screen
 */

import React, { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  useStripe,
  useElements,
  PaymentElement,
} from '@stripe/react-stripe-js'
import { useAuth } from '../../../hooks/useAuth'
import { usePaymentMethods } from '../../../hooks/usePaymentMethods'
import { StripeProvider } from '../../../components/payments/StripeProvider'
import { SavedPaymentMethod } from '../../../components/payments/SavedPaymentMethod'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { subscribeToInvoice } from '../../../services/invoiceService'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../../../lib/firebase'
import type { Invoice } from '../../../types/billing'
import { formatCurrency, formatDate } from '../../../utils/format'

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusBadge(status: Invoice['status']) {
  const map = {
    draft:   { variant: 'neutral',  label: 'Draft' },
    sent:    { variant: 'info',     label: 'Due' },
    overdue: { variant: 'danger',   label: 'Overdue' },
    paid:    { variant: 'success',  label: 'Paid' },
    void:    { variant: 'neutral',  label: 'Void' },
  } as const
  const { variant, label } = map[status] ?? { variant: 'neutral', label: status }
  return <Badge variant={variant}>{label}</Badge>
}

// ── Confirm-with-saved-method button ──────────────────────────────────────────

interface SavedMethodPayProps {
  clientSecret: string
  stripePaymentMethodId: string
  label: string
  onSuccess: () => void
  onError: (msg: string) => void
}

function SavedMethodPay({ clientSecret, stripePaymentMethodId, label, onSuccess, onError }: SavedMethodPayProps) {
  const stripe = useStripe()
  const [loading, setLoading] = useState(false)

  async function handlePay() {
    if (!stripe) return
    setLoading(true)
    const { error } = await stripe.confirmPayment({
      clientSecret,
      confirmParams: {
        payment_method: stripePaymentMethodId,
        return_url: window.location.href,
      },
      redirect: 'if_required',
    })
    if (error) {
      onError(error.message ?? 'Payment failed.')
      setLoading(false)
    } else {
      onSuccess()
    }
  }

  return (
    <Button variant="primary" size="md" loading={loading} onClick={handlePay} style={{ width: '100%' }}>
      Pay with {label}
    </Button>
  )
}

// ── New-method form (inside StripeProvider) ───────────────────────────────────

interface NewMethodFormProps {
  invoiceId: string
  onSuccess: () => void
  onError: (msg: string) => void
}

function NewMethodForm({ onSuccess, onError }: NewMethodFormProps) {
  const stripe   = useStripe()
  const elements = useElements()
  const [ready, setReady]   = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return
    setLoading(true)

    const { error: submitErr } = await elements.submit()
    if (submitErr) { onError(submitErr.message ?? 'Check your payment details.'); setLoading(false); return }

    const { error: confirmErr } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: 'if_required',
    })

    if (confirmErr) {
      onError(confirmErr.message ?? 'Payment could not be processed.')
      setLoading(false)
    } else {
      onSuccess()
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <PaymentElement
          onReady={() => setReady(true)}
          options={{ layout: 'tabs', paymentMethodOrder: ['card', 'us_bank_account'] }}
        />
        <Button type="submit" variant="primary" size="md" loading={loading} disabled={!stripe || !ready} style={{ width: '100%' }}>
          Pay now
        </Button>
      </div>
    </form>
  )
}

// ── Success screen ────────────────────────────────────────────────────────────

function SuccessScreen({ invoice }: { invoice: Invoice }) {
  return (
    <div style={{ textAlign: 'center', padding: '40px 20px' }}>
      <div style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 56, height: 56, borderRadius: '50%',
        background: '#d1fae5', marginBottom: 20,
      }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <path d="M5 13l4 4L19 7" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      <h2 style={{ fontSize: 'var(--font-size-20)', fontWeight: 700, color: 'var(--color-text)', marginBottom: 8 }}>
        Payment successful
      </h2>
      <p style={{ fontSize: 14, color: 'var(--color-text-3)', marginBottom: 4 }}>
        Invoice #{invoice.invoiceNumber}
      </p>
      <p style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-text)', marginBottom: 24 }}>
        {formatCurrency(invoice.total)}
      </p>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
        {invoice.pdfUrl && (
          <a
            href={invoice.pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '10px 18px', borderRadius: 8,
              background: 'var(--color-brand)', color: '#fff',
              textDecoration: 'none', fontSize: 14, fontWeight: 500,
            }}
          >
            ↓ Download receipt
          </a>
        )}
        <Link
          to="/portal/invoices"
          style={{
            display: 'inline-flex', alignItems: 'center',
            padding: '10px 18px', borderRadius: 8,
            border: '1px solid var(--color-border)', color: 'var(--color-text)',
            textDecoration: 'none', fontSize: 14, fontWeight: 500,
          }}
        >
          Back to invoices
        </Link>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

type PayTab = 'saved' | 'new'

export default function PayInvoicePage() {
  const { invoiceId } = useParams<{ invoiceId: string }>()
  const navigate      = useNavigate()
  const { user }      = useAuth()
  const customerId    = user?.companyId ?? user?.customerId

  const [invoice, setInvoice]           = useState<Invoice | null>(null)
  const [invoiceLoading, setInvoiceLoading] = useState(true)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [error, setError]               = useState<string | null>(null)
  const [tab, setTab]                   = useState<PayTab>('saved')
  const [paid, setPaid]                 = useState(false)

  const { methods, defaultMethod } = usePaymentMethods(customerId)

  // ── Load invoice + subscribe for status changes ───────────────────────────
  useEffect(() => {
    if (!invoiceId) return
    const unsub = subscribeToInvoice(invoiceId, (inv) => {
      if (!inv) { setInvoiceLoading(false); return }
      setInvoice(inv)
      setInvoiceLoading(false)
      if (inv.status === 'paid') setPaid(true)
    })
    return unsub
  }, [invoiceId])

  // ── Init PaymentIntent ────────────────────────────────────────────────────
  useEffect(() => {
    if (!invoiceId || !invoice || invoice.status === 'paid') return

    // Use cached secret if available
    if (invoice.stripeClientSecret) return

    const fn = httpsCallable<{ invoiceId: string }, { clientSecret: string }>(
      functions, 'createStripePaymentIntent',
    )
    fn({ invoiceId })
      .then(r => setClientSecret(r.data.clientSecret))
      .catch(e => setError(e instanceof Error ? e.message : 'Could not initialise payment.'))
  }, [invoiceId, invoice])

  function handleConfirmed() { /* status update comes via Firestore subscription */ }
  function handleError(msg: string) { setError(msg) }

  const activeClientSecret = invoice?.stripeClientSecret ?? clientSecret

  // ── Guards ────────────────────────────────────────────────────────────────
  if (invoiceLoading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-3)' }}>Loading…</div>
  }
  if (!invoice) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <p>Invoice not found.</p>
        <Button variant="ghost" size="md" onClick={() => navigate('/portal/invoices')}>Back</Button>
      </div>
    )
  }
  if (paid || invoice.status === 'paid') {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '32px 20px' }}>
        <SuccessScreen invoice={invoice} />
      </div>
    )
  }
  if (invoice.status === 'void') {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-danger)' }}>This invoice has been voided.</div>
  }

  const savedDefault = defaultMethod ?? methods[0]

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: '32px 20px' }}>
      {/* Back */}
      <Link to="/portal/invoices" style={{ fontSize: 13, color: 'var(--color-text-3)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 20 }}>
        ← Invoices
      </Link>

      {/* Invoice summary card */}
      <div style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 10, padding: '20px 24px', marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <h1 style={{ fontSize: 'var(--font-size-18)', fontWeight: 700, color: 'var(--color-text)' }}>
              Invoice #{invoice.invoiceNumber}
            </h1>
            <p style={{ fontSize: 13, color: 'var(--color-text-3)', marginTop: 2 }}>
              Due {formatDate(invoice.dueAt)}
            </p>
          </div>
          {statusBadge(invoice.status)}
        </div>

        {/* Line items */}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
              <th style={{ textAlign: 'left', padding: '6px 0', color: 'var(--color-text-3)', fontWeight: 500 }}>Description</th>
              <th style={{ textAlign: 'right', padding: '6px 0', color: 'var(--color-text-3)', fontWeight: 500 }}>Qty</th>
              <th style={{ textAlign: 'right', padding: '6px 0', color: 'var(--color-text-3)', fontWeight: 500 }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lineItems.map((item, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--color-bg-3)' }}>
                <td style={{ padding: '8px 0', color: 'var(--color-text)' }}>{item.description}</td>
                <td style={{ padding: '8px 0', textAlign: 'right', color: 'var(--color-text-2)' }}>{item.quantity}</td>
                <td style={{ padding: '8px 0', textAlign: 'right', color: 'var(--color-text)' }}>{formatCurrency(item.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end', fontSize: 13 }}>
          <div style={{ display: 'flex', gap: 40 }}>
            <span style={{ color: 'var(--color-text-3)' }}>Subtotal</span>
            <span>{formatCurrency(invoice.subtotal)}</span>
          </div>
          {invoice.tax > 0 && (
            <div style={{ display: 'flex', gap: 40 }}>
              <span style={{ color: 'var(--color-text-3)' }}>Tax</span>
              <span>{formatCurrency(invoice.tax)}</span>
            </div>
          )}
          <div style={{ display: 'flex', gap: 40, fontWeight: 700, fontSize: 16, borderTop: '1px solid var(--color-border)', paddingTop: 8, marginTop: 4 }}>
            <span>Total</span>
            <span style={{ color: 'var(--color-brand)' }}>{formatCurrency(invoice.total)}</span>
          </div>
        </div>
      </div>

      {/* Payment section */}
      {activeClientSecret ? (
        <StripeProvider clientSecret={activeClientSecret}>
          <div style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 10, padding: '20px 24px' }}>
            <h2 style={{ fontSize: 'var(--font-size-16)', fontWeight: 600, marginBottom: 20, color: 'var(--color-text)' }}>
              Pay {formatCurrency(invoice.total)}
            </h2>

            {/* Tabs — only show if there are saved methods */}
            {methods.length > 0 && (
              <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--color-border)' }}>
                {(['saved', 'new'] as PayTab[]).map(t => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    style={{
                      flex: 1, padding: '9px 0', fontSize: 13, fontWeight: 500, cursor: 'pointer',
                      background: tab === t ? 'var(--color-brand)' : 'var(--color-bg)',
                      color: tab === t ? '#fff' : 'var(--color-text-2)',
                      border: 'none',
                      transition: 'background 0.15s',
                    }}
                  >
                    {t === 'saved' ? 'Saved method' : 'New card / bank'}
                  </button>
                ))}
              </div>
            )}

            {/* Error */}
            {error && (
              <div role="alert" style={{ marginBottom: 16, padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 13, color: 'var(--color-danger)' }}>
                {error}
                <button onClick={() => setError(null)} style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 600 }}>×</button>
              </div>
            )}

            {tab === 'saved' && savedDefault ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <SavedPaymentMethod method={savedDefault} />
                <SavedMethodPay
                  clientSecret={activeClientSecret}
                  stripePaymentMethodId={savedDefault.stripePaymentMethodId}
                  label={`${savedDefault.brand ?? savedDefault.type} ···· ${savedDefault.last4}`}
                  onSuccess={handleConfirmed}
                  onError={handleError}
                />
                {methods.length > 1 && (
                  <button onClick={() => setTab('new')} style={{ fontSize: 13, color: 'var(--color-brand)', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'center' }}>
                    Use a different payment method
                  </button>
                )}
              </div>
            ) : (
              <NewMethodForm invoiceId={invoice.id} onSuccess={handleConfirmed} onError={handleError} />
            )}
          </div>
        </StripeProvider>
      ) : (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-3)', fontSize: 14 }}>
          Preparing payment…
        </div>
      )}
    </div>
  )
}
