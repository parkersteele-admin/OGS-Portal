/**
 * src/pages/ops/CustomerDetail.tsx
 *
 * Ops admin view of a single customer's onboarding data.
 * Tabs: Profile | Team | Locations | Usage | Payment | Quotes | Documents
 */

import React, { useState, useEffect } from 'react'
import { useParams, Navigate } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { functions, storage } from '../../lib/firebase'
import { ref, getDownloadURL } from 'firebase/storage'
import {
  getCompany,
  getLocations,
  getCreditApplication,
  subscribeToTeam,
} from '../../services/onboardingService'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../../components/ui/Button'
import './CustomerDetail.css'
import { Input } from '../../components/ui/Input'
import { Badge } from '../../components/ui/Badge'
import { updateCompany } from '../../services/onboardingService'
import type {
  Company,
  DeliveryLocation,
  CreditApplication,
  OnboardingUser,
  CustomerRole,
  CompanyStatus,
} from '../../types/company'

type Tab = 'profile' | 'team' | 'locations' | 'usage' | 'payment' | 'quotes' | 'documents'

const ROLES: { value: CustomerRole; label: string }[] = [
  { value: 'owner', label: 'Owner' },
  { value: 'manager', label: 'Manager' },
  { value: 'billing', label: 'Billing' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'viewer', label: 'Viewer' },
]

