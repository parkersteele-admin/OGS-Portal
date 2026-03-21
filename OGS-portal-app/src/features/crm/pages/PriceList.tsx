/**
 * src/pages/crm/PriceList.tsx
 *
 * Sales / Admin — Full product catalog with inline price editing,
 * visibility toggles, featured toggles, and add-product slide-over.
 */

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  type KeyboardEvent,
} from 'react'
import { subscribeToProducts, updateProduct, createProduct, deleteProduct } from '../../../services/productService'
import { seedProducts } from '../../../db/seed/products'
import { useAuth } from '../../../hooks/useAuth'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import type { Product, ProductCategory } from '../../../types/product'
import './PriceList.css'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function fmtPct(n: number) {
  return `${(n * 100).toFixed(1)}%`
}

function normalizeMarginInput(value: number): number {
  if (!Number.isFinite(value)) return 0
  const normalized = value > 1 ? value / 100 : value
  return Math.min(Math.max(normalized, 0), 0.95)
}

function calcMinPrice(cost: number, minMarginPercent: number): number {
  const safeCost = Number.isFinite(cost) ? Math.max(cost, 0) : 0
  const safeMargin = Math.min(Math.max(minMarginPercent, 0), 0.95)
  return parseFloat((safeCost / (1 - safeMargin)).toFixed(2))
}

function calcMarginPercent(price: number, cost: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0
  return (price - cost) / price
}

function fmtDate(ts: { toDate?: () => Date } | undefined) {
  if (!ts?.toDate) return '—'
  return ts.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const CATEGORIES: ProductCategory[] = ['CO\u2082 Cylinders', 'Nitrogen', 'Beer Gas', 'Propane', 'Rentals', 'Fees']

// ── Inline-editable price cell ────────────────────────────────────────────────

interface PriceCellProps {
  value: number
  productId: string
  field: 'basePrice' | 'rentalPrice' | 'cost' | 'minMarginPercent'
  changedByUid: string
  onSaved: (id: string, field: string, val: number) => void
  format?: 'currency' | 'percent'
}

const PriceCell: React.FC<PriceCellProps> = ({ value, productId, field, changedByUid, onSaved, format = 'currency' }) => {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(format === 'percent' ? (value ?? 0) * 100 : (value ?? '')))
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  async function save() {
    const num = parseFloat(draft)
    if (isNaN(num) || num < 0) {
      setEditing(false)
      setDraft(String(format === 'percent' ? (value ?? 0) * 100 : (value ?? '')))
      return
    }
    const normalized = format === 'percent' ? normalizeMarginInput(num) : num
    if (normalized === value) { setEditing(false); return }
    setSaving(true)
    try {
      await updateProduct(productId, { [field]: normalized }, changedByUid)
      onSaved(productId, field, normalized)
    } finally {
      setSaving(false)
      setEditing(false)
    }
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') save()
    if (e.key === 'Escape') {
      setEditing(false)
      setDraft(String(format === 'percent' ? (value ?? 0) * 100 : (value ?? '')))
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="pl-price-input"
        type="number"
        min={0}
        max={format === 'percent' ? 95 : undefined}
        step={format === 'percent' ? 0.1 : 0.01}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={onKey}
        disabled={saving}
        aria-label={`Edit ${field}`}
      />
    )
  }

  return (
    <button
      className="pl-price-cell"
      onClick={() => {
        setDraft(String(format === 'percent' ? (value ?? 0) * 100 : (value ?? '')))
        setEditing(true)
      }}
      title={`Click to edit ${field}`}
      aria-label={`${format === 'percent' ? fmtPct(value ?? 0) : fmt(value ?? 0)}, click to edit`}
    >
      {value != null ? (format === 'percent' ? fmtPct(value) : fmt(value)) : <span className="pl-price-cell--empty">—</span>}
      <span className="pl-price-cell__icon" aria-hidden="true">✎</span>
    </button>
  )
}

