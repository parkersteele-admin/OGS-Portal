/**
 * src/pages/customer/ProductCatalog.tsx
 *
 * Customer portal — Browse visible products grouped by category.
 * Featured products show a "Popular" badge.
 * "Add to Order" navigates to /portal/order?productId=X
 */

import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getDocs, query, where, orderBy, limit } from 'firebase/firestore'
import { getVisibleProducts } from '../../../services/productService'
import { ordersCol } from '../../../lib/firestore'
import { useAuth } from '../../../hooks/useAuth'
import { usePricingAccess } from '../../../hooks/usePricingAccess'
import { useCompanySettings } from '../../../hooks/useCompanySettings'
import type { Product, ProductCategory } from '../../../types/product'
import './ProductCatalog.css'

// ── Pricing gate ─────────────────────────────────────────────────────────────

const PricingGate: React.FC = () => {
  const company = useCompanySettings()
  return (
    <div className="pc-gate">
      <div className="pc-gate__icon" aria-hidden="true">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          <circle cx="12" cy="16" r="1.5" fill="currentColor"/>
        </svg>
      </div>
      <h2 className="pc-gate__title">Pricing not yet available</h2>
      <p className="pc-gate__body">
        Your account pricing is being customized by our team. You'll receive an
        email once your first quote is ready — at that point product pricing and
        ordering will be unlocked.
      </p>
      <p className="pc-gate__body">
        Questions? Contact us at{' '}
        {company.email
          ? <a href={`mailto:${company.email}`} className="pc-gate__link">{company.email}</a>
          : null
        }
        {company.email && company.phone ? ' or call ' : null}
        {company.phone
          ? <a href={`tel:${company.phone.replace(/\D/g, '')}`} className="pc-gate__link">{company.phone}</a>
          : null
        }
        {!company.email && !company.phone ? 'our team.' : '.'}
      </p>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

// ── Product row (list item) ──────────────────────────────────────────────────

interface ProductRowProps {
  product: Product
  onOrder: (productId: string) => void
}

const ProductRow: React.FC<ProductRowProps> = ({ product, onOrder }) => (
  <div className="pc-row" role="row" aria-label={product.name}>
    <div className="pc-row__main">
      <span className="pc-row__name">
        {product.name}
        {product.isFeatured && <span className="pc-row__popular">Popular</span>}
      </span>
      {(product.sizeLabel || product.description) && (
        <span className="pc-row__meta">
          {[product.sizeLabel, product.description].filter(Boolean).join(' · ')}
        </span>
      )}
    </div>
    <div className="pc-row__pricing">
      <span className="pc-row__price">{fmt(product.basePrice)}</span>
      <span className="pc-row__unit">/ {product.unit}</span>
      {product.rentalPrice != null && product.rentalPrice > 0 && (
        <span className="pc-row__rental">+&nbsp;{fmt(product.rentalPrice)}/mo rental</span>
      )}
    </div>
    <button
      className="pc-row__btn"
      onClick={() => onOrder(product.id)}
      aria-label={`Add ${product.name} to order`}
    >
      Add item
    </button>
  </div>
)

// ── Category section ──────────────────────────────────────────────────────────

interface CategorySectionProps {
  category: string
  products: Product[]
  collapsed: boolean
  onToggle: () => void
  onOrder: (id: string) => void
}

const CategorySection: React.FC<CategorySectionProps> = ({
  category, products, collapsed, onToggle, onOrder,
}) => (
  <section className="pc-category" aria-label={category}>
    <button
      className="pc-category__header"
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-controls={`pc-cat-${category.replace(/\s/g, '-')}`}
    >
      <h2 className="pc-category__title">{category}</h2>
      <div className="pc-category__meta">
        <span className="pc-category__count">{products.length} item{products.length !== 1 ? 's' : ''}</span>
        <span className="pc-category__chevron" aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
      </div>
    </button>

    {!collapsed && (
      <div
        id={`pc-cat-${category.replace(/\s/g, '-')}`}
        className="pc-category__list"
        role="rowgroup"
      >
        {products.map((p) => (
          <ProductRow key={p.id} product={p} onOrder={onOrder} />
        ))}
      </div>
    )}
  </section>
)

// ── Main page ─────────────────────────────────────────────────────────────────

const ProductCatalog: React.FC = () => {
  const navigate = useNavigate()
  const { user } = useAuth()
  const customerId = user?.customerId ?? ''
  const { pricingUnlocked, isLoading: pricingLoading } = usePricingAccess()
  const [products,  setProducts]  = useState<Product[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState('')
  const [search,    setSearch]    = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  useEffect(() => {
    setLoading(true)
    getVisibleProducts()
      .then(setProducts)
      .catch(() => setError('Unable to load products. Please try again.'))
      .finally(() => setLoading(false))
  }, [])

  // Fetch recent product IDs from customer orders
  const { data: recentProductIds = [] } = useQuery<string[]>({
    queryKey: ['recent-product-ids', customerId],
    queryFn: async () => {
      const snap = await getDocs(
        query(ordersCol, where('customerId', '==', customerId), orderBy('requestedAt', 'desc'), limit(20)),
      )
      const seen = new Set<string>()
      const ids: string[] = []
      for (const d of snap.docs) {
        const pid = (d.data() as { productId?: string }).productId
        if (pid && !seen.has(pid)) { seen.add(pid); ids.push(pid) }
      }
      return ids
    },
    enabled: !!customerId,
    staleTime: 5 * 60 * 1000,
  })

  const handleOrder = useCallback((productId: string) => {
    navigate(`/portal/order?productId=${productId}`)
  }, [navigate])

  const toggleCategory = useCallback((cat: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }, [])

  // Filter Fees — those are admin/sales only
  const visibleProducts = products.filter((p) => p.category !== 'Fees')

  const filtered = visibleProducts.filter((p) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      p.name.toLowerCase().includes(q) ||
      (p.description ?? '').toLowerCase().includes(q) ||
      (p.sizeLabel ?? '').toLowerCase().includes(q)
    )
  })

  const recentProducts = recentProductIds
    .map((id) => filtered.find((p) => p.id === id))
    .filter((p): p is Product => !!p)
    .slice(0, 6)

  // Group by category, preserve sort order
  const categoryOrder: ProductCategory[] = ['CO\u2082 Cylinders', 'Nitrogen', 'Beer Gas', 'Rentals']
  const grouped = categoryOrder.reduce<Record<string, Product[]>>((acc, cat) => {
    const rows = filtered.filter((p) => p.category === cat)
    if (rows.length) acc[cat] = rows
    return acc
  }, {})
  const otherCats = [...new Set(filtered.map((p) => p.category))].filter(
    (c) => !categoryOrder.includes(c as ProductCategory),
  )
  for (const cat of otherCats) {
    grouped[cat] = filtered.filter((p) => p.category === cat)
  }

  return (
    <div className="pc-page">
      {/* Pricing gate — shown until OGS sends first quote */}
      {!pricingLoading && !pricingUnlocked && <PricingGate />}

      {pricingUnlocked && (<>
      {/* Page header */}
      <div className="pc-header">
        <div>
          <h1 className="pc-header__title">Product Catalog</h1>
          <p className="pc-header__sub">Browse products and add items to your order</p>
        </div>
        <div className="pc-search">
          <svg className="pc-search__icon" width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M11 11L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            className="pc-search__input"
            placeholder="Search products…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search products"
          />
        </div>
      </div>

      {error && <div className="pc-error" role="alert">{error}</div>}

      {loading ? (
        <div className="pc-loading" aria-live="polite">Loading products…</div>
      ) : filtered.length === 0 ? (
        <div className="pc-empty">
          {search ? `No products match "${search}".` : 'No products available yet.'}
        </div>
      ) : (
        <div className="pc-content">
          <div className="pc-list-header" aria-hidden="true">
            <span>Product</span>
            <span>Unit Price</span>
            <span />
          </div>

          <div className="pc-categories">
            {/* Recently ordered section */}
            {recentProducts.length > 0 && !search && (
              <section className="pc-category" aria-label="Recently ordered">
                <div className="pc-category__header pc-category__header--static">
                  <h2 className="pc-category__title">Recently ordered</h2>
                  <div className="pc-category__meta">
                    <span className="pc-category__count pc-category__count--recent">Quick add</span>
                  </div>
                </div>
                <div className="pc-category__list" role="rowgroup">
                  {recentProducts.map((p) => (
                    <ProductRow key={p.id} product={p} onOrder={handleOrder} />
                  ))}
                </div>
              </section>
            )}

            {Object.entries(grouped).map(([cat, rows]) => (
              <CategorySection
                key={cat}
                category={cat}
                products={rows}
                collapsed={collapsed.has(cat)}
                onToggle={() => toggleCategory(cat)}
                onOrder={handleOrder}
              />
            ))}
          </div>
        </div>
      )}
      </>)}
    </div>
  )
}

export default ProductCatalog