const CustomerDetailPage: React.FC = () => {
  const { companyId } = useParams<{ companyId: string }>()
  const { role } = useAuth()

  const [tab, setTab] = useState<Tab>('profile')
  const [company, setCompany] = useState<Company | null>(null)
  const [locations, setLocations] = useState<DeliveryLocation[]>([])
  const [team, setTeam] = useState<OnboardingUser[]>([])
  const [creditApp, setCreditApp] = useState<CreditApplication | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Add / assign user
  const [addUserEmail, setAddUserEmail] = useState('')
  const [addUserRole, setAddUserRole] = useState<CustomerRole>('viewer')
  const [addingUser, setAddingUser] = useState(false)
  const [addUserError, setAddUserError] = useState<string | null>(null)

  // Status edit
  const [saving, setSaving] = useState(false)

  if (!companyId) return <Navigate to="/ops/customers" replace />

  // Permission guard
  if (role !== 'admin' && role !== 'dispatch') {
    return <Navigate to="/ops/dashboard" replace />
  }

  useEffect(() => {
    const promises = [
      getCompany(companyId).then(setCompany),
      getLocations(companyId).then(setLocations),
      getCreditApplication(companyId).then(setCreditApp),
    ]
    Promise.all(promises)
      .catch(() => setError('Failed to load customer data.'))
      .finally(() => setLoading(false))

    const unsub = subscribeToTeam(companyId, setTeam)
    return unsub
  }, [companyId])

  const handleStatusChange = async (status: CompanyStatus) => {
    if (!company) return
    setSaving(true)
    try {
      await updateCompany(companyId, { status })
      setCompany((prev) => (prev ? { ...prev, status } : prev))
    } catch {
      setError('Failed to update status.')
    } finally {
      setSaving(false)
    }
  }

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setAddingUser(true)
    setAddUserError(null)
    try {
      const fn = httpsCallable<
        { email: string; companyId: string; role: CustomerRole },
        { created: boolean; uid: string }
      >(functions, 'adminAssignUser')
      await fn({ email: addUserEmail, companyId, role: addUserRole })
      setAddUserEmail('')
      setAddUserRole('viewer')
    } catch (err) {
      setAddUserError(err instanceof Error ? err.message : 'Failed.')
    } finally {
      setAddingUser(false)
    }
  }

  const handleRemoveUser = async (uid: string) => {
    if (!confirm('Remove this user from the company?')) return
    try {
      const fn = httpsCallable<{ uid: string }, void>(functions, 'revokeCompanyClaim')
      await fn({ uid })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove user.')
    }
  }

  const [tdddUrl, setTdddUrl] = useState<string | null>(null)
  const [taxCertUrl, setTaxCertUrl] = useState<string | null>(null)

  useEffect(() => {
    if (tab !== 'documents') return
    const loadUrls = async () => {
      try {
        const tdddRef = ref(storage, `customers/${companyId}/tddd_license`)
        setTdddUrl(await getDownloadURL(tdddRef))
      } catch {
        // Not uploaded
      }
      try {
        const certRef = ref(storage, `customers/${companyId}/tax_exempt_cert`)
        setTaxCertUrl(await getDownloadURL(certRef))
      } catch {
        // Not uploaded
      }
    }
    void loadUrls()
  }, [tab, companyId])

  if (loading) {
    return <div className="layout-loading"><span className="layout-loading__spinner" /></div>
  }

  if (error) {
    return <p className="ob-step__err">{error}</p>
  }

  if (!company) {
    return <Navigate to="/ops/customers" replace />
  }

  const addrStr = (addr: Company['billingAddress']) =>
    addr ? `${addr.street}, ${addr.city}, ${addr.state} ${addr.zip}` : '—'

  const TABS: { key: Tab; label: string }[] = [
    { key: 'profile', label: 'Profile' },
    { key: 'team', label: 'Team' },
    { key: 'locations', label: 'Locations' },
    { key: 'usage', label: 'Usage Profile' },
    { key: 'payment', label: 'Payment' },
    { key: 'quotes', label: 'Quotes' },
    { key: 'documents', label: 'Documents' },
  ]

  return (
    <div className="ops-cust-detail">
      <div className="ops-cust-detail__header">
        <div>
          <h1 className="ops-cust-detail__heading">{company.companyName}</h1>
          <p className="ops-cust-detail__sub">{company.billingEmail}</p>
        </div>
        <div className="ops-cust-detail__status-row">
          <select
            className="ui-input"
            value={company.status}
            onChange={(e) => void handleStatusChange(e.target.value as CompanyStatus)}
            disabled={saving}
          >
            {(['pending_verification', 'pending_quote', 'active', 'suspended'] as CompanyStatus[]).map(
              (s) => (
                <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
              ),
            )}
          </select>
          {company.tdddRequired && !company.tdddUploaded && (
            <Badge variant="warning">⚠ TDDD Pending</Badge>
          )}
        </div>
      </div>

      {/* Tabs */}
      <nav className="ops-cust-detail__tabs">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className={`ops-cust-detail__tab${tab === key ? ' ops-cust-detail__tab--on' : ''}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="ops-cust-detail__body">
        {/* ── Profile ──────────────────────────────────────────────────── */}
        {tab === 'profile' && (
          <div className="ob-review__dl ob-review__dl--wide">
            <dt>Company ID</dt><dd style={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}>{company.companyId}</dd>
            <dt>Company Name</dt><dd>{company.companyName}</dd>
            <dt>Business Type</dt><dd>{company.businessType ?? '—'}</dd>
            <dt>Billing Address</dt><dd>{addrStr(company.billingAddress)}</dd>
            <dt>Billing Contact</dt><dd>{company.billingContactName}</dd>
            <dt>Phone</dt><dd>{company.phone}</dd>
            <dt>Billing Email</dt><dd>{company.billingEmail}</dd>
            <dt>Setup Step</dt><dd>{company.setupStep} of 5{company.setupComplete ? ' (complete)' : ''}</dd>
            <dt>Tax Exempt</dt><dd>{company.taxExempt ? `Yes — ${company.taxExemptNumber ?? ''}` : 'No'}</dd>
            <dt>TDDD Required</dt><dd>{company.tdddRequired ? (company.tdddUploaded ? '✓ Uploaded' : '⚠ Not yet uploaded') : 'N/A'}</dd>
            <dt>SMS Opt-In</dt><dd>{company.smsOptIn ? `Yes (${company.smsPhone})` : 'No'}</dd>
            <dt>Created</dt>
            <dd>
              {company.createdAt?.toDate().toLocaleDateString('en-US', {
                year: 'numeric', month: 'short', day: 'numeric',
              })}
            </dd>
          </div>
        )}

        {/* ── Team ─────────────────────────────────────────────────────── */}
        {tab === 'team' && (
          <div>
            {/* Add user form (admin only) */}
            {role === 'admin' && (
              <form
                className="ops-cust-detail__add-user"
                onSubmit={(e) => void handleAddUser(e)}
              >
                <h3 className="ob-step__sub-heading">Add / Assign User</h3>
                <div className="ob-step__row">
                  <Input
                    label="Email"
                    type="email"
                    value={addUserEmail}
                    onChange={(e) => setAddUserEmail(e.target.value)}
                    required
                  />
                  <div className="ui-field">
                    <label className="ui-field__label">Role</label>
                    <select
                      className="ui-input"
                      value={addUserRole}
                      onChange={(e) => setAddUserRole(e.target.value as CustomerRole)}
                    >
                      {ROLES.map(({ value, label }) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {addUserError && (
                  <p className="ob-step__err" role="alert">{addUserError}</p>
                )}
                <Button type="submit" variant="primary" size="sm" loading={addingUser}>
                  Assign User
                </Button>
              </form>
            )}

            <div className="team-settings__table" style={{ marginTop: '1.5rem' }}>
              <div className="team-settings__table-head">
                <span>Name</span>
                <span>Email</span>
                <span>Role</span>
                <span>Status</span>
                <span />
              </div>
              {team.map((u) => {
                const name = [u.firstName, u.lastName].filter(Boolean).join(' ')
                return (
                  <div key={u.uid} className="team-settings__table-row">
                    <span>{name}</span>
                    <span>{u.email}</span>
                    <span className="team-settings__role-badge">{u.role}</span>
                    <span>{u.status}</span>
                    <span>
                      {!u.isPrimary && (
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => void handleRemoveUser(u.uid)}
                        >
                          Remove
                        </Button>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Locations ────────────────────────────────────────────────── */}
        {tab === 'locations' && (
          <div>
            {locations.length === 0 ? (
              <p className="ob-review__empty">No delivery locations on file.</p>
            ) : (
              locations.map((loc) => (
                <div key={loc.id} className="ob-step__location-card">
                  <strong>{loc.nickname}</strong>
                  <span>{`${loc.address.street}, ${loc.address.city}, ${loc.address.state} ${loc.address.zip}`}</span>
                  <span>Contact: {loc.contactName} · {loc.contactPhone}</span>
                  {loc.preferredDays.length > 0 && (
                    <span>Preferred: {loc.preferredDays.join(', ')}</span>
                  )}
                  {loc.accessNotes && <span>Notes: {loc.accessNotes}</span>}
                  <span>Storage: {loc.cylinderStorage}</span>
                  {loc.currentProvider && <span>Provider: {loc.currentProvider}</span>}
                </div>
              ))
            )}
          </div>
        )}

        {/* ── Usage Profile ─────────────────────────────────────────────── */}
        {tab === 'usage' && (
          <div>
            {company.usageProfile.length === 0 ? (
              <p className="ob-review__empty">No usage profile on file.</p>
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
        )}

        {/* ── Payment ──────────────────────────────────────────────────── */}
        {tab === 'payment' && (
          <div>
            <dl className="ob-review__dl">
              <dt>Payment Method</dt>
              <dd>{company.paymentMethod?.toUpperCase() ?? 'Not set'}</dd>
              <dt>Billing Email</dt>
              <dd>{company.billingEmail}</dd>
            </dl>
            {creditApp && (
              <div style={{ marginTop: '1.5rem' }}>
                <h3 className="ob-step__sub-heading">Credit Application</h3>
                <dl className="ob-review__dl">
                  <dt>Status</dt>
                  <dd>
                    <Badge
                      variant={
                        creditApp.status === 'approved'
                          ? 'success'
                          : creditApp.status === 'denied'
                          ? 'danger'
                          : 'warning'
                      }
                    >
                      {creditApp.status.replace(/_/g, ' ')}
                    </Badge>
                  </dd>
                  <dt>Legal Entity</dt><dd>{creditApp.legalEntity}</dd>
                  <dt>Years in Business</dt><dd>{creditApp.yearsInBusiness}</dd>
                  <dt>Federal Tax ID</dt><dd>{creditApp.federalTaxId}</dd>
                  <dt>Signed By</dt><dd>{creditApp.signedBy}</dd>
                </dl>
              </div>
            )}
          </div>
        )}

        {/* ── Quotes ───────────────────────────────────────────────────── */}
        {tab === 'quotes' && (
          <p className="ob-review__empty">Quote history loaded from quoteRequests collection.</p>
        )}

        {/* ── Documents ────────────────────────────────────────────────── */}
        {tab === 'documents' && (
          <div className="ops-cust-detail__docs">
            <h3 className="ob-step__sub-heading">Uploaded Documents</h3>
            <ul>
              <li>
                <strong>TDDD License: </strong>
                {tdddUrl ? (
                  <a href={tdddUrl} target="_blank" rel="noopener noreferrer">
                    View / Download
                  </a>
                ) : (
                  <span className="ob-review__empty">Not uploaded</span>
                )}
              </li>
              <li>
                <strong>Tax Exempt Certificate: </strong>
                {taxCertUrl ? (
                  <a href={taxCertUrl} target="_blank" rel="noopener noreferrer">
                    View / Download
                  </a>
                ) : (
                  <span className="ob-review__empty">Not uploaded</span>
                )}
              </li>
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

export default CustomerDetailPage
