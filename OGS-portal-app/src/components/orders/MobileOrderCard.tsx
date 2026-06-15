import { useEffect, useMemo, useState } from 'react'
import ReactDOM from 'react-dom'
import { MoreHorizontal, Phone, type LucideIcon } from 'lucide-react'
import type { Order, OrderStatus } from '../../types/order'
import './MobileOrderCard.css'

const STATUS_COLORS: Record<OrderStatus, string> = {
  pending: '#92400e',
  scheduled: '#1e40af',
  assigned: '#3730a3',
  'in-transit': '#9d174d',
  delivered: '#065f46',
  ready_to_invoice: '#FF6A00',
  invoice_sent: '#0066FF',
  invoiced: '#00B7FF',
  paid: '#16a34a',
  cancelled: '#6b7280',
  archived: '#6b7280',
}

const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Pending',
  scheduled: 'Scheduled',
  assigned: 'Assigned',
  'in-transit': 'In Transit',
  delivered: 'Delivered',
  ready_to_invoice: 'Ready to Invoice',
  invoice_sent: 'Invoice Sent',
  invoiced: 'Invoiced',
  paid: 'Paid',
  cancelled: 'Cancelled',
  archived: 'Archived',
}

const COLLAPSED_DEFAULT: OrderStatus[] = ['delivered', 'ready_to_invoice', 'invoice_sent', 'paid']

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(n)
}

function fmtDate(order: Order): string {
  const ts = order.scheduledAt ?? order.deliveredAt ?? order.requestedAt
  if (!ts?.toDate) return '—'
  return ts.toDate().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export interface MobileOrderCardProps {
  order: Order;
  primaryAction?: {
    label: string;
    icon: LucideIcon;
    onClick: () => void;
  };
  secondaryActions?: Array<{
    label: string;
    icon: LucideIcon;
    onClick: () => void;
    destructive?: boolean;
  }>;
  expanded?: boolean;
}

export function MobileOrderCard({
  order,
  primaryAction,
  secondaryActions = [],
  expanded,
}: MobileOrderCardProps) {
  const orderView = order as Order & {
    customerName?: string
    productName?: string
    productUnit?: string
    quantityLabel?: number
  }

  const initialExpanded = expanded ?? !COLLAPSED_DEFAULT.includes(order.status)
  const [isExpanded, setIsExpanded] = useState(initialExpanded)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    if (typeof expanded === 'boolean') setIsExpanded(expanded)
  }, [expanded])

  const deliveredQty = Array.isArray(order.deliveredLineItems)
    ? order.deliveredLineItems.reduce((sum, item) => sum + Number(item.qty || 0), 0)
    : 0
  const quantity = orderView.quantityLabel ?? (deliveredQty > 0 ? deliveredQty : order.quantity)
  const productName = orderView.productName ?? order.productId
  const productUnit = orderView.productUnit ?? 'gal'
  const customerName = orderView.customerName ?? order.customerId
  const contactName = order.deliveryContactName || order.receivedByName || 'No contact on file'
  const contactPhone = order.deliveryContactPhone || 'No phone on file'

  const statusColor = STATUS_COLORS[order.status]
  const statusLabel = STATUS_LABELS[order.status]
  const PrimaryIcon = primaryAction?.icon

  const drawer = useMemo(() => {
    if (!menuOpen || secondaryActions.length === 0 || typeof document === 'undefined') return null

    return ReactDOM.createPortal(
      <div className="moc-drawer-overlay" onClick={() => setMenuOpen(false)}>
        <div className="moc-drawer" onClick={(event) => event.stopPropagation()}>
          <div className="moc-drawer__handle" />
          <div className="moc-drawer__actions">
            {secondaryActions.map((action) => {
              const ActionIcon = action.icon
              return (
                <button
                  key={action.label}
                  type="button"
                  className={`moc-drawer__action${action.destructive ? ' moc-drawer__action--danger' : ''}`}
                  onClick={() => {
                    action.onClick()
                    setMenuOpen(false)
                  }}
                >
                  <ActionIcon size={18} aria-hidden="true" />
                  <span>{action.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>,
      document.body,
    )
  }, [menuOpen, secondaryActions])

  return (
    <article className="moc-card" style={{ borderRightColor: statusColor }}>
      {secondaryActions.length > 0 && (
        <button
          type="button"
          className="moc-overflow-btn"
          aria-label="More actions"
          onClick={() => setMenuOpen(true)}
        >
          <MoreHorizontal size={18} aria-hidden="true" />
        </button>
      )}

      <button
        type="button"
        className="moc-summary"
        onClick={() => {
          if (!isExpanded) setIsExpanded(true)
        }}
      >
        <div className="moc-row moc-row--status">
          <span className="moc-status-pill">{statusLabel}</span>
          <strong className="moc-total">{fmtCurrency(order.total)}</strong>
        </div>

        <div className="moc-row moc-row--name">
          <h3 className="moc-customer">{customerName}</h3>
          <span className="moc-date">{fmtDate(order)}</span>
        </div>
      </button>

      {isExpanded && (
        <>
          <p className="moc-product">{productName} · {quantity} {productUnit}</p>
          <p className="moc-contact">
            <Phone size={14} aria-hidden="true" />
            <span>{contactName} · {contactPhone}</span>
          </p>
          {primaryAction && (
            <button
              type="button"
              className="moc-primary-btn"
              onClick={primaryAction.onClick}
            >
              {PrimaryIcon && <PrimaryIcon size={16} aria-hidden="true" />}
              <span>{primaryAction.label}</span>
            </button>
          )}
        </>
      )}
      {drawer}
    </article>
  )
}

export default MobileOrderCard
