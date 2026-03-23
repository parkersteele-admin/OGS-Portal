/**
 * src/components/onboarding/CreditApplicationForm.tsx
 *
 * Net-30 credit application — collected during onboarding Step 4.
 * Writes to creditApplications/{companyId} with status: 'pending_review'.
 */

import React, { useState } from 'react'
import { saveCreditApplication } from '../../services/onboardingService'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import type { CreditApplication, LegalEntity, CreditOfficer, TradeReference, BankReference } from '../../types/company'

interface Props {
  companyId: string
  onComplete: () => void
}

const emptyOfficer = (): CreditOfficer => ({ name: '', position: '', address: '' })
const emptyTradeRef = (): TradeReference => ({
  firm: '', address: '', contact: '', phone: '', email: '',
})

export const CreditApplicationForm: React.FC<Props> = ({ companyId, onComplete }) => {
  const [legalEntity, setLegalEntity] = useState<LegalEntity>('corporation')
  const [yearsInBusiness, setYearsInBusiness] = useState('')
  const [federalTaxId, setFederalTaxId] = useState('')
  const [officers, setOfficers] = useState<CreditOfficer[]>([emptyOfficer()])
  const [tradeRefs, setTradeRefs] = useState<TradeReference[]>([
    emptyTradeRef(), emptyTradeRef(), emptyTradeRef(),
  ])
  const [bankRef, setBankRef] = useState<BankReference>({
    bank: '', accountNumber: '', contact: '', phone: '',
  })
  const [signedBy, setSignedBy] = useState('')
  const [signedAt, setSignedAt] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  const validate = (): boolean => {
    const errs: Record<string, string> = {}
    if (!yearsInBusiness.trim()) errs.yearsInBusiness = 'Required'
    if (!federalTaxId.trim()) errs.federalTaxId = 'Required'
    if (!signedBy.trim()) errs.signedBy = 'Signature required'
    if (!signedAt.trim()) errs.signedAt = 'Date required'
    if (!bankRef.bank.trim()) errs.bankBank = 'Required'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSubmit = async () => {
    if (!validate()) return
    setSubmitting(true)
    try {
      const data: Omit<CreditApplication, 'status'> = {
        companyId,
        legalEntity,
        yearsInBusiness: Number(yearsInBusiness),
        federalTaxId,
        officers: officers.filter((o) => o.name.trim()),
        tradeRefs: tradeRefs.filter((r) => r.firm.trim()),
        bankRef,
        signedBy,
        signedAt: new Date(signedAt) as unknown as import('firebase/firestore').Timestamp,
      }
      await saveCreditApplication(data)
      onComplete()
    } catch {
      setErrors({ _form: 'Submission failed. Please try again.' })
    } finally {
      setSubmitting(false)
    }
  }

  const updateOfficer = (i: number, patch: Partial<CreditOfficer>) =>
    setOfficers((prev) => prev.map((o, idx) => (idx === i ? { ...o, ...patch } : o)))

  const updateTradeRef = (i: number, patch: Partial<TradeReference>) =>
    setTradeRefs((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))

  return (
    <div className="credit-app">
      <h3 className="ob-step__sub-heading">Net 30 Credit Application</h3>
      {errors._form && <p className="ob-step__err" role="alert">{errors._form}</p>}

      <div className="ui-field">
        <label className="ui-field__label">Legal Entity</label>
        <select
          className="ui-input"
          value={legalEntity}
          onChange={(e) => setLegalEntity(e.target.value as LegalEntity)}
        >
          <option value="individual">Individual</option>
          <option value="partnership">Partnership</option>
          <option value="corporation">Corporation</option>
        </select>
      </div>

      <div className="ob-step__row">
        <Input
          label="Years in Business"
          type="number"
          min="0"
          value={yearsInBusiness}
          onChange={(e) => setYearsInBusiness(e.target.value)}
          error={errors.yearsInBusiness}
          required
        />
        <Input
          label="SS or Federal Tax ID Number"
          value={federalTaxId}
          onChange={(e) => setFederalTaxId(e.target.value)}
          error={errors.federalTaxId}
          required
        />
      </div>

      {/* Officers */}
      <fieldset className="ob-step__fieldset">
        <legend className="ob-step__legend">Officers / Owners (up to 3)</legend>
        {officers.map((officer, i) => (
          <div key={i} className="credit-app__officer-row">
            <Input
              label={`Name ${i + 1}`}
              value={officer.name}
              onChange={(e) => updateOfficer(i, { name: e.target.value })}
            />
            <Input
              label="Position"
              value={officer.position}
              onChange={(e) => updateOfficer(i, { position: e.target.value })}
            />
            <Input
              label="Address"
              value={officer.address}
              onChange={(e) => updateOfficer(i, { address: e.target.value })}
            />
          </div>
        ))}
        {officers.length < 3 && (
          <button
            type="button"
            className="ob-step__add-location-btn"
            onClick={() => setOfficers((prev) => [...prev, emptyOfficer()])}
          >
            + Add Officer
          </button>
        )}
      </fieldset>

      {/* Trade References */}
      <fieldset className="ob-step__fieldset">
        <legend className="ob-step__legend">Trade References (3 required)</legend>
        {tradeRefs.map((ref, i) => (
          <div key={i} className="credit-app__trade-ref">
            <p className="credit-app__ref-label">Reference {i + 1}</p>
            <div className="ob-step__row">
              <Input
                label="Firm Name"
                value={ref.firm}
                onChange={(e) => updateTradeRef(i, { firm: e.target.value })}
              />
              <Input
                label="Contact Person"
                value={ref.contact}
                onChange={(e) => updateTradeRef(i, { contact: e.target.value })}
              />
            </div>
            <Input
              label="Address"
              value={ref.address}
              onChange={(e) => updateTradeRef(i, { address: e.target.value })}
            />
            <div className="ob-step__row">
              <Input
                label="Phone"
                type="tel"
                value={ref.phone}
                onChange={(e) => updateTradeRef(i, { phone: e.target.value })}
              />
              <Input
                label="Email"
                type="email"
                value={ref.email}
                onChange={(e) => updateTradeRef(i, { email: e.target.value })}
              />
            </div>
          </div>
        ))}
      </fieldset>

      {/* Bank Reference */}
      <fieldset className="ob-step__fieldset">
        <legend className="ob-step__legend">Bank Reference</legend>
        <div className="ob-step__row">
          <Input
            label="Bank Name"
            value={bankRef.bank}
            onChange={(e) => setBankRef((prev) => ({ ...prev, bank: e.target.value }))}
            error={errors.bankBank}
            required
          />
          <Input
            label="Account Number"
            value={bankRef.accountNumber}
            onChange={(e) =>
              setBankRef((prev) => ({ ...prev, accountNumber: e.target.value }))
            }
          />
        </div>
        <div className="ob-step__row">
          <Input
            label="Contact Person"
            value={bankRef.contact}
            onChange={(e) => setBankRef((prev) => ({ ...prev, contact: e.target.value }))}
          />
          <Input
            label="Phone"
            type="tel"
            value={bankRef.phone}
            onChange={(e) => setBankRef((prev) => ({ ...prev, phone: e.target.value }))}
          />
        </div>
      </fieldset>

      {/* Signature */}
      <Input
        label="Typed Signature"
        value={signedBy}
        onChange={(e) => setSignedBy(e.target.value)}
        error={errors.signedBy}
        placeholder="Type your full legal name"
        required
      />
      <Input
        label="Date"
        type="date"
        value={signedAt}
        onChange={(e) => setSignedAt(e.target.value)}
        error={errors.signedAt}
        required
      />

      <Button
        variant="primary"
        onClick={() => void handleSubmit()}
        loading={submitting}
      >
        Submit Credit Application
      </Button>
    </div>
  )
}
