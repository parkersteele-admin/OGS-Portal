/**
 * src/components/onboarding/steps/Step3GasUsage.tsx
 *
 * Onboarding Step 3 — Gas Usage & Products.
 * Multi-select product category cards; inline rows for size, monthly volume,
 * and cylinder ownership per selected category.
 */

import React, { useState, useRef, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getDocs, query, where } from 'firebase/firestore'
import { productsCol } from '../../../lib/firestore'
import { updateCompany, advanceSetupStep } from '../../../services/onboardingService'
import { Button } from '../../ui/Button'
import type { Company, UsageEntry } from '../../../types/company'
import type { Product } from '../../../types/product'

interface Props {
  company: Company
  onNext: () => void
  onBack: () => void
}

interface CategoryCard {
  value: string
  label: string
  icon: string
  useCases: string
}

const CATEGORIES: CategoryCard[] = [
  { value: 'co2', label: 'CO₂', icon: '🫧', useCases: 'Beverage dispensing, brewing, carbonation' },
  { value: 'nitrogen', label: 'Nitrogen', icon: '💨', useCases: 'Brewing, purging, laser cutting' },
  { value: 'oxygen', label: 'Oxygen', icon: '🩺', useCases: 'Medical, welding, cutting' },
  { value: 'argon', label: 'Argon / Mix', icon: '🔩', useCases: 'Welding, fabrication' },
  { value: 'propane', label: 'Propane', icon: '🔥', useCases: 'Cooking, heating' },
  { value: 'helium', label: 'Helium', icon: '🎈', useCases: 'Balloons, lab' },
  { value: 'not_sure', label: 'Not Sure', icon: '❓', useCases: '' },
]

const MONTHLY_OPTIONS = [
  '< 5 cylinders',
  '5–10 cylinders',
  '10–25 cylinders',
  '25+ cylinders',
  'Not sure',
]

const OWNERSHIP_OPTIONS = [
  'I own my cylinders',
  'I rent / lease',
  'Not sure',
]

