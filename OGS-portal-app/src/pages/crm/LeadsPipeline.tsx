/**
 * src/pages/crm/LeadsPipeline.tsx
 *
 * CRM Leads pipeline page — Kanban + list view.
 * Route: /crm/leads
 *
 * Kanban stages: New Lead → Contacted → Qualified → Quote Sent → Won → Lost
 * HTML5 drag-and-drop for stage moves.
 * Slide-in detail panel with activity log and convert-to-customer flow.
 */

import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
} from 'react'
import { useNavigate } from 'react-router-dom'
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import {
  collection,
  query as fsQuery,
  where,
  orderBy as fsOrderBy,
  getDocs,
  addDoc,
  serverTimestamp,
  type Timestamp,
} from 'firebase/firestore'
import { db } from '../../lib/firebase'
import {
  subscribeToLeads,
  createLead,
  updateLead,
  convertLeadToCustomer,
  type CreateLeadInput,
} from '../../services/leadService'
import { getUsersByRole } from '../../services/userService'
import { useAuth } from '../../hooks/useAuth'
import { formatCurrency, formatDate, formatRelative } from '../../utils/format'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Input } from '../../components/ui/Input'
import type { Lead, LeadStatus, ContactMethod, ContactLog } from '../../types/crm'
import type { AppUser } from '../../types/user'
import './LeadsPipeline.css'

// ── Constants ─────────────────────────────────────────────────────────────────

interface StageConfig {
  key:   LeadStatus
  label: string
  color: 'neutral' | 'info' | 'brand' | 'warning' | 'success' | 'danger'
  hex:   string
}

const STAGES: StageConfig[] = [
  { key: 'new',       label: 'New Lead',   color: 'neutral', hex: '#6b7280' },
  { key: 'contacted', label: 'Contacted',  color: 'info',    hex: '#3b82f6' },
  { key: 'qualified', label: 'Qualified',  color: 'brand',   hex: '#7c3aed' },
  { key: 'proposal',  label: 'Quote Sent', color: 'warning', hex: '#f59e0b' },
  { key: 'won',       label: 'Won',        color: 'success', hex: '#16a34a' },
  { key: 'lost',      label: 'Lost',       color: 'danger',  hex: '#dc2626' },
]

const STAGE_MAP = Object.fromEntries(STAGES.map(s => [s.key, s])) as Record<LeadStatus, StageConfig>

const SOURCES = [
  'Referral',
  'Website',
  'Cold call',
  'Trade show',
  'LinkedIn',
  'Google',
  'Direct mail',
  'Other',
]

const METHOD_LABELS: Record<ContactMethod, string> = {
  call:       'Phone call',
  email:      'Email',
  text:       'Text',
  'in-person':'In person',
  other:      'Note',
}
const METHOD_ICONS: Record<ContactMethod, string> = {
  call:       '📞',
  email:      '✉️',
  text:       '💬',
  'in-person':'🤝',
  other:      '📝',
}

// ── Sort helpers ──────────────────────────────────────────────────────────────

type SortCol = 'company' | 'name' | 'status' | 'source' | 'estimatedValue' | 'updatedAt' | 'createdAt'

function tsMs(v: Timestamp | undefined): number {
  return v ? v.toMillis() : 0
}

function sortLeads(leads: Lead[], col: SortCol, dir: 'asc' | 'desc'): Lead[] {
  return [...leads].sort((a, b) => {
    let cmp = 0
    if (col === 'estimatedValue') {
      cmp = (a.estimatedValue ?? 0) - (b.estimatedValue ?? 0)
    } else if (col === 'updatedAt') {
      cmp = tsMs(a.updatedAt) - tsMs(b.updatedAt)
    } else if (col === 'createdAt') {
      cmp = tsMs(a.createdAt) - tsMs(b.createdAt)
    } else if (col === 'status') {
      const ia = STAGES.findIndex(s => s.key === a.status)
      const ib = STAGES.findIndex(s => s.key === b.status)
      cmp = ia - ib
    } else {
      const va = (a[col] ?? '') as string
      const vb = (b[col] ?? '') as string
      cmp = va.localeCompare(vb)
    }
    return dir === 'asc' ? cmp : -cmp
  })
}

// ── AddLeadModal ──────────────────────────────────────────────────────────────

