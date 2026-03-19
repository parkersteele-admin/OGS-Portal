/**
 * src/components/ui/ProductCombobox.tsx
 *
 * Searchable product dropdown grouped by category.
 * Used in AddCylinderModal (TankInventory) and anywhere inventory
 * items need to be linked to a catalog product.
 *
 * When a product is selected, `onSelect` is called with the full
 * ProductDropdownItem so the parent can auto-fill SKU / name / unit.
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  type KeyboardEvent,
} from 'react'
import { getProductDropdown } from '../../services/productService'
import type { ProductDropdownItem } from '../../services/productService'
import './ProductCombobox.css'

export interface ProductComboboxProps {
  /** Currently selected product id (controlled) */
  value: string
  /** Called when user selects a product */
  onSelect: (product: ProductDropdownItem | null) => void
  /** Optional label override */
  label?: string
  /** Placeholder text */
  placeholder?: string
  /** Optional filtered product list (if provided, overrides the default fetch) */
  products?: ProductDropdownItem[]
  disabled?: boolean
  required?: boolean
}

export const ProductCombobox: React.FC<ProductComboboxProps> = ({
  value,
  onSelect,
  label = 'Product',
  placeholder = 'Search or select a product…',
  products,
  disabled = false,
  required = false,
}) => {
  const [options,      setOptions]      = useState<ProductDropdownItem[]>(products ?? [])
  const [loading,      setLoading]      = useState(!products)
  const [open,         setOpen]         = useState(false)
  const [query,        setQuery]        = useState('')
  const [activeIdx,    setActiveIdx]    = useState(-1)
  const wrapRef     = useRef<HTMLDivElement>(null)
  const inputRef    = useRef<HTMLInputElement>(null)
  const listRef     = useRef<HTMLUListElement>(null)

  // Load product list once (only if not provided as prop)
  useEffect(() => {
    if (products) {
      setOptions(products)
      setLoading(false)
      return
    }
    getProductDropdown()
      .then(setOptions)
      .finally(() => setLoading(false))
  }, [products])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Selected product display name
  const selected = options.find((o) => o.id === value)

  // Filtered options
  const filtered = query.trim()
    ? options.filter(
        (o) =>
          o.name.toLowerCase().includes(query.toLowerCase()) ||
          o.sku.toLowerCase().includes(query.toLowerCase()) ||
          o.category.toLowerCase().includes(query.toLowerCase()),
      )
    : options

  // Group by category
  const categories = [...new Set(filtered.map((o) => o.category))]

  // Flat ordered list for keyboard navigation
  const flatList = categories.flatMap((cat) => filtered.filter((o) => o.category === cat))

  function openMenu() {
    if (disabled) return
    setQuery('')
    setActiveIdx(-1)
    setOpen(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  function handleSelect(item: ProductDropdownItem) {
    onSelect(item)
    setOpen(false)
    setQuery('')
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation()
    onSelect(null)
  }

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (!open) { if (e.key === 'Enter' || e.key === ' ') openMenu(); return }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActiveIdx((i) => Math.min(i + 1, flatList.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIdx((i) => Math.max(i - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        if (activeIdx >= 0 && flatList[activeIdx]) handleSelect(flatList[activeIdx])
        break
      case 'Escape':
        setOpen(false)
        break
    }
  }, [open, activeIdx, flatList]) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll active item into view
  useEffect(() => {
    if (activeIdx < 0 || !listRef.current) return
    const el = listRef.current.querySelector(`[data-idx="${activeIdx}"]`) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  return (
    <div className="pcb-wrap" ref={wrapRef}>
      {label && (
        <label className="pcb-label">
          {label}{required && ' *'}
        </label>
      )}

      {/* Trigger */}
      <div
        className={`pcb-trigger${open ? ' pcb-trigger--open' : ''}${disabled ? ' pcb-trigger--disabled' : ''}`}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls="pcb-listbox"
        tabIndex={disabled ? -1 : 0}
        onClick={openMenu}
        onKeyDown={(e) => { if (!open && (e.key === 'Enter' || e.key === ' ')) openMenu() }}
      >
        {open ? (
          <input
            ref={inputRef}
            className="pcb-input"
            type="text"
            placeholder={placeholder}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIdx(-1) }}
            onKeyDown={handleKeyDown}
            aria-autocomplete="list"
            aria-controls="pcb-listbox"
            aria-activedescendant={activeIdx >= 0 ? `pcb-opt-${activeIdx}` : undefined}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className={`pcb-value${!selected ? ' pcb-value--placeholder' : ''}`}>
            {loading ? 'Loading…' : selected ? (
              <span className="pcb-selected">
                <span className="pcb-selected__sku">{selected.sku}</span>
                {selected.name}
              </span>
            ) : placeholder}
          </span>
        )}

        <div className="pcb-trigger__actions">
          {selected && !disabled && (
            <button
              className="pcb-clear"
              onClick={handleClear}
              aria-label="Clear selection"
              tabIndex={-1}
              type="button"
            >✕</button>
          )}
          <span className="pcb-chevron" aria-hidden="true">{open ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Dropdown */}
      {open && (
        <div className="pcb-dropdown">
          {loading ? (
            <div className="pcb-dropdown__empty">Loading products…</div>
          ) : filtered.length === 0 ? (
            <div className="pcb-dropdown__empty">No products match "{query}"</div>
          ) : (
            <ul
              ref={listRef}
              id="pcb-listbox"
              role="listbox"
              className="pcb-list"
              aria-label="Products"
            >
              {categories.map((cat) => (
                <React.Fragment key={cat}>
                  <li className="pcb-group" role="presentation">{cat}</li>
                  {filtered
                    .filter((o) => o.category === cat)
                    .map((o) => {
                      const idx = flatList.indexOf(o)
                      return (
                        <li
                          key={o.id}
                          id={`pcb-opt-${idx}`}
                          data-idx={idx}
                          role="option"
                          aria-selected={o.id === value}
                          className={`pcb-option${o.id === value ? ' pcb-option--selected' : ''}${idx === activeIdx ? ' pcb-option--active' : ''}`}
                          onClick={() => handleSelect(o)}
                          onMouseEnter={() => setActiveIdx(idx)}
                        >
                          <span className="pcb-option__sku">{o.sku}</span>
                          <span className="pcb-option__name">{o.name}</span>
                          <span className="pcb-option__unit">{o.unit}</span>
                        </li>
                      )
                    })}
                </React.Fragment>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
