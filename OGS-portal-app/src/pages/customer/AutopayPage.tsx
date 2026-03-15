/**
 * src/pages/customer/AutopayPage.tsx
 *
 * Customer portal — Manage Autopay & Payment Methods
 *
 * Flow:
 *  1. Load saved payment methods via usePaymentMethods
 *  2. "Add payment method" button → call createSetupIntent → show Stripe SetupElement
 *  3. On confirmSetup success → call savePaymentMethod → refresh list
 *  4. Set default / Remove via SavedPaymentMethod component
 */

import React, { useState, useCallback } from 'react'
import { useStripe, useElements, PaymentElement } from '@stripe/react-stripe-js'
import { useAuth } from '../../hooks/useAuth'
import { usePaymentMethods } from '../../hooks/usePaymentMethods'
import { StripeProvider } from '../../components/payments/StripeProvider'
import { SavedPaymentMethod } from '../../components/payments/SavedPaymentMethod'
import { Button } from '../../components/ui/Button'
import {
  createSetupIntent,
  savePaymentMethod,
  removePaymentMethod,
} from '../../services/paymentMethodService'

// ── Inner form (must be inside <StripeProvider>) ──────────────────────────────

interface AddFormProps {
  setupIntentId: string
  onSuccess: () => void
  onCancel: () => void
}

