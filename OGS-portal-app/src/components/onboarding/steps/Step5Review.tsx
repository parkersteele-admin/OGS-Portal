/**
 * src/components/onboarding/steps/Step5Review.tsx
 *
 * Onboarding Step 5 — Review & Submit.
 * Read-only summary of all prior steps; each section has an Edit link.
 * Primary CTA submits the account and redirects to the dashboard.
 */

import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { updateDoc, doc, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../../lib/firebase'
import { quoteRequestsCol } from '../../../lib/firestore'
import { Button } from '../../ui/Button'
import type { Company, DeliveryLocation } from '../../../types/company'

interface Props {
  company: Company
  locations: DeliveryLocation[]
  onEditStep: (step: number) => void
}

export const Step5Review: React.FC<Props> = ({ company, locations, onEditStep }) => {
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      // 1. Mark setup complete + move to pending_quote
      await updateDoc(doc(db, 'customers', company.companyId), {
        setupComplete: true,
        status: 'pending_quote',
        setupStep: 5,
      })

      // 2. Create quote request snapshot
      await addDoc(quoteRequestsCol, {
        companyId: company.companyId,
        usageProfile: company.usageProfile,
        locations,
        status: 'pending',
        createdAt: serverTimestamp(),
      })

      // 3. Redirect to dashboard (Cloud Functions handles email notifications)
      navigate('/portal/dashboard', { replace: true })
    } catch {
      setError('Submission failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleFinishLater = () => {
    navigate('/portal/dashboard', { replace: true })
  }

  const addrStr = (addr: Company['billingAddress']) =>
    addr ? `${addr.street}, ${addr.city}, ${addr.state} ${addr.zip}` : '—'

  return (
    <div className="ob-step">
      <h2 className="ob-step__heading">Review &amp; Submit</h2>
      <p className="ob-step__sub">
        Please review your information below. You can go back to edit any section.
      </p>
      {error && <p className="ob-step__err" role="alert">{error}</p>}

      {/* Business Info */}
      <div className="ob-review__card">
        <div className="ob-review__card-header">
          <h3 className="ob-review__card-title">Business Information</h3>
          <button
            type="button"
            className="ob-review__edit-link"
            onClick={() => onEditStep(1)}
          >
            Edit
          </button>
        </div>
        <dl className="ob-review__dl">
          <dt>Company</dt><dd>{company.companyName}</dd>
          <dt>Billing Address</dt><dd>{addrStr(company.billingAddress)}</dd>
          <dt>Billing Contact</dt><dd>{company.billingContactName || '—'}</dd>
          <dt>Phone</dt><dd>{company.phone || '—'}</dd>
          <dt>Business Type</dt><dd>{company.businessType ?? '—'}</dd>
          {company.taxExempt && (
            <>
              <dt>Tax Exempt #</dt><dd>{company.taxExemptNumber || '—'}</dd>
            </>
          )}
          {company.tdddRequired && (
            <>
              <dt>TDDD Status</dt>
              <dd>{company.tdddUploaded ? '✓ Uploaded' : '⚠ Pending upload'}</dd>
            </>
          )}
        </dl>
      </div>

      {/* Delivery Locations */}
      <div className="ob-review__card">
        <div className="ob-review__card-header">
          <h3 className="ob-review__card-title">Delivery Locations</h3>
          <button
            type="button"
            className="ob-review__edit-link"
            onClick={() => onEditStep(2)}
          >
            Edit
          </button>
        </div>
        {locations.length === 0 ? (
          <p className="ob-review__empty">No locations added.</p>
        ) : (
          <ul className="ob-review__location-list">
            {locations.map((loc) => (
              <li key={loc.id} className="ob-review__location-item">
                <strong>{loc.nickname}</strong>
                <span>{addrStr(loc.address)}</span>
                {loc.contactName && (
                  <span>Contact: {loc.contactName} {loc.contactPhone}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Gas Usage */}
      <div className="ob-review__card">
        <div className="ob-review__card-header">
          <h3 className="ob-review__card-title">Gas Usage</h3>
          <button
            type="button"
            className="ob-review__edit-link"
            onClick={() => onEditStep(3)}
          >
            Edit
          </button>
        </div>
        {company.usageProfile.length === 0 ? (
          <p className="ob-review__empty">No gas products selected.</p>
        ) : (
          <ul className="ob-review__usage-list">
            {company.usageProfile.map((entry, i) => (
              <li key={i}>
                <strong>{entry.category}</strong>
                {entry.cylinderSize && ` — ${entry.cylinderSize}`}
                {entry.monthlyEst && ` · ${entry.monthlyEst}`}
                {entry.ownership && ` · ${entry.ownership}`}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Payment & Notifications */}
      <div className="ob-review__card">
        <div className="ob-review__card-header">
          <h3 className="ob-review__card-title">Payment &amp; Notifications</h3>
          <button
            type="button"
            className="ob-review__edit-link"
            onClick={() => onEditStep(4)}
          >
            Edit
          </button>
        </div>
        <dl className="ob-review__dl">
          <dt>Payment Method</dt>
          <dd>{company.paymentMethod?.toUpperCase() ?? 'Not selected'}</dd>
          <dt>Billing Email</dt><dd>{company.billingEmail}</dd>
          <dt>SMS Notifications</dt>
          <dd>
            {company.smsOptIn
              ? `✓ Enabled (${company.smsPhone})`
              : 'Disabled'}
          </dd>
        </dl>
      </div>

      {/* CTAs */}
      <div className="ob-step__actions ob-step__actions--review">
        <Button
          variant="primary"
          size="lg"
          onClick={() => void handleSubmit()}
          loading={submitting}
          className="ob-step__submit-cta"
        >
          Submit &amp; Request a Quote
        </Button>
        <button
          type="button"
          className="ob-review__finish-later"
          onClick={handleFinishLater}
        >
          I'll finish this later
        </button>
      </div>
    </div>
  )
}