interface AddLeadModalProps {
  salesReps: AppUser[]
  onClose:   () => void
  onSave:    (input: CreateLeadInput) => Promise<void>
  saving:    boolean
}

const AddLeadModal: React.FC<AddLeadModalProps> = ({ salesReps, onClose, onSave, saving }) => {
  const { user } = useAuth()
  const [form, setForm] = useState<CreateLeadInput>({
    name:           '',
    company:        '',
    email:          '',
    phone:          '',
    address:        '',
    city:           '',
    state:          '',
    zip:            '',
    source:         '',
    assignedTo:     user?.id ?? '',
    estimatedValue: undefined,
    notes:          '',
  })

  const set = (field: keyof CreateLeadInput) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(prev => ({
        ...prev,
        [field]: field === 'estimatedValue'
          ? (e.target.value === '' ? undefined : Number(e.target.value))
          : e.target.value,
      }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await onSave({ ...form, name: form.name.trim(), email: form.email.trim() })
  }

  return (
    <Modal open onClose={onClose} title="Add new lead" size="md">
      <form className="lp-modal-form" onSubmit={handleSubmit}>
        <div className="lp-form-row">
          <Input label="Contact name" value={form.name}    onChange={set('name')}    required />
          <Input label="Company"      value={form.company} onChange={set('company')} />
        </div>
        <div className="lp-form-row">
          <Input label="Email" type="email" value={form.email} onChange={set('email')} required />
          <Input label="Phone" type="tel"   value={form.phone} onChange={set('phone')} />
        </div>
        <div className="lp-form-row">
          <Input label="Address" value={form.address ?? ''} onChange={set('address')} />
          <Input label="City"    value={form.city    ?? ''} onChange={set('city')}    />
        </div>
        <div className="lp-form-row">
          <Input label="State"   value={form.state   ?? ''} onChange={set('state')}   />
          <Input label="ZIP"     value={form.zip     ?? ''} onChange={set('zip')}     />
        </div>
        <div className="lp-form-row">
          <div className="ui-field">
            <label className="ui-field__label">Source</label>
            <select className="ui-input" value={form.source} onChange={set('source')}>
              <option value="">— Select source —</option>
              {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <Input
            label="Estimated value ($)"
            type="number"
            min="0"
            step="100"
            value={form.estimatedValue ?? ''}
            onChange={set('estimatedValue')}
          />
        </div>
        <div className="ui-field">
          <label className="ui-field__label">Assign to</label>
          <select className="ui-input" value={form.assignedTo} onChange={set('assignedTo')}>
            <option value="">— Unassigned —</option>
            {salesReps.map(rep => (
              <option key={rep.id} value={rep.id}>{rep.name}</option>
            ))}
          </select>
        </div>
        <div className="ui-field">
          <label className="ui-field__label">Notes (optional)</label>
          <textarea
            className="ui-input lp-textarea"
            rows={3}
            value={form.notes}
            onChange={set('notes')}
            placeholder="Initial notes about this lead…"
          />
        </div>
        <div className="lp-modal-actions">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving}>Add lead</Button>
        </div>
      </form>
    </Modal>
  )
}

// ── ConvertModal ──────────────────────────────────────────────────────────────

interface ConvertModalProps {
  lead:      Lead
  onClose:   () => void
  onConfirm: () => Promise<void>
  saving:    boolean
}

const ConvertModal: React.FC<ConvertModalProps> = ({ lead, onClose, onConfirm, saving }) => (
  <Modal open onClose={onClose} title="Convert to customer" size="sm">
    <div className="lp-modal-form">
      <p className="lp-convert-body">
        This will create a new customer account for{' '}
        <strong>{lead.company ?? lead.name}</strong> and archive this lead as Won.
      </p>
      <div className="lp-convert-preview">
        <span>{lead.email}</span>
        {lead.phone && <span>{lead.phone}</span>}
        {lead.address && (
          <span>{[lead.address, lead.city, lead.state].filter(Boolean).join(', ')}</span>
        )}
      </div>
      <div className="lp-modal-actions">
        <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button type="button" variant="success" loading={saving} onClick={onConfirm}>
          ✓ Convert &amp; create customer
        </Button>
      </div>
    </div>
  </Modal>
)

// ── ActivitySection ───────────────────────────────────────────────────────────

const ActivitySection: React.FC<{ leadId: string }> = ({ leadId }) => {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const [showForm, setShowForm] = useState(false)
  const [method, setMethod]     = useState<ContactMethod>('call')
  const [summary, setSummary]   = useState('')
  const [saving,  setSaving]    = useState(false)

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['contactLogs', 'lead', leadId],
    queryFn: async () => {
      const snap = await getDocs(
        fsQuery(
          collection(db, 'contactLogs'),
          where('entityType', '==', 'lead'),
          where('entityId',   '==', leadId),
          fsOrderBy('contactedAt', 'desc'),
        ),
      )
      return snap.docs.map(d => ({ id: d.id, ...d.data() }) as ContactLog)
    },
    enabled: !!leadId,
    staleTime: 60_000,
  })

  const handleLog = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!summary.trim()) return
    setSaving(true)
    try {
      await addDoc(collection(db, 'contactLogs'), {
        entityType:  'lead',
        entityId:    leadId,
        method,
        summary:     summary.trim(),
        loggedBy:    user!.id,
        contactedAt: serverTimestamp(),
        createdAt:   serverTimestamp(),
      })
      queryClient.invalidateQueries({ queryKey: ['contactLogs', 'lead', leadId] })
      setSummary('')
      setShowForm(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="lp-activity">
      <div className="lp-activity__header">
        <span className="lp-activity__title">Activity</span>
        <button className="lp-link" onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Cancel' : '+ Log'}
        </button>
      </div>

      {showForm && (
        <form className="lp-activity__form" onSubmit={handleLog}>
          <div className="lp-form-row">
            <select className="ui-input" value={method} onChange={e => setMethod(e.target.value as ContactMethod)}>
              {(Object.keys(METHOD_LABELS) as ContactMethod[]).map(m => (
                <option key={m} value={m}>{METHOD_LABELS[m]}</option>
              ))}
            </select>
          </div>
          <textarea
            className="ui-input lp-textarea"
            rows={2}
            value={summary}
            onChange={e => setSummary(e.target.value)}
            placeholder="What happened?"
            required
          />
          <Button type="submit" variant="primary" size="sm" loading={saving}>Save</Button>
        </form>
      )}

      {isLoading ? (
        <div className="lp-activity__loading">Loading…</div>
      ) : logs.length === 0 ? (
        <p className="lp-empty">No activity logged yet.</p>
      ) : (
        <div className="lp-activity__log">
          {logs.map(log => (
            <div key={log.id} className="lp-activity__entry">
              <span className="lp-activity__icon">{METHOD_ICONS[log.method]}</span>
              <div className="lp-activity__body">
                <span className="lp-activity__meta">
                  {METHOD_LABELS[log.method]} · {formatRelative(log.contactedAt)}
                </span>
                <p className="lp-activity__summary">{log.summary}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── DetailPanel ───────────────────────────────────────────────────────────────

interface DetailPanelProps {
  lead:      Lead
  salesReps: AppUser[]
  onClose:   () => void
  onMoveTo:  (status: LeadStatus) => void
  onConvert: () => void
  navigate:  ReturnType<typeof useNavigate>
}

const DetailPanel: React.FC<DetailPanelProps> = ({
  lead, salesReps, onClose, onMoveTo, onConvert, navigate,
}) => {
  const [notes,     setNotes]     = useState(lead.notes ?? '')
  const [estValue,  setEstValue]  = useState(String(lead.estimatedValue ?? ''))
  const [assigned,  setAssigned]  = useState(lead.assignedTo ?? '')
  const [source,    setSource]    = useState(lead.source ?? '')
  const [address,   setAddress]   = useState(lead.address ?? '')
  const [city,      setCity]      = useState(lead.city    ?? '')
  const [stateVal,  setStateVal]  = useState(lead.state   ?? '')
  const [zip,       setZip]       = useState(lead.zip     ?? '')
  const [saved,     setSaved]     = useState(false)
  const [saving,    setSaving]    = useState(false)

  // Sync when selected lead changes
  useEffect(() => {
    setNotes(lead.notes ?? '')
    setEstValue(String(lead.estimatedValue ?? ''))
    setAssigned(lead.assignedTo ?? '')
    setSource(lead.source ?? '')
    setAddress(lead.address ?? '')
    setCity(lead.city    ?? '')
    setStateVal(lead.state   ?? '')
    setZip(lead.zip     ?? '')
  }, [lead.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateLead(lead.id, {
        notes:          notes.trim(),
        estimatedValue: estValue ? Number(estValue) : undefined,
        assignedTo:     assigned || undefined,
        source:         source || undefined,
        address:        address.trim() || undefined,
        city:           city.trim()    || undefined,
        state:          stateVal.trim() || undefined,
        zip:            zip.trim()     || undefined,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  const stageConfig = STAGE_MAP[lead.status]
  const repName = salesReps.find(r => r.id === lead.assignedTo)?.name

  return (
    <aside className="lp-panel" aria-label="Lead detail">
      {/* Header */}
      <div className="lp-panel__header">
        <div className="lp-panel__title-row">
          <div>
            <h2 className="lp-panel__name">{lead.company ?? lead.name}</h2>
            {lead.company && <p className="lp-panel__subname">{lead.name}</p>}
          </div>
          <button className="lp-panel__close" onClick={onClose} aria-label="Close panel">✕</button>
        </div>
        <div className="lp-panel__stage-row">
          <select
            className={`lp-stage-select lp-stage-select--${lead.status}`}
            value={lead.status}
            onChange={e => onMoveTo(e.target.value as LeadStatus)}
          >
            {STAGES.map(s => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
          <Badge variant={stageConfig.color}>{stageConfig.label}</Badge>
        </div>
      </div>

      {/* Body */}
      <div className="lp-panel__body">

        {/* Contact info */}
        <section className="lp-panel__section">
          <h4 className="lp-panel__section-title">Contact</h4>
          <div className="lp-panel__info-grid">
            <span className="lp-panel__info-label">Email</span>
            <a href={`mailto:${lead.email}`} className="lp-panel__info-value lp-link">{lead.email}</a>
            {lead.phone && (
              <>
                <span className="lp-panel__info-label">Phone</span>
                <a href={`tel:${lead.phone}`} className="lp-panel__info-value lp-link">{lead.phone}</a>
              </>
            )}
            {(lead.address || lead.city) && (
              <>
                <span className="lp-panel__info-label">Address</span>
                <span className="lp-panel__info-value">
                  {lead.address && <>{lead.address}<br /></>}
                  {[lead.city, lead.state, lead.zip].filter(Boolean).join(', ')}
                </span>
              </>
            )}
            {lead.source && (
              <>
                <span className="lp-panel__info-label">Source</span>
                <span className="lp-panel__info-value">{lead.source}</span>
              </>
            )}
            {repName && (
              <>
                <span className="lp-panel__info-label">Assigned</span>
                <span className="lp-panel__info-value">{repName}</span>
              </>
            )}
            {lead.estimatedValue !== undefined && (
              <>
                <span className="lp-panel__info-label">Est. value</span>
                <span className="lp-panel__info-value lp-panel__info-value--strong">
                  {formatCurrency(lead.estimatedValue)}
                </span>
              </>
            )}
            <span className="lp-panel__info-label">Added</span>
            <span className="lp-panel__info-value">{formatDate(lead.createdAt)}</span>
          </div>
        </section>

        {/* Editable fields */}
        <section className="lp-panel__section">
          <h4 className="lp-panel__section-title">Details</h4>
          <div className="lp-panel__fields">
            <Input label="Address" value={address} onChange={e => setAddress(e.target.value)} />
            <div className="lp-form-row">
              <Input label="City"  value={city}     onChange={e => setCity(e.target.value)}     />
              <Input label="State" value={stateVal} onChange={e => setStateVal(e.target.value)} />
              <Input label="ZIP"   value={zip}      onChange={e => setZip(e.target.value)}      />
            </div>
            <div className="ui-field">
              <label className="ui-field__label">Source</label>
              <select className="ui-input" value={source} onChange={e => setSource(e.target.value)}>
                <option value="">— Select —</option>
                {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <Input
              label="Estimated value ($)"
              type="number"
              min="0"
              step="100"
              value={estValue}
              onChange={e => setEstValue(e.target.value)}
            />
            <div className="ui-field">
              <label className="ui-field__label">Assign to</label>
              <select className="ui-input" value={assigned} onChange={e => setAssigned(e.target.value)}>
                <option value="">— Unassigned —</option>
                {salesReps.map(rep => (
                  <option key={rep.id} value={rep.id}>{rep.name}</option>
                ))}
              </select>
            </div>
            <div className="ui-field">
              <label className="ui-field__label">Notes</label>
              <textarea
                className="ui-input lp-textarea"
                rows={4}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Products of interest, background info…"
              />
            </div>
            <div className="lp-panel__save-row">
              {saved && <span className="lp-saved">✓ Saved</span>}
              <Button variant="secondary" size="sm" loading={saving} onClick={handleSave}>
                Save changes
              </Button>
            </div>
          </div>
        </section>

        {/* Activity log */}
        <section className="lp-panel__section">
          <ActivitySection leadId={lead.id} />
        </section>

      </div>

      {/* Footer actions */}
      <div className="lp-panel__footer">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(`/crm/quotes?new=1&leadId=${lead.id}`)}
        >
          📋 Send quote
        </Button>

        {lead.status === 'won' && lead.convertedToCustomerId ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/crm/customers/${lead.convertedToCustomerId}`)}
          >
            → View customer
          </Button>
        ) : (
          <Button
            variant={lead.status === 'won' ? 'success' : 'secondary'}
            size="sm"
            onClick={onConvert}
          >
            ✓ Convert to customer
          </Button>
        )}
      </div>
    </aside>
  )
}

// ── LeadCard ──────────────────────────────────────────────────────────────────

interface LeadCardProps {
  lead:      Lead
  salesReps: AppUser[]
  isSelected: boolean
  onSelect:  (lead: Lead) => void
  onMoveTo:  (leadId: string, status: LeadStatus) => void
  onQuote:   (lead: Lead) => void
}

const LeadCard: React.FC<LeadCardProps> = ({
  lead, salesReps, isSelected, onSelect, onMoveTo, onQuote,
}) => {
  const rep = salesReps.find(r => r.id === lead.assignedTo)

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', lead.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <div
      className={`lp-card${isSelected ? ' lp-card--selected' : ''}`}
      draggable
      onDragStart={handleDragStart}
      onClick={() => onSelect(lead)}
      role="button"
      tabIndex={0}
      aria-label={`Lead: ${lead.company ?? lead.name}`}
      onKeyDown={e => e.key === 'Enter' && onSelect(lead)}
    >
      <div className="lp-card__top">
        <span className="lp-card__company">{lead.company ?? lead.name}</span>
        {lead.estimatedValue !== undefined && (
          <span className="lp-card__value">{formatCurrency(lead.estimatedValue)}</span>
        )}
      </div>

      {lead.company && (
        <p className="lp-card__contact">{lead.name}</p>
      )}

      <div className="lp-card__meta">
        {lead.source && <span className="lp-card__tag">{lead.source}</span>}
        {rep && <span className="lp-card__tag lp-card__tag--rep">{rep.name}</span>}
      </div>

      {lead.updatedAt && (
        <p className="lp-card__activity">{formatRelative(lead.updatedAt)}</p>
      )}

      {/* Stage dropdown */}
      <div className="lp-card__footer" onClick={e => e.stopPropagation()}>
        <select
          className="lp-card__stage-select"
          value={lead.status}
          onChange={e => onMoveTo(lead.id, e.target.value as LeadStatus)}
        >
          {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <button
          className="lp-card__quote-btn"
          title="Send quote"
          onClick={e => { e.stopPropagation(); onQuote(lead) }}
        >
          📋
        </button>
      </div>
    </div>
  )
}

// ── KanbanColumn ──────────────────────────────────────────────────────────────

interface KanbanColumnProps {
  stage:      StageConfig
  leads:      Lead[]
  salesReps:  AppUser[]
  isDragOver: boolean
  selectedId: string | null
  onDragOver: (e: React.DragEvent) => void
  onDrop:     (e: React.DragEvent) => void
  onDragLeave:() => void
  onSelect:   (lead: Lead) => void
  onMoveTo:   (leadId: string, status: LeadStatus) => void
  onQuote:    (lead: Lead) => void
}

const KanbanColumn: React.FC<KanbanColumnProps> = ({
  stage, leads, salesReps, isDragOver,
  selectedId, onDragOver, onDrop, onDragLeave,
  onSelect, onMoveTo, onQuote,
}) => {
  const totalValue = leads.reduce((s, l) => s + (l.estimatedValue ?? 0), 0)

  return (
    <div
      className={`lp-col${isDragOver ? ' lp-col--drag-over' : ''}`}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragLeave={onDragLeave}
    >
      <div className="lp-col__header" style={{ borderTopColor: stage.hex }}>
        <div className="lp-col__header-top">
          <span className="lp-col__label">{stage.label}</span>
          <span className={`lp-col__count lp-col__count--${stage.color}`}>{leads.length}</span>
        </div>
        {totalValue > 0 && (
          <span className="lp-col__value">{formatCurrency(totalValue)}</span>
        )}
      </div>

      <div className="lp-col__cards">
        {leads.length === 0 ? (
          <div className="lp-col__empty">Drop here</div>
        ) : (
          leads.map(lead => (
            <LeadCard
              key={lead.id}
              lead={lead}
              salesReps={salesReps}
              isSelected={selectedId === lead.id}
              onSelect={onSelect}
              onMoveTo={onMoveTo}
              onQuote={onQuote}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ── ListTable ─────────────────────────────────────────────────────────────────

interface ListTableProps {
  leads:      Lead[]
  salesReps:  AppUser[]
  sortCol:    SortCol
  sortDir:    'asc' | 'desc'
  selectedId: string | null
  onSort:     (col: SortCol) => void
  onSelect:   (lead: Lead) => void
  onMoveTo:   (leadId: string, status: LeadStatus) => void
  onQuote:    (lead: Lead) => void
}

const ListTable: React.FC<ListTableProps> = ({
  leads, salesReps, sortCol, sortDir, selectedId,
  onSort, onSelect, onMoveTo, onQuote,
}) => {
  const arrow = (col: SortCol) =>
    sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''

  return (
    <div className="lp-list-wrap">
      <table className="lp-table">
        <thead>
          <tr>
            <th onClick={() => onSort('company')}   className="lp-th lp-th--sort">Company{arrow('company')}</th>
            <th onClick={() => onSort('name')}      className="lp-th lp-th--sort">Contact{arrow('name')}</th>
            <th onClick={() => onSort('status')}    className="lp-th lp-th--sort">Stage{arrow('status')}</th>
            <th onClick={() => onSort('source')}    className="lp-th lp-th--sort">Source{arrow('source')}</th>
            <th                                     className="lp-th">Assigned</th>
            <th onClick={() => onSort('estimatedValue')} className="lp-th lp-th--sort lp-th--right">Est. Value{arrow('estimatedValue')}</th>
            <th onClick={() => onSort('updatedAt')} className="lp-th lp-th--sort">Last Activity{arrow('updatedAt')}</th>
            <th                                     className="lp-th">Actions</th>
          </tr>
        </thead>
        <tbody>
          {leads.length === 0 && (
            <tr>
              <td colSpan={8} className="lp-table__empty">No leads match the current filter.</td>
            </tr>
          )}
          {leads.map(lead => {
            const stageConfig = STAGE_MAP[lead.status]
            const rep = salesReps.find(r => r.id === lead.assignedTo)
            return (
              <tr
                key={lead.id}
                className={`lp-tr${selectedId === lead.id ? ' lp-tr--selected' : ''}`}
                onClick={() => onSelect(lead)}
              >
                <td className="lp-td lp-td--bold">{lead.company ?? lead.name}</td>
                <td className="lp-td">{lead.company ? lead.name : '—'}</td>
                <td className="lp-td">
                  <Badge variant={stageConfig.color}>{stageConfig.label}</Badge>
                </td>
                <td className="lp-td">{lead.source ?? '—'}</td>
                <td className="lp-td">{rep?.name ?? '—'}</td>
                <td className="lp-td lp-td--right">
                  {lead.estimatedValue !== undefined ? formatCurrency(lead.estimatedValue) : '—'}
                </td>
                <td className="lp-td">{lead.updatedAt ? formatRelative(lead.updatedAt) : '—'}</td>
                <td className="lp-td lp-td--actions" onClick={e => e.stopPropagation()}>
                  <select
                    className="lp-card__stage-select"
                    value={lead.status}
                    onChange={e => onMoveTo(lead.id, e.target.value as LeadStatus)}
                  >
                    {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                  <button
                    className="lp-card__quote-btn"
                    title="Send quote"
                    onClick={() => onQuote(lead)}
                  >
                    📋
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

const LeadsPipeline: React.FC = () => {
  const navigate     = useNavigate()

  const [view,          setView]          = useState<'kanban' | 'list'>('kanban')
  const [leads,         setLeads]         = useState<Lead[]>([])
  const [leadsLoading,  setLeadsLoading]  = useState(true)
  const [selectedId,    setSelectedId]    = useState<string | null>(null)
  const [showAdd,       setShowAdd]       = useState(false)
  const [showConvert,   setShowConvert]   = useState(false)
  const [dragOverStage, setDragOverStage] = useState<LeadStatus | null>(null)
  const [sortCol,       setSortCol]       = useState<SortCol>('updatedAt')
  const [sortDir,       setSortDir]       = useState<'asc' | 'desc'>('desc')
  const [stageFilter,   setStageFilter]   = useState<LeadStatus | 'all'>('all')

  // Real-time leads subscription
  useEffect(() => {
    const unsub = subscribeToLeads({}, (data) => {
      setLeads(data)
      setLeadsLoading(false)
    })
    return unsub
  }, [])

  // Sales reps query
  const { data: salesReps = [] } = useQuery<AppUser[]>({
    queryKey: ['users', 'sales-and-admin'],
    queryFn:  async () => {
      const [sales, admins] = await Promise.all([
        getUsersByRole('sales'),
        getUsersByRole('admin'),
      ])
      const seen = new Set<string>()
      return [...sales, ...admins].filter(u => {
        if (seen.has(u.id)) return false
        seen.add(u.id)
        return true
      })
    },
    staleTime: 5 * 60_000,
  })

  // Derived: selected lead (always fresh from subscription)
  const selectedLead = useMemo(
    () => (selectedId ? leads.find(l => l.id === selectedId) ?? null : null),
    [leads, selectedId],
  )

  // Derived: filtered + sorted leads
  const filteredLeads = useMemo(() => {
    const base = stageFilter === 'all' ? leads : leads.filter(l => l.status === stageFilter)
    return view === 'list' ? sortLeads(base, sortCol, sortDir) : base
  }, [leads, stageFilter, view, sortCol, sortDir])

  // Leads by stage for Kanban
  const leadsByStage = useMemo(
    () => Object.fromEntries(
      STAGES.map(s => [s.key, filteredLeads.filter(l => l.status === s.key)])
    ) as Record<LeadStatus, Lead[]>,
    [filteredLeads],
  )

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleMoveTo = useCallback(async (leadId: string, status: LeadStatus) => {
    await updateLead(leadId, { status })
    // Subscription will push the update, no manual state needed
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, stage: LeadStatus) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverStage(stage)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent, stage: LeadStatus) => {
    e.preventDefault()
    const leadId = e.dataTransfer.getData('text/plain')
    if (leadId) handleMoveTo(leadId, stage)
    setDragOverStage(null)
  }, [handleMoveTo])

  const handleSort = useCallback((col: SortCol) => {
    setSortDir(prev => sortCol === col && prev === 'desc' ? 'asc' : 'desc')
    setSortCol(col)
  }, [sortCol])

  const handleSelectLead = useCallback((lead: Lead) => {
    setSelectedId(prev => prev === lead.id ? null : lead.id)
  }, [])

  const handleQuoteLead = useCallback((lead: Lead) => {
    navigate(`/crm/quotes?new=1&leadId=${lead.id}`)
  }, [navigate])

  // Add lead mutation
  const addMutation = useMutation({
    mutationFn: createLead,
    onSuccess: () => {
      setShowAdd(false)
      // Subscription handles the update
    },
  })

  // Convert mutation
  const convertMutation = useMutation({
    mutationFn: () => convertLeadToCustomer(selectedId!),
    onSuccess: (customerId) => {
      setShowConvert(false)
      setSelectedId(null)
      navigate(`/crm/customers/${customerId}`)
    },
  })

  // ── Summary metrics ──────────────────────────────────────────────────────────

  const totalPipeline = useMemo(
    () => leads
      .filter(l => l.status !== 'lost' && l.status !== 'won')
      .reduce((s, l) => s + (l.estimatedValue ?? 0), 0),
    [leads],
  )
  const wonValue = useMemo(
    () => leads.filter(l => l.status === 'won').reduce((s, l) => s + (l.estimatedValue ?? 0), 0),
    [leads],
  )

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className={`lp-page${selectedLead ? ' lp-page--panel-open' : ''}`}>

      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <header className="lp-header">
        <div className="lp-header__left">
          <h1 className="lp-header__title">Leads Pipeline</h1>
          <div className="lp-header__metrics">
            <span className="lp-metric">
              <span className="lp-metric__label">Active pipeline</span>
              <span className="lp-metric__value">{formatCurrency(totalPipeline)}</span>
            </span>
            <span className="lp-metric">
              <span className="lp-metric__label">Won</span>
              <span className="lp-metric__value lp-metric__value--won">{formatCurrency(wonValue)}</span>
            </span>
            <span className="lp-metric">
              <span className="lp-metric__label">Total leads</span>
              <span className="lp-metric__value">{leads.length}</span>
            </span>
          </div>
        </div>

        <div className="lp-header__right">
          {/* Stage filter (list view useful, also usable in kanban) */}
          <select
            className="lp-stage-filter"
            value={stageFilter}
            onChange={e => setStageFilter(e.target.value as LeadStatus | 'all')}
          >
            <option value="all">All stages</option>
            {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>

          {/* View toggle */}
          <div className="lp-view-toggle" role="group" aria-label="View mode">
            <button
              className={`lp-view-toggle__btn${view === 'kanban' ? ' lp-view-toggle__btn--active' : ''}`}
              onClick={() => setView('kanban')}
              title="Kanban view"
            >
              ⬛⬛
            </button>
            <button
              className={`lp-view-toggle__btn${view === 'list' ? ' lp-view-toggle__btn--active' : ''}`}
              onClick={() => setView('list')}
              title="List view"
            >
              ≡
            </button>
          </div>

          <Button variant="primary" size="sm" onClick={() => setShowAdd(true)}>
            + Add lead
          </Button>
        </div>
      </header>

      {/* ── Loading state ────────────────────────────────────────────────────── */}
      {leadsLoading && (
        <div className="lp-loading">
          <div className="lp-loading__inner">Loading leads…</div>
        </div>
      )}

      {/* ── Main content ─────────────────────────────────────────────────────── */}
      {!leadsLoading && (
        <div className="lp-content">
          {view === 'kanban' ? (
            <div className="lp-board">
              {STAGES.map(stage => (
                <KanbanColumn
                  key={stage.key}
                  stage={stage}
                  leads={leadsByStage[stage.key]}
                  salesReps={salesReps}
                  isDragOver={dragOverStage === stage.key}
                  selectedId={selectedId}
                  onDragOver={e => handleDragOver(e, stage.key)}
                  onDrop={e => handleDrop(e, stage.key)}
                  onDragLeave={() => setDragOverStage(null)}
                  onSelect={handleSelectLead}
                  onMoveTo={handleMoveTo}
                  onQuote={handleQuoteLead}
                />
              ))}
            </div>
          ) : (
            <ListTable
              leads={filteredLeads}
              salesReps={salesReps}
              sortCol={sortCol}
              sortDir={sortDir}
              selectedId={selectedId}
              onSort={handleSort}
              onSelect={handleSelectLead}
              onMoveTo={handleMoveTo}
              onQuote={handleQuoteLead}
            />
          )}
        </div>
      )}

      {/* ── Detail panel ─────────────────────────────────────────────────────── */}
      {selectedLead && (
        <>
          <div className="lp-panel-backdrop" onClick={() => setSelectedId(null)} />
          <DetailPanel
            lead={selectedLead}
            salesReps={salesReps}
            onClose={() => setSelectedId(null)}
            onMoveTo={status => handleMoveTo(selectedLead.id, status)}
            onConvert={() => setShowConvert(true)}
            navigate={navigate}
          />
        </>
      )}

      {/* ── Modals ───────────────────────────────────────────────────────────── */}
      {showAdd && (
        <AddLeadModal
          salesReps={salesReps}
          onClose={() => setShowAdd(false)}
          onSave={async (input) => { await addMutation.mutateAsync(input) }}
          saving={addMutation.isPending}
        />
      )}

      {showConvert && selectedLead && (
        <ConvertModal
          lead={selectedLead}
          onClose={() => setShowConvert(false)}
          onConfirm={async () => { await convertMutation.mutateAsync() }}
          saving={convertMutation.isPending}
        />
      )}
    </div>
  )
}

export default LeadsPipeline
