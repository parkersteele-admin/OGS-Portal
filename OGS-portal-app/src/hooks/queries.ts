/**
 * src/hooks/queries.ts
 *
 * TanStack Query hooks for non-realtime Firestore data.
 * All hooks follow the same pattern:
 *   - typed queryKey for cache isolation and invalidation
 *   - 2-minute staleTime (data is considered fresh for 2 min after fetch)
 *   - errors surface through TanStack Query's standard { error } return
 */

import { useQuery, type UseQueryOptions } from '@tanstack/react-query'
import {
  getCustomer,
  getCustomers,
  type CustomerFilters,
} from '../services/customerService'
import {
  getOrder,
  getOrders,
  type OrderFilters,
} from '../services/orderService'
import {
  getInvoice,
  getInvoices,
  type InvoiceFilters,
} from '../services/invoiceService'
import {
  getTank,
  getTanks,
  getTanksDueForInspection,
  type TankFilters,
} from '../services/tankService'
import {
  getLead,
  getLeads,
  type LeadFilters,
} from '../services/leadService'
import { type PageOptions, type Page } from '../services/base'
import type { Customer } from '../types/customer'
import type { Order } from '../types/order'
import type { Invoice } from '../types/billing'
import type { Tank } from '../types/tank'
import type { Lead } from '../types/crm'

const STALE_TIME = 2 * 60 * 1000 // 2 minutes

// ── Query key factories ───────────────────────────────────────────────────────
// Centralised so invalidation calls can match exactly.

export const queryKeys = {
  customers:  {
    all:     (filters?: CustomerFilters)    => ['customers', filters ?? {}] as const,
    detail:  (id: string)                   => ['customers', id]            as const,
  },
  orders: {
    all:     (filters?: OrderFilters)       => ['orders',    filters ?? {}] as const,
    detail:  (id: string)                   => ['orders',    id]            as const,
  },
  invoices: {
    all:     (filters?: InvoiceFilters)     => ['invoices',  filters ?? {}] as const,
    detail:  (id: string)                   => ['invoices',  id]            as const,
  },
  tanks: {
    all:     (filters?: TankFilters)        => ['tanks',     filters ?? {}] as const,
    detail:  (id: string)                   => ['tanks',     id]            as const,
    inspections: (days: number)             => ['tanks', 'inspections', days] as const,
  },
  leads: {
    all:     (filters?: LeadFilters)        => ['leads',     filters ?? {}] as const,
    detail:  (id: string)                   => ['leads',     id]            as const,
  },
} as const

// ── Customers ─────────────────────────────────────────────────────────────────

export function useCustomers(
  filters?: CustomerFilters,
  pageOptions?: PageOptions,
  options?: Omit<UseQueryOptions<Page<Customer>>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey:  queryKeys.customers.all(filters),
    queryFn:   () => getCustomers(filters, pageOptions),
    staleTime: STALE_TIME,
    ...options,
  })
}

export function useCustomer(
  id: string | null | undefined,
  options?: Omit<UseQueryOptions<Customer>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: queryKeys.customers.detail(id ?? ''),
    queryFn:  () => getCustomer(id!),
    enabled:  !!id,
    staleTime: STALE_TIME,
    ...options,
  })
}

// ── Orders ────────────────────────────────────────────────────────────────────

export function useOrders(
  filters?: OrderFilters,
  pageOptions?: PageOptions,
  options?: Omit<UseQueryOptions<Page<Order>>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey:  queryKeys.orders.all(filters),
    queryFn:   () => getOrders(filters, pageOptions),
    staleTime: STALE_TIME,
    ...options,
  })
}

export function useOrder(
  id: string | null | undefined,
  options?: Omit<UseQueryOptions<Order>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: queryKeys.orders.detail(id ?? ''),
    queryFn:  () => getOrder(id!),
    enabled:  !!id,
    staleTime: STALE_TIME,
    ...options,
  })
}

// ── Invoices ──────────────────────────────────────────────────────────────────

export function useInvoices(
  filters?: InvoiceFilters,
  pageOptions?: PageOptions,
  options?: Omit<UseQueryOptions<Page<Invoice>>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey:  queryKeys.invoices.all(filters),
    queryFn:   () => getInvoices(filters, pageOptions),
    staleTime: STALE_TIME,
    ...options,
  })
}

export function useInvoice(
  id: string | null | undefined,
  options?: Omit<UseQueryOptions<Invoice>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: queryKeys.invoices.detail(id ?? ''),
    queryFn:  () => getInvoice(id!),
    enabled:  !!id,
    staleTime: STALE_TIME,
    ...options,
  })
}

// ── Tanks ─────────────────────────────────────────────────────────────────────

export function useTanks(
  filters?: TankFilters,
  pageOptions?: PageOptions,
  options?: Omit<UseQueryOptions<Page<Tank>>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey:  queryKeys.tanks.all(filters),
    queryFn:   () => getTanks(filters, pageOptions),
    staleTime: STALE_TIME,
    ...options,
  })
}

export function useTank(
  id: string | null | undefined,
  options?: Omit<UseQueryOptions<Tank>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: queryKeys.tanks.detail(id ?? ''),
    queryFn:  () => getTank(id!),
    enabled:  !!id,
    staleTime: STALE_TIME,
    ...options,
  })
}

export function useTanksDueForInspection(
  days = 30,
  options?: Omit<UseQueryOptions<Tank[]>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey:  queryKeys.tanks.inspections(days),
    queryFn:   () => getTanksDueForInspection(days),
    staleTime: STALE_TIME,
    ...options,
  })
}

// ── Leads ─────────────────────────────────────────────────────────────────────

export function useLeads(
  filters?: LeadFilters,
  pageOptions?: PageOptions,
  options?: Omit<UseQueryOptions<Page<Lead>>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey:  queryKeys.leads.all(filters),
    queryFn:   () => getLeads(filters, pageOptions),
    staleTime: STALE_TIME,
    ...options,
  })
}

export function useLead(
  id: string | null | undefined,
  options?: Omit<UseQueryOptions<Lead>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: queryKeys.leads.detail(id ?? ''),
    queryFn:  () => getLead(id!),
    enabled:  !!id,
    staleTime: STALE_TIME,
    ...options,
  })
}
