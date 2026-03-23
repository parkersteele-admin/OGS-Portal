/**
 * src/pages/ops/CustomerList.tsx
 *
 * Ops view of all customers in the onboarding pipeline.
 * Shows setup progress, status badges, filters.
 */

import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  query,
  orderBy,
  where,
  onSnapshot,
  type QueryConstraint,
} from 'firebase/firestore'
import { companiesCol } from '../../lib/firestore'
import { Badge } from '../../components/ui/Badge'
import type { Company, CompanyStatus, BusinessType } from '../../types/company'
import './CustomerList.css'

const STATUS_OPTIONS: { value: CompanyStatus | ''; label: string }[] = [
  { value: '', label: 'All Statuses' },
  { value: 'pending_verification', label: 'Pending Verification' },
  { value: 'pending_quote', label: 'Pending Quote' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
]

const BUSINESS_TYPES: { value: BusinessType | ''; label: string }[] = [
  { value: '', label: 'All Types' },
  { value: 'restaurant', label: 'Restaurant' },
  { value: 'brewery', label: 'Brewery' },
  { value: 'medical_dental', label: 'Medical / Dental' },
  { value: 'fabricator', label: 'Fabricator' },
  { value: 'other', label: 'Other' },
]

type BadgeVariant = 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'neutral'

function statusVariant(status: CompanyStatus): BadgeVariant {
  const map: Record<CompanyStatus, BadgeVariant> = {
    pending_verification: 'warning',
    pending_quote: 'info',
    active: 'success',
    suspended: 'danger',
    merged: 'neutral',
  }
  return map[status] ?? 'neutral'
}

const SetupStepBadge: React.FC<{ step: number; complete: boolean }> = ({
  step,
  complete,
}) => {
  if (complete) {
    return <span className="ops-setup-badge ops-setup-badge--done">✓ Complete</span>
  }
  if (step === 0) {
    return <span className="ops-setup-badge ops-setup-badge--none">Not started</span>
  }
  return (
    <span className="ops-setup-badge ops-setup-badge--in-progress">
      Step {step} of 5
      <span className="ops-setup-bar">
        <span
          className="ops-setup-bar__fill"
          style={{ width: `${(step / 5) * 100}%` }}
        />
      </span>
    </span>
  )
}

const CustomerListPage: React.FC = () => {
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [statusFilter, setStatusFilter] = useState<CompanyStatus | ''>('')
  const [typeFilter, setTypeFilter] = useState<BusinessType | ''>('')
  const [stepFilter, setStepFilter] = useState<number | ''>('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    const constraints: QueryConstraint[] = [orderBy('createdAt', 'desc')]
    if (statusFilter) constraints.push(where('status', '==', statusFilter))
    if (typeFilter) constraints.push(where('businessType', '==', typeFilter))
    if (stepFilter !== '') constraints.push(where('setupStep', '==', stepFilter))

    const unsubscribe = onSnapshot(
      query(companiesCol, ...constraints),
      (snap) => {
        setCompanies(
          snap.docs.map(
            (d) => ({ companyId: d.id, ...(d.data() as unknown as Omit<Company, 'companyId'>) }),
          ),
        )
        setLoading(false)
      },
    )
    return unsubscribe
  }, [statusFilter, typeFilter, stepFilter])

  const filtered = companies.filter((c) => {
    if (!search.trim()) return true
    const term = search.toLowerCase()
    return (
      c.companyName.toLowerCase().includes(term) ||
      c.billingContactName?.toLowerCase().includes(term) ||
      c.billingEmail?.toLowerCase().includes(term)
    )
  })

  return (
    <div className="ops-cust-list">
      <div className="ops-cust-list__header">
        <h1 className="ops-cust-list__heading">Customers</h1>
        <span className="ops-cust-list__count">{filtered.length} total</span>
      </div>

      {/* Filters */}
      <div className="ops-cust-list__filters">
        <input
          className="ui-input ops-cust-list__search"
          type="search"
          placeholder="Search company, contact, email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="ui-input"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as CompanyStatus | '')}
        >
          {STATUS_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select
          className="ui-input"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as BusinessType | '')}
        >
          {BUSINESS_TYPES.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select
          className="ui-input"
          value={stepFilter}
          onChange={(e) =>
            setStepFilter(e.target.value === '' ? '' : Number(e.target.value))
          }
        >
          <option value="">All Steps</option>
          {[0, 1, 2, 3, 4, 5].map((s) => (
            <option key={s} value={s}>
              {s === 0 ? 'Not started' : s === 5 ? 'Complete' : `Step ${s}`}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="layout-loading"><span className="layout-loading__spinner" /></div>
      ) : filtered.length === 0 ? (
        <p className="ops-cust-list__empty">No customers found.</p>
      ) : (
        <div className="ops-cust-list__table">
          <div className="ops-cust-list__table-head">
            <span>Company</span>
            <span>Primary Contact</span>
            <span>Type</span>
            <span>Setup</span>
            <span>Status</span>
            <span>Payment</span>
            <span>Created</span>
          </div>
          {filtered.map((c) => (
            <Link
              key={c.companyId}
              to={`/ops/customers/${c.companyId}`}
              className="ops-cust-list__table-row"
            >
              <span className="ops-cust-list__company">
                {c.companyName}
                {c.tdddRequired && !c.tdddUploaded && (
                  <span
                    className="ops-cust-list__tddd-flag"
                    title="TDDD verification required"
                  >
                    ⚠ TDDD
                  </span>
                )}
              </span>
              <span>{c.billingContactName || '—'}</span>
              <span>{c.businessType ?? '—'}</span>
              <span>
                <SetupStepBadge step={c.setupStep} complete={c.setupComplete} />
              </span>
              <span>
                <Badge variant={statusVariant(c.status)}>
                  {c.status.replace(/_/g, ' ')}
                </Badge>
              </span>
              <span>{c.paymentMethod?.toUpperCase() ?? '—'}</span>
              <span>
                {c.createdAt?.toDate().toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

export default CustomerListPage
