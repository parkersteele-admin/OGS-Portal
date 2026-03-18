/**
 * src/modules/orders/new/ProductSelector.tsx
 *
 * Searchable combobox for selecting a product on a line item.
 * Groups options by category, filters by name / SKU / sizeLabel.
 * Shows "Popular" badge for featured products.
 * Already-added products are dimmed but still selectable.
 */

import React, { useState, useRef, useEffect, useMemo } from 'react'
import type { Product } from '../../../types/models'
import './ProductSelector.css'

interface ProductSelectorProps {
  products:      Product[]
  value:         string          // selected productId ('' = none)
  addedIds:      Set<string>     // ids already in the order (for dimming)
  onChange:      (product: Product) => void
  placeholder?:  string
  disabled?:     boolean
}

const CATEGORY_ORDER = ['CO2', 'Propane', 'Nitrogen', 'Beer Gas', 'Acetylene', 'Other']

function normalise(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export const ProductSelector: React.FC<ProductSelectorProps> = ({
  products,
  value,
  addedIds,
  onChange,
  placeholder = 'Search products…',
  disabled = false,
}) => {
  const [open,    setOpen]    = useState(false)
  const [query,   setQuery]   = useState('')
  const containerRef          = useRef<HTMLDivElement>(null)
  const inputRef              = useRef<HTMLInputElement>(null)

  // Selected product label
  const selected = useMemo(
    () => products.find((p) => p.id === value),
    [products, value],
  )

  // Filter + group
  const grouped = useMemo(() => {
    const norm = normalise(query)
    const filtered = norm
      ? products.filter(
          (p) =>
            normalise(p.name).includes(norm) ||
            normalise(p.sku).includes(norm) ||
            normalise(p.category).includes(norm) ||
            normalise(p.sizeLabel ?? '').includes(norm),
        )
      : products

    const map = new Map<string, Product[]>()
    CATEGORY_ORDER.forEach((cat) => map.set(cat, []))

    filtered.forEach((p) => {
      const cat = CATEGORY_ORDER.includes(p.category) ? p.category : 'Other'
      map.get(cat)!.push(p)
    })

    return [...map.entries()].filter(([, items]) => items.length > 0)
  }, [products, query])

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function handleFocus() {
    setOpen(true)
    setQuery('')
  }

  function handleSelect(product: Product) {
    onChange(product)
    setOpen(false)
    setQuery('')
    inputRef.current?.blur()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setOpen(false)
      setQuery('')
      inputRef.current?.blur()
    }
  }

  return (
    <div className="ps" ref={containerRef}>
      <input
        ref={inputRef}
        className={`ps__input${open ? ' ps__input--open' : ''}`}
        type="text"
        value={open ? query : (selected ? `${selected.name} — ${selected.sizeLabel ?? ''}` : '')}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={handleFocus}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        autoComplete="off"
      />

      {open && (
        <div className="ps__dropdown" role="listbox">
          {grouped.length === 0 ? (
            <div className="ps__empty">No products match "{query}"</div>
          ) : (
            grouped.map(([category, items]) => (
              <div key={category} className="ps__group">
                <div className="ps__group-label">{category}</div>
                {items.map((product) => {
                  const dimmed = addedIds.has(product.id) && product.id !== value
                  return (
                    <div
                      key={product.id}
                      className={`ps__option${dimmed ? ' ps__option--dimmed' : ''}${product.id === value ? ' ps__option--selected' : ''}`}
                      role="option"
                      aria-selected={product.id === value}
                      onMouseDown={() => handleSelect(product)}
                    >
                      <div className="ps__option-main">
                        <span className="ps__option-name">{product.name}</span>
                        {product.isFeatured && (
                          <span className="ps__popular">Popular</span>
                        )}
                      </div>
                      <span className="ps__option-size">{product.sizeLabel}</span>
                    </div>
                  )
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
