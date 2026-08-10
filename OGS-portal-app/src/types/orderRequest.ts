export type OrderRequestStatus = 'new' | 'reviewed' | 'converted' | 'archived'

export interface OrderRequest {
  id: string
  name: string
  phone: string
  email: string
  company?: string | null
  deliveryAddress?: string | null
  preferredDeliveryDate?: string | null
  requestedItems: string[]
  requestDetails?: string | null
  sourceUrl?: string | null
  status: OrderRequestStatus
  createdAt?: import('firebase/firestore').Timestamp
  updatedAt?: import('firebase/firestore').Timestamp
  reviewedAt?: import('firebase/firestore').Timestamp
  reviewedBy?: string | null
}
