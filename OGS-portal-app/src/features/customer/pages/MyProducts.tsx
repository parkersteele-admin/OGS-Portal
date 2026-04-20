/**
 * src/features/customer/pages/MyProducts.tsx
 *
 * Customer portal — "My Products"
 *
 * Products the customer has been quoted show their negotiated price + "Order" button.
 * Products without a custom price show "Pricing on request" + "Add Item" → quote cart.
 * Submitting the cart creates a quoteRequest document for sales to action.
 */

import React, { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { getDocs, query, where, orderBy, limit, addDoc, serverTimestamp, collection } from 'firebase/firestore'
import { db } from '../../../lib/firebase'
import { getVisibleProducts } from '../../../services/productService'
import { ordersCol } from '../../../lib/firestore'
import { useAuth } from '../../../hooks/useAuth'
import { useCustomerProductPricing } from '../../../hooks/useCustomerProductPricing'
import type { Product, ProductCategory } from '../../../types/product'
import type { CustomerProductPricing } from '../../../types/customerPricing'
import './MyProducts.css'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

// ── Priced product row ────────────────────────────────────────────────────────

interface PricedRowProps {
  product: Product
  pricing: CustomerProductPricing
  onOrder: (productId: string) => void
}

const PricedRow: React.FC<PricedRowProps> = ({ product, pricing, onOrder }) => (
  <div className="mp-row mp-row--priced" role="row" aria-label={product.name}>
    <div className="mp-row__main">
      <span className="mp-row__name">
        {product.name}
        {product.isFeatured && <span className="mp-row__popular">Popular</span>}
      </span>
      {(product.sizeLabel || product.description) && (
        <span className="mp-row__meta">
          {[product.sizeLabel, product.description].filter(Boolean).join(' · ')}
        </span>
      )}
    </div>
    <div className="mp-row__pricing">
      <span className="mp-row__price">{fmt(pricing.price)}</span>
      <span className="mp-row__unit">/ {product.unit}</span>
      {product.rentalPrice != null && product.rentalPrice > 0 && (
        <span className="mp-row__rental">+&nbsp;{fmt(product.rentalPrice)}/mo rental</span>
      )}
    </div>
    <button
      className="mp-row__btn mp-row__btn--order"
      onClick={() => onOrder(product.id)}
      aria-label={`Order ${product.name}`}
    >
      Order
    </button>
  </div>
)

// ── Unpriced product row ──────────────────────────────────────────────────────

interface UnpricedRowProps {
  product: Product
  inCart: boolean
  onToggle: (product: Product) => void
}

const UnpricedRow: React.FC<UnpricedRowProps> = ({ product, inCart, onToggle }) => (
  <div className="mp-row mp-row--unpriced" role="row" aria-label={product.name}>
    <div className="mp-row__main">
      <span className="mp-row__name">
        {product.name}
        {product.isFeatured && <span className="mp-row__popular">Popular</span>}
      </span>
      {(product.sizeLabel || product.description) && (
        <span className="mp-row__meta">
          {[product.sizeLabel, product.description].filter(Boolean).join(' · ')}
        </span>
      )}
    </div>
    <div className="mp-row__pricing">
      <span className="mp-row__no-price">Pricing on request</span>
    </div>
    <button
      className={`mp-row__btn ${inCart ? 'mp-row__btn--in-cart' : 'mp-row__btn--request'}`}
      onClick={() => onToggle(product)}
      aria-label={inCart ? `Remove ${product.name} from quote request` : `Request quote for ${product.name}`}
      aria-pressed={inCart}
    >
      {inCart ? '✓ Added' : 'Add Item'}
    </button>
  </div>
)

// ── Category section ──────────────────────────────────────────────────────────

interface CategorySectionProps {
  category: string
  products: Product[]
  pricingMap: Map<string, CustomerProductPricing>
  cartIds: Set<string>
  collapsed: boolean
  onToggle: () => void
  onOrder: (id: string) => void
  onCartToggle: (product: Product) => void
}

const CategorySection: React.FC<CategorySectionProps> = ({
  category, products, pricingMap, cartIds, collapsed, onToggle, onOrder, onCartToggle,
}) => (
  <section className="mp-category" aria-label={category}>
    <button
      className="mp-category__header"
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-controls={`mp-cat-${category.replace(/\s/g, '-')}`}
    >
      <h2 className="mp-category__title">{category}</h2>
      <div className="mp-category__meta">
        <span className="mp-category__count">{products.length} item{products.length !== 1 ? 's' : ''}</span>
        <span className="mp-category__chevron" aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
      </div>
    </button>

    {!collapsed && (
      <div
        id={`mp-cat-${category.replace(/\s/g, '-')}`}
        className="mp-category__list"
        role="rowgroup"
      >
        {products.map((p) => {
          const pricing = pricingMap.get(p.id)
          return pricing
            ? <PricedRow   key={p.id} product={p} pricing={pricing} onOrder={onOrder} />
            : <UnpricedRow key={p.id} product={p} inCart={cartIds.has(p.id)} onToggle={onCartToggle} />
        })}
      </div>
    )}
  </section>
)

// ── Quote-request cart bar ────────────────────────────────────────────────────

interface CartBarProps {
  items: Product[]
  submitting: boolean
  submitted: boolean
  onRemove: (id: string) => void
  onSubmit: () => void
}

const CartBar: React.FC<CartBarProps> = ({ items, submitting, submitted, onRemove, onSubmit }) => {
  if (items.length === 0) return null

  if (submitted) {
    return (
      <div className="mp-cart-bar mp-cart-bar--success" role="status">
        <span className="mp-cart-bar__icon" aria-hidden="true">✓</span>
        Quote request sent! Our team will be in touch shortly.
      </div>
    )
  }

  return (
    <div className="mp-cart-bar" role="region" aria-label="Quote request cart">
      <div className="mp-cart-bar__items">
        {items.map((p) => (
          <span key={p.id} className="mp-cart-bar__chip">
            {p.name}
            <button
              className="mp-cart-bar__chip-remove"
              onClick={() => onRemove(p.id)}
              aria-label={`Remove ${p.name} from quote request`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <button
        className="mp-cart-bar__submit"
        onClick={onSubmit}
        disabled={submitting}
        aria-busy={submitting}
      >
        {submitting ? 'Sending…' : `Request Quote (${items.length})`}
      </button>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const MyProducts: React.FC = () => {
  const navigate   = useNavigate()
  const { user }   = useAuth()
  const customerId   = user?.companyId ?? user?.customerId ?? ''
  // companyId is in the auth token claim — used for quoteRequests rule validation
  const companyId    = user?.companyId ?? user?.customerId ?? ''

  const [search,    setSearch]    = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [cartItems, setCartItems] = useState<Map<string, Product>>(new Map())
  const [submitted, setSubmitted] = useState(false)

  // All visible products
  const {
    data: products = [],
    isLoading: productsLoading,
    error:     productsError,
  } = useQuery<Product[]>({
    queryKey: ['visible-products'],
    queryFn:  getVisibleProducts,
    staleTime: 10 * 60 * 1000,
  })

  // Customer's per-product pricing
  const { pricingMap, isLoading: pricingLoading } = useCustomerProductPricing(customerId)

  // Recent product IDs (priced products only — for quick-add)
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

  // Submit quote request mutation
  const submitRequest = useMutation({
    mutationFn: async () => {
      if (!companyId || cartItems.size === 0) return
      const items = Array.from(cartItems.values()).map((p) => ({
        productId:   p.id,
        productName: p.name,
      }))
      await addDoc(collection(db, 'quoteRequests'), {
        companyId,
        requestedBy:  user?.id ?? '',
        status:       'pending',
        type:         'catalog_quote_request',
        items,
        requestedAt:  serverTimestamp(),
      })
    },
    onSuccess: () => {
      setSubmitted(true)
      setCartItems(new Map())
    },
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

  const handleCartToggle = useCallback((product: Product) => {
    setCartItems((prev) => {
      const next = new Map(prev)
      if (next.has(product.id)) next.delete(product.id)
      else next.set(product.id, product)
      return next
    })
    setSubmitted(false)
  }, [])

  const handleCartRemove = useCallback((id: string) => {
    setCartItems((prev) => {
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  }, [])

  // Filter out Fees (admin/sales only)
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

  // Recently-ordered priced products only
  const recentProducts = recentProductIds
    .map((id) => filtered.find((p) => p.id === id))
    .filter((p): p is Product => !!p && pricingMap.has(p.id))
    .slice(0, 6)

  // Group by category
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

  const cartArray = Array.from(cartItems.values())
  const cartIds   = new Set(cartItems.keys())
  const error     = productsError ? 'Unable to load products. Please try again.' : ''

  return (
    <div className="mp-page">
      {/* Page header */}
      <div className="mp-header">
        <div>
          <h1 className="mp-header__title">My Products</h1>
          <p className="mp-header__sub">Your products and negotiated pricing</p>
        </div>
        <div className="mp-search">
          <svg className="mp-search__icon" width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M11 11L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            className="mp-search__input"
            placeholder="Search products…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search products"
          />
        </div>
      </div>

      {error && <div className="mp-error" role="alert">{error}</div>}

      {productsLoading || pricingLoading ? (
        <div className="mp-loading" aria-live="polite">Loading products…</div>
      ) : filtered.length === 0 ? (
        <div className="mp-empty">
          {search ? `No products match "${search}".` : 'No products available yet.'}
        </div>
      ) : (
        <div className="mp-content">
          <div className="mp-list-header" aria-hidden="true">
            <span>Product</span>
            <span>Your Price</span>
            <span />
          </div>

          <div className="mp-categories">
            {/* Recently ordered (priced only) */}
            {recentProducts.length > 0 && !search && (
              <section className="mp-category" aria-label="Recently ordered">
                <div className="mp-category__header mp-category__header--static">
                  <h2 className="mp-category__title">Recently ordered</h2>
                  <div className="mp-category__meta">
                    <span className="mp-category__count mp-category__count--recent">Quick add</span>
                  </div>
                </div>
                <div className="mp-category__list" role="rowgroup">
                  {recentProducts.map((p) => {
                    const pricing = pricingMap.get(p.id)!
                    return <PricedRow key={p.id} product={p} pricing={pricing} onOrder={handleOrder} />
                  })}
                </div>
              </section>
            )}

            {Object.entries(grouped).map(([cat, rows]) => (
              <CategorySection
                key={cat}
                category={cat}
                products={rows}
                pricingMap={pricingMap}
                cartIds={cartIds}
                collapsed={collapsed.has(cat)}
                onToggle={() => toggleCategory(cat)}
                onOrder={handleOrder}
                onCartToggle={handleCartToggle}
              />
            ))}
          </div>
        </div>
      )}

      {/* Floating quote-request cart bar */}
      <CartBar
        items={cartArray}
        submitting={submitRequest.isPending}
        submitted={submitted}
        onRemove={handleCartRemove}
        onSubmit={() => submitRequest.mutate()}
      />
    </div>
  )
}

export default MyProducts