// ── Toggle switch ─────────────────────────────────────────────────────────────

interface ToggleProps {
  checked: boolean
  onChange: () => void
  label: string
  disabled?: boolean
}

const Toggle: React.FC<ToggleProps> = ({ checked, onChange, label, disabled }) => (
  <button
    role="switch"
    aria-checked={checked}
    aria-label={label}
    className={`pl-toggle${checked ? ' pl-toggle--on' : ''}${disabled ? ' pl-toggle--disabled' : ''}`}
    onClick={disabled ? undefined : onChange}
    disabled={disabled}
    type="button"
  >
    <span className="pl-toggle__thumb" />
  </button>
)

// ── Add / Edit product slide-over ─────────────────────────────────────────────

interface SlideOverProps {
  initial?: Product | null
  onClose: () => void
  onSaved: () => void
}

const SlideOver: React.FC<SlideOverProps> = ({ initial, onClose, onSaved }) => {
  const [sku,          setSku]          = useState(initial?.sku ?? '')
  const [category,     setCategory]     = useState<ProductCategory>(initial?.category ?? 'CO\u2082 Cylinders')
  const [name,         setName]         = useState(initial?.name ?? '')
  const [description,  setDescription]  = useState(initial?.description ?? '')
  const [sizeLabel,    setSizeLabel]    = useState(initial?.sizeLabel ?? '')
  const [unit,         setUnit]         = useState(initial?.unit ?? 'cylinder')
  const [basePrice,    setBasePrice]    = useState(String(initial?.basePrice ?? ''))
  const [cost,         setCost]         = useState(String(initial?.cost ?? ''))
  const [minMargin,    setMinMargin]    = useState(String(((initial?.minMarginPercent ?? 0.2) * 100).toFixed(1)))
  const [rentalPrice,  setRentalPrice]  = useState(String(initial?.rentalPrice ?? ''))
  const [isVisible,    setIsVisible]    = useState(initial?.isVisible ?? false)
  const [isFeatured,   setIsFeatured]   = useState(initial?.isFeatured ?? false)
  const [sortOrder,    setSortOrder]    = useState(String(initial?.sortOrder ?? 0))
  const [tags,         setTags]         = useState((initial?.tags ?? []).join(', '))
  const [notes,        setNotes]        = useState(initial?.notes ?? '')
  const [error,        setError]        = useState('')
  const [busy,         setBusy]         = useState(false)

  const UNITS = ['cylinder', 'lb', 'cf', 'liter', 'box', 'fee', 'cylinder/month', 'container/month', 'each']

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!sku.trim()) return setError('SKU is required.')
    if (!name.trim()) return setError('Name is required.')
    if (!basePrice || isNaN(parseFloat(basePrice))) return setError('Base price must be a number.')
    if (!cost || isNaN(parseFloat(cost))) return setError('Cost is required and must be a number.')
    if (!minMargin || isNaN(parseFloat(minMargin))) return setError('Minimum margin % is required.')

    const parsedBasePrice = parseFloat(basePrice)
    const parsedCost = parseFloat(cost)
    const minMarginPercent = normalizeMarginInput(parseFloat(minMargin))
    const minPrice = calcMinPrice(parsedCost, minMarginPercent)

    if (parsedBasePrice < minPrice) {
      return setError(`Base price must be at least ${fmt(minPrice)} for current cost and minimum margin.`)
    }

    const payload = {
      sku: sku.trim().toUpperCase(),
      category,
      name: name.trim(),
      description: description.trim() || undefined,
      sizeLabel: sizeLabel.trim() || undefined,
      unit: unit.trim() || 'cylinder',
      basePrice: parsedBasePrice,
      pricePerUnit: parsedBasePrice,
      cost: parsedCost,
      minMarginPercent,
      rentalPrice: rentalPrice ? parseFloat(rentalPrice) : null,
      isVisible,
      isFeatured,
      sortOrder: parseInt(sortOrder) || 0,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      notes: notes.trim() || undefined,
      active: true,
    }

    setBusy(true)
    try {
      if (initial?.id) {
        await updateProduct(initial.id, payload)
      } else {
        await createProduct(payload)
      }
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save product.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pl-slideover-backdrop" onClick={onClose}>
      <aside className="pl-slideover" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={initial ? 'Edit product' : 'Add product'}>
        <div className="pl-slideover__header">
          <h2 className="pl-slideover__title">{initial ? 'Edit Product' : 'Add Product'}</h2>
          <button className="pl-slideover__close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <form className="pl-slideover__body" onSubmit={handleSubmit} noValidate>
          {error && <div className="pl-error">{error}</div>}

          <div className="pl-so-grid">
            <Input label="SKU *" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="e.g. CO2-20LB" />
            <div className="pl-so-field">
              <label className="pl-so-label" htmlFor="so-category">Category *</label>
              <select id="so-category" className="pl-so-select" value={category} onChange={(e) => setCategory(e.target.value as ProductCategory)}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                <option value="">Other…</option>
              </select>
            </div>
          </div>

          <Input label="Product Name *" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Carbon Dioxide – 20 lb." />

          <div className="pl-so-field">
            <label className="pl-so-label" htmlFor="so-desc">Description</label>
            <textarea id="so-desc" className="pl-so-textarea" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Customer-facing description…" />
          </div>

          <div className="pl-so-grid">
            <Input label="Size Label" value={sizeLabel} onChange={(e) => setSizeLabel(e.target.value)} placeholder="e.g. 20 lb." />
            <div className="pl-so-field">
              <label className="pl-so-label" htmlFor="so-unit">Unit</label>
              <select id="so-unit" className="pl-so-select" value={unit} onChange={(e) => setUnit(e.target.value)}>
                {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>

          <div className="pl-so-grid">
            <Input label="Base Price ($) *" type="number" min={0} step={0.01} value={basePrice} onChange={(e) => setBasePrice(e.target.value)} placeholder="0.00" />
            <Input label="Cost ($) *" type="number" min={0} step={0.01} value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0.00" />
            <Input label="Min Margin (%) *" type="number" min={0} max={95} step={0.1} value={minMargin} onChange={(e) => setMinMargin(e.target.value)} placeholder="20" />
          </div>

          <div className="pl-so-grid">
            <Input label="Rental Price ($/mo)" type="number" min={0} step={0.01} value={rentalPrice} onChange={(e) => setRentalPrice(e.target.value)} placeholder="0.00" />
            <Input label="Sort Order" type="number" min={0} step={1} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} placeholder="0" />
          </div>

          {basePrice && cost && minMargin && !isNaN(parseFloat(basePrice)) && !isNaN(parseFloat(cost)) && !isNaN(parseFloat(minMargin)) && (
            <p className="pl-so-hint">
              Minimum allowed price: {fmt(calcMinPrice(parseFloat(cost), normalizeMarginInput(parseFloat(minMargin))))}
            </p>
          )}

          <div className="pl-so-toggles">
            <label className="pl-so-toggle-row">
              <Toggle checked={isVisible} onChange={() => setIsVisible((v) => !v)} label="Visible to customers" />
              <span>Visible to customers</span>
            </label>
            <label className="pl-so-toggle-row">
              <Toggle checked={isFeatured} onChange={() => setIsFeatured((v) => !v)} label="Featured (Popular badge)" />
              <span>Featured (Popular badge)</span>
            </label>
          </div>

          <Input label="Tags (comma-separated)" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="bar, restaurant, nitro" />

          <div className="pl-so-field">
            <label className="pl-so-label" htmlFor="so-notes">Internal Notes</label>
            <textarea id="so-notes" className="pl-so-textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Sales notes (not shown to customers)…" />
          </div>

          <div className="pl-slideover__footer">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : initial ? 'Save Changes' : 'Add Product'}</Button>
          </div>
        </form>
      </aside>
    </div>
  )
}

