import { useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getDocs, orderBy, query } from 'firebase/firestore'
import { customersCol } from '../../../lib/firestore'
import {
  createRecurringRunTemplate,
  deleteRecurringRunTemplate,
  getRecurringRunConflicts,
  getTemplateAssignments,
  listRecurringRunTemplates,
  updateRecurringRunTemplate,
} from '../../../services/recurringRunService'
import { getActiveRunAssignableUsers } from '../../../services/userService'
import type { CompanyLocation, Customer } from '../../../types/customer'
import type { AppUser } from '../../../types/user'
import type {
  RecurringRunAssignment,
  RecurringRunFrequency,
  RecurringRunTemplate,
} from '../../../types/recurringRun'
import { Button } from '../../../components/ui/Button'
import './RecurringRunsPage.css'

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

const FREQUENCIES: Array<{ value: RecurringRunFrequency; label: string }> = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every Other Week' },
  { value: 'monthly', label: 'Monthly' },
]

interface RecurringRunForm {
  name: string
  driverId: string
  dayOfWeek: number
  frequency: RecurringRunFrequency
  startDate: string
  notes: string
  isActive: boolean
  customerAssignments: RecurringRunAssignment[]
}

function dateInputFromTimestamp(ts: { toDate(): Date } | undefined): string {
  if (!ts) return ''
  return ts.toDate().toISOString().slice(0, 10)
}