function AddPaymentMethodForm({ setupIntentId, onSuccess, onCancel }: AddFormProps) {
  const stripe   = useStripe()
  const elements = useElements()
  const [setAsDefault, setSetAsDefault] = useState(true)
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return
    setError(null)
    setLoading(true)

    const { error: submitErr } = await elements.submit()
    if (submitErr) {
      setError(submitErr.message ?? 'Check your payment details.')
      setLoading(false)
      return
    }

    const { error: confirmErr, setupIntent } = await stripe.confirmSetup({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: 'if_required',
    })

    if (confirmErr) {
      setError(confirmErr.message ?? 'Could not save payment method.')
      setLoading(false)
      return
    }

    try {
      await savePaymentMethod({
        setupIntentId: setupIntent?.id ?? setupIntentId,
        setAsDefault,
      })
      onSuccess()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save payment method.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <PaymentElement options={{ layout: 'tabs', paymentMethodOrder: ['card', 'us_bank_account'] }} />

        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '14px', color: 'var(--color-text)' }}>
          <input
            type="checkbox"
            checked={setAsDefault}
            onChange={e => setSetAsDefault(e.target.checked)}
            style={{ accentColor: 'var(--color-brand)', width: '16px', height: '16px' }}
          />
          Set as default for autopay
        </label>

        {error && (
          <div role="alert" style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', fontSize: '13px', color: 'var(--color-danger)' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <Button type="button" variant="ghost" size="md" onClick={onCancel} disabled={loading}>Cancel</Button>
          <Button type="submit" variant="primary" size="md" loading={loading} disabled={!stripe}>Save payment method</Button>
        </div>
      </div>
    </form>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AutopayPage() {
  const { user } = useAuth()
  const customerId = user?.customerId

  const { methods, loading, error } = usePaymentMethods(customerId)

  const [adding, setAdding]               = useState(false)
  const [clientSecret, setClientSecret]   = useState<string | null>(null)
  const [setupIntentId, setSetupIntentId] = useState<string>('')
  const [actionError, setActionError]     = useState<string | null>(null)
  const [initLoading, setInitLoading]     = useState(false)

  async function handleAddClick() {
    setActionError(null)
    setInitLoading(true)
    try {
      const { clientSecret: cs } = await createSetupIntent()
      // Extract setupIntent ID from the client secret (format: seti_xxx_secret_yyy)
      setSetupIntentId(cs.split('_secret_')[0])
      setClientSecret(cs)
      setAdding(true)
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Could not initialise payment setup.')
    } finally {
      setInitLoading(false)
    }
  }

  const handleSuccess = useCallback(() => {
    setAdding(false)
    setClientSecret(null)
  }, [])

  const handleCancel = useCallback(() => {
    setAdding(false)
    setClientSecret(null)
  }, [])

  async function handleSetDefault(pmId: string) {
    // Find the setup intent id is not available here; we use removePaymentMethod
    // pattern — but setDefault is done by re-saving. For now update via service.
    setActionError(null)
    try {
      // Call the savePaymentMethod function with the existing stripePaymentMethodId
      // by creating a new SetupIntent and updating the Firestore doc directly.
      // Simplest approach: call removePaymentMethod on old default then set new.
      // Because the function handles promoting the next method, we just need to
      // trigger a Firestore update. We'll use a lightweight direct Firestore
      // update since we're only flipping isDefault (no Stripe call needed for default-only).
      const { updateDoc, getDocs, query, where, doc } = await import('firebase/firestore')
      const { db } = await import('../../lib/firebase')

      if (!customerId) return

      // Unset all defaults
      const allMethods = await getDocs(
        query(
          (await import('../../lib/firestore')).paymentMethodsCol(customerId),
          where('isDefault', '==', true),
        ),
      )
      const batch = allMethods.docs.map(d => updateDoc(d.ref, { isDefault: false }))
      await Promise.all(batch)

      // Set the new default
      await updateDoc(doc(db, `customers/${customerId}/paymentMethods/${pmId}`), { isDefault: true })
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to update default.')
    }
  }

  async function handleRemove(pmId: string) {
    setActionError(null)
    try {
      await removePaymentMethod({ paymentMethodId: pmId })
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to remove payment method.')
    }
  }

  return (
    <div style={{ maxWidth: '640px', margin: '0 auto', padding: '32px 20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: 'var(--font-size-20)', fontWeight: 700, color: 'var(--color-text)' }}>
            Payment Methods
          </h1>
          <p style={{ fontSize: 'var(--font-size-13)', color: 'var(--color-text-3)', marginTop: '4px' }}>
            Manage saved cards and bank accounts for autopay.
          </p>
        </div>
        {!adding && (
          <Button variant="primary" size="md" loading={initLoading} onClick={handleAddClick}>
            + Add method
          </Button>
        )}
      </div>

      {/* Global error */}
      {actionError && (
        <div role="alert" style={{ marginBottom: '16px', padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', fontSize: '13px', color: 'var(--color-danger)' }}>
          {actionError}
        </div>
      )}

      {/* Add payment method form */}
      {adding && clientSecret && (
        <div style={{ marginBottom: '24px', padding: '24px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '10px' }}>
          <h2 style={{ fontSize: 'var(--font-size-16)', fontWeight: 600, marginBottom: '20px', color: 'var(--color-text)' }}>
            Add payment method
          </h2>
          <StripeProvider clientSecret={clientSecret}>
            <AddPaymentMethodForm
              setupIntentId={setupIntentId}
              onSuccess={handleSuccess}
              onCancel={handleCancel}
            />
          </StripeProvider>
        </div>
      )}

      {/* Saved methods list */}
      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-3)', fontSize: '14px' }}>
          Loading payment methods…
        </div>
      ) : error ? (
        <div style={{ padding: '20px', color: 'var(--color-danger)', fontSize: '14px' }}>
          Failed to load payment methods.
        </div>
      ) : methods.length === 0 && !adding ? (
        <div style={{ padding: '40px', textAlign: 'center', border: '1px dashed var(--color-border)', borderRadius: '10px', color: 'var(--color-text-3)' }}>
          <p style={{ fontSize: '14px' }}>No payment methods saved yet.</p>
          <p style={{ fontSize: '13px', marginTop: '6px' }}>Add a card or bank account to enable autopay.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {methods.map(pm => (
            <SavedPaymentMethod
              key={pm.id}
              method={pm}
              onSetDefault={handleSetDefault}
              onRemove={handleRemove}
            />
          ))}
        </div>
      )}
    </div>
  )
}