// ── Product row ───────────────────────────────────────────────────────────────

interface RowProps {
  product: Product
  uid: string
  canManageCatalog: boolean
  onPriceSaved: (id: string, field: string, val: number) => void
  onToggleVisible: (id: string) => void
  onToggleFeatured: (id: string) => void
  onEdit: (p: Product) => void
  onDelete: (p: Product) => void
}

const ProductRow: React.FC<RowProps> = ({
  product, uid, canManageCatalog, onPriceSaved, onToggleVisible, onToggleFeatured, onEdit, onDelete,
}) => {
  const [togglingVisible,  setTogglingVisible]  = useState(false)
  const [togglingFeatured, setTogglingFeatured] = useState(false)

  const cost = product.cost ?? 0
  const minMarginPercent = product.minMarginPercent ?? 0.2
  const minPrice = product.minPrice ?? calcMinPrice(cost, minMarginPercent)
  const marginAtBase = calcMarginPercent(product.basePrice, cost)
  const isBelowMin = product.basePrice + 0.0001 < minPrice

  async function handleToggleVisible() {
    if (!canManageCatalog) return
    if (togglingVisible) return
    if (!product.isVisible) {
      if (!confirm(`Make "${product.name}" visible to customers?`)) return
    }
    setTogglingVisible(true)
    try {
      const newVal = !product.isVisible
      await updateProduct(product.id, { isVisible: newVal })
      onToggleVisible(product.id)
    } finally {
      setTogglingVisible(false)
    }
  }

  async function handleToggleFeatured() {
    if (!canManageCatalog) return
    if (togglingFeatured) return
    setTogglingFeatured(true)
    try {
      const newVal = !product.isFeatured
      await updateProduct(product.id, { isFeatured: newVal })
      onToggleFeatured(product.id)
    } finally {
      setTogglingFeatured(false)
    }
  }

  return (
    <tr className="pl-row">
      <td className="pl-cell pl-cell--sku">
        <span className="pl-sku">{product.sku}</span>
      </td>
      <td className="pl-cell pl-cell--name">
        <div className="pl-name">{product.name}</div>
        {product.sizeLabel && <div className="pl-size">{product.sizeLabel}</div>}
      </td>
      <td className="pl-cell pl-cell--price">
        {canManageCatalog
          ? <PriceCell value={product.basePrice} productId={product.id} field="basePrice" changedByUid={uid} onSaved={onPriceSaved} />
          : <span>{fmt(product.basePrice)}</span>}
      </td>
      {canManageCatalog && (
        <>
          <td className="pl-cell pl-cell--cost">
            <PriceCell value={cost} productId={product.id} field="cost" changedByUid={uid} onSaved={onPriceSaved} />
          </td>
          <td className="pl-cell pl-cell--margin">
            <PriceCell
              value={minMarginPercent}
              productId={product.id}
              field="minMarginPercent"
              changedByUid={uid}
              onSaved={onPriceSaved}
              format="percent"
            />
          </td>
          <td className={`pl-cell pl-cell--margin-info${isBelowMin ? ' pl-cell--warn' : ''}`}>
            <div className="pl-margin-stack">
              <span>Base margin: {fmtPct(marginAtBase)}</span>
              <span className="pl-muted">Min price: {fmt(minPrice)}</span>
            </div>
          </td>
        </>
      )}
      <td className="pl-cell pl-cell--rental">
        {product.rentalPrice != null && canManageCatalog
          ? <PriceCell value={product.rentalPrice} productId={product.id} field="rentalPrice" changedByUid={uid} onSaved={onPriceSaved} />
          : <span className="pl-muted">{product.rentalPrice != null ? fmt(product.rentalPrice) : '—'}</span>
        }
      </td>
      {canManageCatalog && (
        <>
          <td className="pl-cell pl-cell--toggle">
            <Toggle
              checked={product.isVisible}
              onChange={handleToggleVisible}
              label={`${product.isVisible ? 'Hide' : 'Show'} ${product.name}`}
              disabled={togglingVisible}
            />
          </td>
          <td className="pl-cell pl-cell--toggle">
            <Toggle
              checked={product.isFeatured}
              onChange={handleToggleFeatured}
              label={`${product.isFeatured ? 'Unfeature' : 'Feature'} ${product.name}`}
              disabled={togglingFeatured || !product.isVisible}
            />
          </td>
        </>
      )}
      <td className="pl-cell pl-cell--updated pl-muted">{fmtDate(product.updatedAt as Parameters<typeof fmtDate>[0])}</td>
      {canManageCatalog && (
        <td className="pl-cell pl-cell--actions">
          <button className="pl-action-btn" onClick={() => onEdit(product)} title="Edit product" aria-label={`Edit ${product.name}`}>✎</button>
          <button className="pl-action-btn pl-action-btn--danger" onClick={() => onDelete(product)} title="Archive product" aria-label={`Archive ${product.name}`}>✕</button>
        </td>
      )}
    </tr>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const PriceList: React.FC = () => {
  const { user, realUser, isAdmin } = useAuth()
  const uid = realUser?.id ?? user?.id ?? ''
  const canManageCatalog = isAdmin

  const [products,    setProducts]    = useState<Product[]>([])
  const [loading,     setLoading]     = useState(true)
  const [loadErr,     setLoadErr]     = useState('')
  const [search,      setSearch]      = useState('')
  const [catFilter,   setCatFilter]   = useState<ProductCategory | 'All'>('All')
  const [slideOver,   setSlideOver]   = useState<Product | null | 'new'>(null)
  const [seeding,     setSeeding]     = useState(false)
  const [seedMsg,     setSeedMsg]     = useState('')

  useEffect(() => {
    setLoading(true)
    const unsub = subscribeToProducts(
      (ps) => { setProducts(ps); setLoading(false) },
      (err) => { setLoadErr(err.message); setLoading(false) },
    )
    return unsub
  }, [])

  const filtered = products.filter((p) => {
    if (catFilter !== 'All' && p.category !== catFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.description ?? '').toLowerCase().includes(q)
      )
    }
    return true
  })

  const grouped = CATEGORIES.reduce<Record<string, Product[]>>((acc, cat) => {
    const rows = filtered.filter((p) => p.category === cat)
    if (rows.length) acc[cat] = rows
    return acc
  }, {})
  // Catch any "Other" categories
  const otherCats = [...new Set(filtered.map((p) => p.category))].filter(
    (c) => !CATEGORIES.includes(c as ProductCategory),
  )
  for (const cat of otherCats) {
    grouped[cat] = filtered.filter((p) => p.category === cat)
  }

  const optimisticUpdate = useCallback((id: string, field: string, val: number) => {
    setProducts((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p
        const next = { ...p, [field]: val, pricePerUnit: field === 'basePrice' ? val : p.pricePerUnit }
        const cost = next.cost ?? 0
        const minMarginPercent = next.minMarginPercent ?? 0.2
        return {
          ...next,
          minPrice: calcMinPrice(cost, minMarginPercent),
        }
      }),
    )
  }, [])

  const optimisticToggle = useCallback((id: string, field: 'isVisible' | 'isFeatured') => {
    setProducts((prev) => prev.map((p) => p.id === id ? { ...p, [field]: !p[field] } : p))
  }, [])

  async function handleDelete(p: Product) {
    if (!canManageCatalog) return
    if (!confirm(`Archive "${p.name}"? It will be hidden from all views but data is preserved.`)) return
    await deleteProduct(p.id)
    setProducts((prev) => prev.filter((x) => x.id !== p.id))
  }

  async function handleSeed() {
    if (!canManageCatalog) return
    if (!confirm('Load Columbus market starter products? Existing products will not be overwritten.')) return
    setSeeding(true)
    setSeedMsg('')
    try {
      const result = await seedProducts()
      setSeedMsg(`✓ Seeded: ${result.created} created, ${result.updated} updated.`)
    } catch (err) {
      setSeedMsg(`Error: ${err instanceof Error ? err.message : 'Seed failed'}`)
    } finally {
      setSeeding(false)
    }
  }

  return (
    <div className="pl-page">
      {/* Header */}
      <div className="pl-header">
        <div className="pl-header__left">
          <h1 className="pl-title">Price List</h1>
          <p className="pl-subtitle">
            {canManageCatalog
              ? `${products.length} products · base price, cost, and min margin enforced inline`
              : `${products.length} products · read-only pricing reference`}
          </p>
        </div>
        <div className="pl-header__actions">
          {canManageCatalog && (
            <Button variant="secondary" onClick={handleSeed} disabled={seeding} size="sm">
              {seeding ? 'Seeding…' : 'Load Seed Data'}
            </Button>
          )}
          {canManageCatalog && <Button onClick={() => setSlideOver('new')} size="sm">+ Add Product</Button>}
        </div>
      </div>

      {seedMsg && <div className={`pl-seed-msg${seedMsg.startsWith('Error') ? ' pl-seed-msg--error' : ''}`}>{seedMsg}</div>}

      {/* Filters */}
      <div className="pl-filters">
        <Input
          placeholder="Search by name or SKU…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-search"
        />
        <div className="pl-cat-pills">
          {(['All', ...CATEGORIES] as const).map((c) => (
            <button
              key={c}
              className={`pl-cat-pill${catFilter === c ? ' pl-cat-pill--active' : ''}`}
              onClick={() => setCatFilter(c)}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="pl-loading">Loading products…</div>
      ) : loadErr ? (
        <div className="pl-empty" style={{ color: 'var(--color-error, #c0392b)' }}>
          Failed to load products: {loadErr}
        </div>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="pl-empty">No products found. Use "Load Seed Data" to populate the Columbus market catalog, or add products manually.</div>
      ) : (
        <div className="pl-table-wrap">
          {Object.entries(grouped).map(([cat, rows]) => (
            <section key={cat} className="pl-category-section">
              <h2 className="pl-category-heading">{cat}</h2>
              <table className="pl-table" aria-label={`${cat} products`}>
                <thead>
                  <tr>
                    <th className="pl-th">SKU</th>
                    <th className="pl-th">Product</th>
                    <th className="pl-th">Base Price</th>
                    {canManageCatalog && <th className="pl-th">Cost</th>}
                    {canManageCatalog && <th className="pl-th">Min Margin %</th>}
                    {canManageCatalog && <th className="pl-th">Margin @ Base</th>}
                    <th className="pl-th">Rental/mo</th>
                    {canManageCatalog && <th className="pl-th" title="Customer visible">Visible</th>}
                    {canManageCatalog && <th className="pl-th" title="Show Popular badge">Featured</th>}
                    <th className="pl-th">Updated</th>
                    {canManageCatalog && <th className="pl-th" />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <ProductRow
                      key={p.id}
                      product={p}
                      uid={uid}
                      canManageCatalog={canManageCatalog}
                      onPriceSaved={optimisticUpdate}
                      onToggleVisible={(id) => optimisticToggle(id, 'isVisible')}
                      onToggleFeatured={(id) => optimisticToggle(id, 'isFeatured')}
                      onEdit={(prod) => canManageCatalog && setSlideOver(prod)}
                      onDelete={handleDelete}
                    />
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}

      {/* Slide-over */}
      {canManageCatalog && slideOver !== null && (
        <SlideOver
          initial={slideOver === 'new' ? null : slideOver}
          onClose={() => setSlideOver(null)}
          onSaved={() => setSlideOver(null)}
        />
      )}
    </div>
  )
}

export default PriceList