function formatDate(ts: { toDate(): Date } | undefined): string {
  if (!ts) return '-'
  return ts.toDate().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function frequencyLabel(frequency: RecurringRunFrequency): string {
  return FREQUENCIES.find((option) => option.value === frequency)?.label ?? frequency
}

function createEmptyForm(): RecurringRunForm {
  const today = new Date()
  const dayOfWeek = today.getDay()
  return {
    name: '',
    driverId: '',
    dayOfWeek,
    frequency: 'weekly',
    startDate: today.toISOString().slice(0, 10),
    notes: '',
    isActive: true,
    customerAssignments: [],
  }
}

function toForm(template: RecurringRunTemplate): RecurringRunForm {
  return {
    name: template.name,
    driverId: template.driverId ?? '',
    dayOfWeek: template.dayOfWeek,
    frequency: template.frequency,
    startDate: dateInputFromTimestamp(template.startDate),
    notes: template.notes ?? '',
    isActive: template.isActive,
    customerAssignments: getTemplateAssignments(template),
  }
}

function locationLabel(location: CompanyLocation): string {
  const parts = [
    location.name,
    location.shipToAddress.line1,
    location.shipToAddress.city,
    location.shipToAddress.zip,
  ].filter(Boolean)
  return parts.join(' - ')
}

function defaultLocation(customer: Customer): CompanyLocation | null {
  const locations = customer.locations ?? []
  if (locations.length === 0) return null
  if (customer.defaultLocationId) {
    const byDefault = locations.find((loc) => loc.id === customer.defaultLocationId)
    if (byDefault) return byDefault
  }
  return locations[0]
}

export default function RecurringRunsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()

  const opsBase = location.pathname.startsWith('/admin') ? '/admin/ops' : '/ops'

  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState<RecurringRunForm>(createEmptyForm)

  const recurringQuery = useQuery({
    queryKey: ['recurring-runs'],
    queryFn: listRecurringRunTemplates,
    staleTime: 30_000,
  })

  const driversQuery = useQuery({
    queryKey: ['recurring-run-drivers'],
    queryFn: getActiveRunAssignableUsers,
    staleTime: 60_000,
  })

  const customersQuery = useQuery({
    queryKey: ['customers-for-recurring-runs'],
    queryFn: async () => {
      const snap = await getDocs(query(customersCol, orderBy('name')))
      return snap.docs
        .map((docSnap) => ({ ...docSnap.data(), id: docSnap.id }) as Customer)
        .filter((customer) => customer.status === 'active')
    },
    staleTime: 60_000,
  })

  const recurringRuns = recurringQuery.data ?? []
  const drivers = useMemo(
    () => (driversQuery.data ?? []).filter((user: AppUser) => user.role === 'driver' || user.role === 'dispatch' || user.role === 'admin'),
    [driversQuery.data],
  )
  const driverNameMap = useMemo(
    () => new Map(drivers.map((driver) => [driver.id, driver.name])),
    [drivers],
  )
  const customers = customersQuery.data ?? []
  const customerNameMap = useMemo(
    () => new Map(customers.map((customer) => [customer.id, customer.name])),
    [customers],
  )
  const customerMap = useMemo(
    () => new Map(customers.map((customer) => [customer.id, customer])),
    [customers],
  )

  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return customers
    return customers.filter((customer) => {
      const haystack = [
        customer.name,
        customer.address,
        customer.city,
        customer.zip,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [customers, search])

  const selectedTemplate = recurringRuns.find((item) => item.id === editingId) ?? null

  const assignmentKey = useMemo(
    () => form.customerAssignments
      .map((assignment) => `${assignment.customerId}:${assignment.locationId ?? ''}`)
      .sort()
      .join('|'),
    [form.customerAssignments],
  )

  const conflictsQuery = useQuery({
    queryKey: [
      'recurring-run-conflicts',
      editingId ?? 'new',
      form.dayOfWeek,
      form.frequency,
      form.isActive,
      assignmentKey,
    ],
    queryFn: () =>
      getRecurringRunConflicts({
        templateId: editingId ?? undefined,
        templateName: form.name,
        dayOfWeek: form.dayOfWeek,
        frequency: form.frequency,
        isActive: form.isActive,
        customerAssignments: form.customerAssignments,
      }),
    enabled: form.isActive && form.customerAssignments.length > 0,
    staleTime: 5_000,
  })

  const conflicts = conflictsQuery.data ?? []

  function resetForm() {
    setEditingId(null)
    setForm(createEmptyForm())
  }

  function startEdit(template: RecurringRunTemplate) {
    setEditingId(template.id)
    setForm(toForm(template))
  }

  function updateForm<K extends keyof RecurringRunForm>(field: K, value: RecurringRunForm[K]) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function toggleCustomer(customerId: string) {
    setForm((prev) => {
      const exists = prev.customerAssignments.some((assignment) => assignment.customerId === customerId)
      const customer = customerMap.get(customerId)
      const location = customer ? defaultLocation(customer) : null

      return {
        ...prev,
        customerAssignments: exists
          ? prev.customerAssignments.filter((assignment) => assignment.customerId !== customerId)
          : [
              ...prev.customerAssignments,
              {
                customerId,
                ...(location
                  ? {
                      locationId: location.id,
                      locationName: location.name,
                    }
                  : {}),
              },
            ],
      }
    })
  }

  function updateAssignmentLocation(customerId: string, locationId: string) {
    const customer = customerMap.get(customerId)
    const location = (customer?.locations ?? []).find((item) => item.id === locationId)
    setForm((prev) => ({
      ...prev,
      customerAssignments: prev.customerAssignments.map((assignment) =>
        assignment.customerId === customerId
          ? {
              ...assignment,
              locationId: locationId || undefined,
              locationName: location?.name,
            }
          : assignment,
      ),
    }))
  }

  async function handleSave() {
    if (!form.name.trim()) {
      alert('Route name is required.')
      return
    }
    if (!form.startDate) {
      alert('Start date is required.')
      return
    }
    if (form.customerAssignments.length === 0) {
      alert('Assign at least one customer to this recurring route.')
      return
    }
    if (conflicts.length > 0) {
      alert('Resolve recurring route conflicts before saving this template.')
      return
    }

    setSaving(true)
    try {
      const payload = {
        name: form.name,
        driverId: form.driverId || undefined,
        dayOfWeek: form.dayOfWeek,
        frequency: form.frequency,
        startDate: new Date(form.startDate + 'T12:00:00'),
        customerAssignments: form.customerAssignments,
        notes: form.notes,
        isActive: form.isActive,
      }

      if (editingId) {
        await updateRecurringRunTemplate(editingId, payload)
      } else {
        await createRecurringRunTemplate(payload)
      }

      await queryClient.invalidateQueries({ queryKey: ['recurring-runs'] })
      resetForm()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save recurring route.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this recurring route?')) return
    try {
      await deleteRecurringRunTemplate(id)
      await queryClient.invalidateQueries({ queryKey: ['recurring-runs'] })
      if (editingId === id) resetForm()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete recurring route.')
    }
  }

  return (
    <div className="rr-page">
      <div className="rr-header">
        <div>
          <button className="rr-back" onClick={() => navigate(`${opsBase}/runs`)}>
            {'<- Runs'}
          </button>
          <h1 className="rr-title">Recurring Routes</h1>
          <p className="rr-subtitle">Create separate recurring run templates by weekday and frequency.</p>
        </div>
        <div className="rr-header__actions">
          <Button variant="secondary" onClick={resetForm} disabled={saving}>
            New Template
          </Button>
          <Button variant="primary" onClick={handleSave} loading={saving}>
            {editingId ? 'Save Changes' : 'Create Template'}
          </Button>
        </div>
      </div>

      <div className="rr-editor-grid">
        <section className="rr-card">
          <h2 className="rr-card__title">Template Details</h2>

          <div className="rr-field">
            <label htmlFor="rr-name">Route name</label>
            <input
              id="rr-name"
              className="rr-input"
              type="text"
              value={form.name}
              onChange={(event) => updateForm('name', event.target.value)}
              placeholder="North Columbus Wed A"
              maxLength={120}
            />
          </div>

          <div className="rr-field-row">
            <div className="rr-field">
              <label htmlFor="rr-day">Day of week</label>
              <select
                id="rr-day"
                className="rr-input"
                value={form.dayOfWeek}
                onChange={(event) => updateForm('dayOfWeek', Number(event.target.value))}
              >
                {WEEKDAYS.map((day, index) => (
                  <option key={day} value={index}>{day}</option>
                ))}
              </select>
            </div>

            <div className="rr-field">
              <label htmlFor="rr-frequency">Frequency</label>
              <select
                id="rr-frequency"
                className="rr-input"
                value={form.frequency}
                onChange={(event) => updateForm('frequency', event.target.value as RecurringRunFrequency)}
              >
                {FREQUENCIES.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="rr-field-row">
            <div className="rr-field">
              <label htmlFor="rr-driver">Default driver (optional)</label>
              <select
                id="rr-driver"
                className="rr-input"
                value={form.driverId}
                onChange={(event) => updateForm('driverId', event.target.value)}
                disabled={driversQuery.isPending}
              >
                <option value="">Unassigned</option>
                {drivers.map((driver) => (
                  <option key={driver.id} value={driver.id}>{driver.name} ({driver.role})</option>
                ))}
              </select>
            </div>

            <div className="rr-field">
              <label htmlFor="rr-start-date">Start date</label>
              <input
                id="rr-start-date"
                className="rr-input"
                type="date"
                value={form.startDate}
                onChange={(event) => updateForm('startDate', event.target.value)}
              />
            </div>

            <div className="rr-field rr-field--checkbox">
              <label htmlFor="rr-active">Active template</label>
              <input
                id="rr-active"
                type="checkbox"
                checked={form.isActive}
                onChange={(event) => updateForm('isActive', event.target.checked)}
              />
            </div>
          </div>

          <div className="rr-field">
            <label htmlFor="rr-notes">Notes</label>
            <textarea
              id="rr-notes"
              className="rr-input rr-input--textarea"
              value={form.notes}
              onChange={(event) => updateForm('notes', event.target.value)}
              placeholder="Optional dispatch notes"
              maxLength={500}
            />
          </div>
        </section>

        <section className="rr-card">
          <div className="rr-card__head-row">
            <h2 className="rr-card__title">Assign Customers</h2>
            <span className="rr-count">{form.customerAssignments.length} selected</span>
          </div>
          <input
            type="search"
            className="rr-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search customers"
          />

          {customersQuery.isPending ? (
            <p className="rr-empty">Loading customers...</p>
          ) : filteredCustomers.length === 0 ? (
            <p className="rr-empty">No customers match the current search.</p>
          ) : (
            <div className="rr-customer-list">
              {filteredCustomers.map((customer) => (
                <div key={customer.id} className="rr-customer-row">
                  <label className="rr-customer-row__selector">
                    <input
                      type="checkbox"
                      checked={form.customerAssignments.some((assignment) => assignment.customerId === customer.id)}
                      onChange={() => toggleCustomer(customer.id)}
                    />
                    <div className="rr-customer-row__text">
                      <span>{customer.name}</span>
                      <small>{[customer.address, customer.city, customer.zip].filter(Boolean).join(', ')}</small>
                    </div>
                  </label>

                  {form.customerAssignments.some((assignment) => assignment.customerId === customer.id) && (
                    <div className="rr-customer-row__location">
                      <label htmlFor={`rr-location-${customer.id}`}>Location</label>
                      <select
                        id={`rr-location-${customer.id}`}
                        className="rr-input"
                        value={
                          form.customerAssignments.find((assignment) => assignment.customerId === customer.id)
                            ?.locationId ?? ''
                        }
                        onChange={(event) => updateAssignmentLocation(customer.id, event.target.value)}
                      >
                        <option value="">Main Customer Address</option>
                        {(customer.locations ?? []).map((location) => (
                          <option key={location.id} value={location.id}>{locationLabel(location)}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {conflicts.length > 0 && (
            <div className="rr-conflicts" role="alert">
              <strong>Conflicts detected:</strong>
              <ul>
                {conflicts.map((conflict) => {
                  const customerName = customerNameMap.get(conflict.customerId) ?? conflict.customerId
                  return (
                    <li key={conflict.customerId}>
                      {customerName} is already assigned to {conflict.conflictingTemplateNames.join(', ')} for {WEEKDAYS[conflict.dayOfWeek]} ({frequencyLabel(conflict.frequency)}).
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </section>
      </div>

      <section className="rr-card">
        <h2 className="rr-card__title">Saved Recurring Routes</h2>
        {recurringQuery.isError ? (
          <p className="rr-empty rr-empty--error">Failed to load recurring routes.</p>
        ) : recurringQuery.isPending ? (
          <p className="rr-empty">Loading recurring routes...</p>
        ) : recurringRuns.length === 0 ? (
          <p className="rr-empty">No recurring routes yet. Create one above.</p>
        ) : (
          <div className="rr-table-wrap">
            <table className="rr-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Schedule</th>
                  <th>Start</th>
                  <th>Next Run</th>
                  <th>Customers</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {recurringRuns.map((template) => {
                  const assignments = getTemplateAssignments(template)
                  const customerPreview = assignments
                    .slice(0, 2)
                    .map((assignment) => {
                      const customerName = customerNameMap.get(assignment.customerId) ?? assignment.customerId
                      return assignment.locationName ? `${customerName} (${assignment.locationName})` : customerName
                    })
                    .join(', ')

                  return (
                    <tr key={template.id}>
                      <td>{template.name}</td>
                      <td>{WEEKDAYS[template.dayOfWeek]} - {frequencyLabel(template.frequency)}</td>
                      <td>{template.driverId ? (driverNameMap.get(template.driverId) ?? template.driverId) : 'Unassigned'}</td>
                      <td>{formatDate(template.startDate)}</td>
                      <td>{formatDate(template.nextRunDate)}</td>
                      <td>
                        <div className="rr-table__customer-cell">
                          <span>{assignments.length}</span>
                          {customerPreview && (
                            <small>
                              {customerPreview}
                              {assignments.length > 2 ? ', ...' : ''}
                            </small>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className={`rr-status ${template.isActive ? 'rr-status--active' : 'rr-status--inactive'}`}>
                        <th>Driver</th>
                          {template.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>
                        <div className="rr-actions">
                          <Button variant="secondary" size="sm" onClick={() => startEdit(template)}>
                            Edit
                          </Button>
                          <Button variant="danger" size="sm" onClick={() => handleDelete(template.id)}>
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedTemplate && (
        <p className="rr-editing-note">Editing: {selectedTemplate.name}</p>
      )}
    </div>
  )
}