export const Step3GasUsage: React.FC<Props> = ({ company, onNext, onBack }) => {
  const companyId = company.companyId

  // Build initial usage map from company data
  const [usageMap, setUsageMap] = useState<Record<string, Partial<UsageEntry>>>(() => {
    const map: Record<string, Partial<UsageEntry>> = {}
    ;(company.usageProfile ?? []).forEach((entry) => {
      map[entry.category] = entry
    })
    return map
  })

  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const selectedCategories = Object.keys(usageMap)

  // Fetch products for cylinder size dropdowns
  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ['products-onboarding'],
    queryFn: async () => {
      const snap = await getDocs(productsCol)
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Product))
    },
    staleTime: 10 * 60 * 1000,
  })

  // Group products by category for the size dropdowns
  const productsByCategory = React.useMemo(() => {
    const map: Record<string, Product[]> = {}
    products.forEach((p) => {
      const cat = (p as Product & { category?: string }).category ?? p.type
      if (cat) {
        if (!map[cat]) map[cat] = []
        map[cat].push(p)
      }
    })
    return map
  }, [products])

  // ── Auto-save ─────────────────────────────────────────────────────────────

  const scheduleAutoSave = useCallback(
    (map: Record<string, Partial<UsageEntry>>) => {
      if (saveTimeout.current) clearTimeout(saveTimeout.current)
      saveTimeout.current = setTimeout(async () => {
        try {
          const profile = buildProfile(map)
          await updateCompany(companyId, { usageProfile: profile })
        } catch {
          // Silent
        }
      }, 800)
    },
    [companyId],
  )

  // ── Category toggle ───────────────────────────────────────────────────────

  const toggleCategory = (category: string) => {
    setUsageMap((prev) => {
      const next = { ...prev }
      if (next[category]) {
        delete next[category]
      } else {
        next[category] = { category, cylinderSize: '', monthlyEst: '', ownership: '' }
      }
      scheduleAutoSave(next)
      return next
    })
  }

  const updateEntry = (category: string, patch: Partial<UsageEntry>) => {
    setUsageMap((prev) => {
      const next = { ...prev, [category]: { ...prev[category], ...patch, category } }
      scheduleAutoSave(next)
      return next
    })
  }

  // ── Build profile ─────────────────────────────────────────────────────────

  function buildProfile(
    map: Record<string, Partial<UsageEntry>>,
  ): UsageEntry[] {
    return Object.values(map).map((entry) => ({
      category: entry.category ?? '',
      cylinderSize: entry.cylinderSize ?? '',
      monthlyEst: entry.monthlyEst ?? '',
      ownership: entry.ownership ?? '',
    }))
  }

  // ── Validation ────────────────────────────────────────────────────────────

  const validate = (): boolean => {
    if (selectedCategories.length === 0) {
      setErrors({ _form: 'Please select at least one gas category.' })
      return false
    }
    setErrors({})
    return true
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleNext = async () => {
    if (!validate()) return
    setSubmitting(true)
    try {
      await updateCompany(companyId, { usageProfile: buildProfile(usageMap) })
      await advanceSetupStep(companyId, 3)
      onNext()
    } catch {
      setErrors({ _form: 'Save failed. Please try again.' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="ob-step">
      <h2 className="ob-step__heading">Gas Usage &amp; Products</h2>
      <p className="ob-step__sub">
        Tell us what you use so we can configure your account and pricing.
      </p>
      {errors._form && <p className="ob-step__err" role="alert">{errors._form}</p>}

      {/* Category cards */}
      <div className="ob-step__category-grid">
        {CATEGORIES.map(({ value, label, icon, useCases }) => {
          const selected = !!usageMap[value]
          return (
            <div
              key={value}
              className={`ob-step__cat-card${selected ? ' ob-step__cat-card--on' : ''}`}
            >
              <button
                type="button"
                className="ob-step__cat-card__btn"
                onClick={() => toggleCategory(value)}
                aria-pressed={selected}
              >
                <span className="ob-step__cat-card__icon" aria-hidden="true">
                  {icon}
                </span>
                <span className="ob-step__cat-card__label">{label}</span>
                {useCases && (
                  <span className="ob-step__cat-card__sub">{useCases}</span>
                )}
              </button>

              {/* Inline detail row when selected */}
              {selected && value !== 'not_sure' && (
                <div className="ob-step__cat-detail">
                  {/* Cylinder size */}
                  <div className="ui-field">
                    <label className="ui-field__label">Cylinder Size</label>
                    {productsByCategory[value]?.length ? (
                      <select
                        className="ui-input"
                        value={usageMap[value]?.cylinderSize ?? ''}
                        onChange={(e) =>
                          updateEntry(value, { cylinderSize: e.target.value })
                        }
                      >
                        <option value="">Select…</option>
                        {productsByCategory[value].map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="ui-input"
                        placeholder="e.g. 50 lb, T-cylinder…"
                        value={usageMap[value]?.cylinderSize ?? ''}
                        onChange={(e) =>
                          updateEntry(value, { cylinderSize: e.target.value })
                        }
                      />
                    )}
                  </div>

                  {/* Monthly estimate */}
                  <div className="ui-field">
                    <label className="ui-field__label">Estimated Monthly Usage</label>
                    <select
                      className="ui-input"
                      value={usageMap[value]?.monthlyEst ?? ''}
                      onChange={(e) =>
                        updateEntry(value, { monthlyEst: e.target.value })
                      }
                    >
                      <option value="">Select…</option>
                      {MONTHLY_OPTIONS.map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                  </div>

                  {/* Cylinder ownership */}
                  <div className="ui-field">
                    <label className="ui-field__label">Cylinder Ownership</label>
                    <select
                      className="ui-input"
                      value={usageMap[value]?.ownership ?? ''}
                      onChange={(e) =>
                        updateEntry(value, { ownership: e.target.value })
                      }
                    >
                      <option value="">Select…</option>
                      {OWNERSHIP_OPTIONS.map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="ob-step__actions">
        <Button variant="ghost" size="lg" onClick={onBack}>
          Back
        </Button>
        <Button
          variant="primary"
          size="lg"
          onClick={() => void handleNext()}
          loading={submitting}
          className="ob-step__next"
        >
          Next: Payment &amp; Notifications
        </Button>
      </div>
    </div>
  )
}
