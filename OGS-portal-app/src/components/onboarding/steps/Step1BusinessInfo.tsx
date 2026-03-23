/**
 * src/components/onboarding/steps/Step1BusinessInfo.tsx
 *
 * Onboarding Step 1 — Business Information.
 * Auto-saves on blur (debounced 800 ms) + writes on Next.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { ref, uploadBytes } from 'firebase/storage'
import { storage } from '../../../lib/firebase'
import { updateCompany, advanceSetupStep } from '../../../services/onboardingService'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import type { Company, OnboardingAddress, BusinessType } from '../../../types/company'

interface Props {
  company: Company
  onNext: () => void
}

type AddressField = keyof OnboardingAddress

const BUSINESS_TYPES: { value: BusinessType; label: string }[] = [
  { value: 'restaurant', label: 'Restaurant' },
  { value: 'brewery', label: 'Brewery' },
  { value: 'medical_dental', label: 'Medical or Dental' },
  { value: 'fabricator', label: 'Fabricator' },
  { value: 'other', label: 'Other' },
]

export const Step1BusinessInfo: React.FC<Props> = ({ company, onNext }) => {
  const companyId = company.companyId

  // Form state — seed from Firestore doc
  const [companyName, setCompanyName] = useState(company.companyName)
  const [billing, setBilling] = useState<OnboardingAddress>(
    company.billingAddress ?? { street: '', city: '', state: '', zip: '' },
  )
  const [sameAsDelivery, setSameAsDelivery] = useState(company.deliveryAddress === null)
  const [delivery, setDelivery] = useState<OnboardingAddress>(
    company.deliveryAddress ?? { street: '', city: '', state: '', zip: '' },
  )
  const [billingContactName, setBillingContactName] = useState(company.billingContactName ?? '')
  const [generalManagerName, setGeneralManagerName] = useState(
    company.generalManagerName ?? '',
  )
  const [phone, setPhone] = useState(company.phone ?? '')
  const [businessType, setBusinessType] = useState<BusinessType | ''>(
    company.businessType ?? '',
  )
  const [taxExempt, setTaxExempt] = useState(company.taxExempt ?? false)
  const [taxExemptNumber, setTaxExemptNumber] = useState(company.taxExemptNumber ?? '')
  const [taxCertFile, setTaxCertFile] = useState<File | null>(null)
  const [tdddFile, setTdddFile] = useState<File | null>(null)
  const [isSolePractitioner, setIsSolePractitioner] = useState(
    company.solePractitionerAttestation != null,
  )
  const [solePracSignature, setSolePracSignature] = useState('')
  const [solePracDate, setSolePracDate] = useState('')

  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Auto-save on change (debounced) ───────────────────────────────────────

  const buildPayload = useCallback((): Partial<Company> => ({
    companyName,
    billingAddress: billing,
    deliveryAddress: sameAsDelivery ? null : delivery,
    billingContactName,
    generalManagerName: generalManagerName || null,
    phone,
    businessType: (businessType as BusinessType) || null,
    taxExempt,
    taxExemptNumber: taxExempt ? taxExemptNumber || null : null,
    ...(businessType === 'medical_dental'
      ? { tdddRequired: true, tdddUploaded: company.tdddUploaded ?? false }
      : {}),
  }), [
    companyName, billing, sameAsDelivery, delivery,
    billingContactName, generalManagerName, phone,
    businessType, taxExempt, taxExemptNumber, company.tdddUploaded,
  ])

  const scheduleAutoSave = useCallback(() => {
    if (saveTimeout.current) clearTimeout(saveTimeout.current)
    saveTimeout.current = setTimeout(async () => {
      setSaving(true)
      try {
        await updateCompany(companyId, buildPayload())
      } catch {
        // Auto-save failure is silent
      } finally {
        setSaving(false)
      }
    }, 800)
  }, [companyId, buildPayload])

  // Cleanup on unmount
  useEffect(
    () => () => { if (saveTimeout.current) clearTimeout(saveTimeout.current) },
    [],
  )

  // ── Upload helpers ────────────────────────────────────────────────────────

  const uploadTaxCert = async () => {
    if (!taxCertFile) return
    const storageRef = ref(storage, `customers/${companyId}/tax_exempt_cert`)
    await uploadBytes(storageRef, taxCertFile)
  }

  const uploadTddd = async () => {
    if (!tdddFile) return
    const storageRef = ref(storage, `customers/${companyId}/tddd_license`)
    await uploadBytes(storageRef, tdddFile)
    await updateCompany(companyId, { tdddUploaded: true })
  }

  // ── Validation ────────────────────────────────────────────────────────────

  const validate = (): boolean => {
    const errs: Record<string, string> = {}
    if (!companyName.trim()) errs.companyName = 'Required'
    if (!billing.street.trim()) errs['billing.street'] = 'Required'
    if (!billing.city.trim()) errs['billing.city'] = 'Required'
    if (!billing.state.trim()) errs['billing.state'] = 'Required'
    if (!billing.zip.trim()) errs['billing.zip'] = 'Required'
    if (!billingContactName.trim()) errs.billingContactName = 'Required'
    if (!phone.trim()) errs.phone = 'Required'
    if (!businessType) errs.businessType = 'Please select a business type.'
    if (taxExempt && !taxExemptNumber.trim()) errs.taxExemptNumber = 'Required'
    if (
      businessType === 'medical_dental' &&
      !isSolePractitioner &&
      !company.tdddUploaded &&
      !tdddFile
    ) {
      errs.tddd = 'Please upload your TDDD license to continue.'
    }
    if (isSolePractitioner) {
      if (!solePracSignature.trim()) errs.solePracSignature = 'Signature required'
      if (!solePracDate.trim()) errs.solePracDate = 'Date required'
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  // ── Next ──────────────────────────────────────────────────────────────────

  const handleNext = async () => {
    if (!validate()) return
    setSubmitting(true)
    try {
      await Promise.all([
        updateCompany(companyId, {
          ...buildPayload(),
          ...(isSolePractitioner && solePracSignature && solePracDate
            ? {
                solePractitionerAttestation: {
                  signedBy: solePracSignature,
                  // Firestore Timestamp will be set by the function but we store the string for now
                  signedAt: new Date(solePracDate) as unknown as import('firebase/firestore').Timestamp,
                },
              }
            : {}),
        }),
        uploadTaxCert(),
        uploadTddd(),
      ])
      await advanceSetupStep(companyId, 1)
      onNext()
    } catch {
      setErrors({ _form: 'Save failed. Please try again.' })
    } finally {
      setSubmitting(false)
    }
  }

  // ── Address helpers ───────────────────────────────────────────────────────

  const setBillingField = (field: AddressField, value: string) =>
    setBilling((prev) => ({ ...prev, [field]: value }))
  const setDeliveryField = (field: AddressField, value: string) =>
    setDelivery((prev) => ({ ...prev, [field]: value }))

  return (
    <div className="ob-step">
      <h2 className="ob-step__heading">Business Information</h2>
      {saving && <span className="ob-step__autosave">Saving…</span>}
      {errors._form && <p className="ob-step__err" role="alert">{errors._form}</p>}

      <div className="ob-step__section">
        <Input
          label="Company Name"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          onBlur={scheduleAutoSave}
          error={errors.companyName}
          required
        />
      </div>

      {/* Billing Address */}
      <fieldset className="ob-step__fieldset">
        <legend className="ob-step__legend">Billing Address</legend>
        <Input
          label="Street"
          value={billing.street}
          onChange={(e) => setBillingField('street', e.target.value)}
          onBlur={scheduleAutoSave}
          error={errors['billing.street']}
          required
        />
        <div className="ob-step__row">
          <Input
            label="City"
            value={billing.city}
            onChange={(e) => setBillingField('city', e.target.value)}
            onBlur={scheduleAutoSave}
            error={errors['billing.city']}
            required
          />
          <Input
            label="State"
            value={billing.state}
            onChange={(e) => setBillingField('state', e.target.value)}
            onBlur={scheduleAutoSave}
            error={errors['billing.state']}
            required
            maxLength={2}
            style={{ maxWidth: '6rem' }}
          />
          <Input
            label="Zip"
            value={billing.zip}
            onChange={(e) => setBillingField('zip', e.target.value)}
            onBlur={scheduleAutoSave}
            error={errors['billing.zip']}
            required
            maxLength={10}
            style={{ maxWidth: '8rem' }}
          />
        </div>
      </fieldset>

      {/* Delivery Address */}
      <fieldset className="ob-step__fieldset">
        <legend className="ob-step__legend">Shipping / Delivery Address</legend>
        <label className="ob-step__check-label">
          <input
            type="checkbox"
            checked={sameAsDelivery}
            onChange={(e) => {
              setSameAsDelivery(e.target.checked)
              scheduleAutoSave()
            }}
          />
          Same as billing address
        </label>
        {!sameAsDelivery && (
          <>
            <Input
              label="Street"
              value={delivery.street}
              onChange={(e) => setDeliveryField('street', e.target.value)}
              onBlur={scheduleAutoSave}
            />
            <div className="ob-step__row">
              <Input
                label="City"
                value={delivery.city}
                onChange={(e) => setDeliveryField('city', e.target.value)}
                onBlur={scheduleAutoSave}
              />
              <Input
                label="State"
                value={delivery.state}
                onChange={(e) => setDeliveryField('state', e.target.value)}
                onBlur={scheduleAutoSave}
                maxLength={2}
                style={{ maxWidth: '6rem' }}
              />
              <Input
                label="Zip"
                value={delivery.zip}
                onChange={(e) => setDeliveryField('zip', e.target.value)}
                onBlur={scheduleAutoSave}
                maxLength={10}
                style={{ maxWidth: '8rem' }}
              />
            </div>
          </>
        )}
      </fieldset>

      {/* Contact info */}
      <div className="ob-step__section">
        <Input
          label="Billing Contact Name"
          value={billingContactName}
          onChange={(e) => setBillingContactName(e.target.value)}
          onBlur={scheduleAutoSave}
          error={errors.billingContactName}
          required
        />
        <Input
          label="General Manager Name (optional)"
          value={generalManagerName}
          onChange={(e) => setGeneralManagerName(e.target.value)}
          onBlur={scheduleAutoSave}
        />
        <Input
          label="Email Address"
          value={company.billingEmail}
          readOnly
          hint="The email used to create your account."
        />
        <Input
          label="Phone Number"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onBlur={scheduleAutoSave}
          error={errors.phone}
          required
        />
      </div>

      {/* Business Type */}
      <div className="ob-step__section">
        <div className="ui-field">
          <label className="ui-field__label">
            Business Type <span aria-hidden="true">*</span>
          </label>
          <select
            className={`ui-input${errors.businessType ? ' ui-input--error' : ''}`}
            value={businessType}
            onChange={(e) => {
              setBusinessType(e.target.value as BusinessType)
              scheduleAutoSave()
            }}
          >
            <option value="">Select…</option>
            {BUSINESS_TYPES.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          {errors.businessType && (
            <span className="ui-field__error" role="alert">{errors.businessType}</span>
          )}
        </div>
      </div>

      {/* Medical/Dental branch */}
      {businessType === 'medical_dental' && (
        <div className="ob-step__notice ob-step__notice--warning">
          <p>
            <strong>TDDD License Required.</strong> A copy of your TDDD (Terminal Distributor
            of Dangerous Drugs) License is required before your account can be activated. You
            will not be permitted to receive medical gases without a valid TDDD on file.
          </p>
          <div className="ui-field">
            <label className="ui-field__label">Upload TDDD License</label>
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={(e) => setTdddFile(e.target.files?.[0] ?? null)}
              className="ob-step__file-input"
            />
            {errors.tddd && (
              <span className="ui-field__error" role="alert">{errors.tddd}</span>
            )}
            {company.tdddUploaded && (
              <span className="ob-step__file-ok">✓ TDDD license uploaded</span>
            )}
          </div>

          {/* Sole Practitioner exemption */}
          <label className="ob-step__check-label ob-step__check-label--mt">
            <input
              type="checkbox"
              checked={isSolePractitioner}
              onChange={(e) => setIsSolePractitioner(e.target.checked)}
            />
            I am a Sole Practitioner dentist (TDDD exemption applies).
          </label>

          {isSolePractitioner && (
            <div className="ob-step__sole-prac">
              <p className="ob-step__disclosure">
                I verify that I operate as a Sole Practitioner and do not fall under the Ohio
                Board of Pharmacy's requirement to hold a TDDD license. I understand that if
                my status changes, I must notify Ohio Gas Supply Co. and deliveries may be
                held until a valid license is obtained.
              </p>
              <Input
                label="Typed Signature"
                value={solePracSignature}
                onChange={(e) => setSolePracSignature(e.target.value)}
                error={errors.solePracSignature}
                placeholder="Type your full legal name"
                required
              />
              <Input
                label="Date"
                type="date"
                value={solePracDate}
                onChange={(e) => setSolePracDate(e.target.value)}
                error={errors.solePracDate}
                required
              />
            </div>
          )}
        </div>
      )}

      {/* Tax Exempt */}
      <fieldset className="ob-step__fieldset">
        <legend className="ob-step__legend">Tax Exemption</legend>
        <label className="ob-step__check-label">
          <input
            type="checkbox"
            checked={taxExempt}
            onChange={(e) => {
              setTaxExempt(e.target.checked)
              scheduleAutoSave()
            }}
          />
          This organization is tax exempt
        </label>
        {taxExempt && (
          <>
            <Input
              label="Tax Exempt Number"
              value={taxExemptNumber}
              onChange={(e) => setTaxExemptNumber(e.target.value)}
              onBlur={scheduleAutoSave}
              error={errors.taxExemptNumber}
              required
            />
            <div className="ui-field">
              <label className="ui-field__label">Upload Tax Exempt Certificate</label>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={(e) => setTaxCertFile(e.target.files?.[0] ?? null)}
                className="ob-step__file-input"
              />
            </div>
          </>
        )}
      </fieldset>

      <div className="ob-step__actions">
        <Button
          variant="primary"
          size="lg"
          onClick={() => void handleNext()}
          loading={submitting}
          className="ob-step__next"
        >
          Next: Delivery Setup
        </Button>
      </div>
    </div>
  )
}
