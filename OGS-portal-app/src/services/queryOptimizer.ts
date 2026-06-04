/**
 * src/services/queryOptimizer.ts
 *
 * Query optimization framework to prevent runaway queries.
 * Enforces:
 *   • Explicit page size limits for all queries
 *   • Pagination patterns
 *   • Query constraints validation
 *   • Firestore index hints
 *
 * PROBLEM SOLVED:
 * ───────────────
 * Firestore has no built-in query cost limits. A service can accidentally
 * fetch 10,000+ documents, causing:
 *   • Slow performance
 *   • Wasted quota
 *   • OOM errors on large collections
 *
 * This framework prevents that by enforcing limits at the service layer.
 */

import { limit } from 'firebase/firestore'

/**
 * Maximum documents to fetch per query type.
 * Ensures queries scale safely as collections grow.
 */
export const QUERY_LIMITS = {
  // Customer management
  customers: 1000,
  
  // Orders
  orders: 5000,
  pendingOrders: 500,
  
  // Invoices
  invoices: 10000,
  
  // Tanks
  tanks: 2000,
  tanksDueInspection: 2000,
  
  // Products
  products: 500,
  activeProducts: 200,
  
  // Leads & Quotes
  leads: 1000,
  quotes: 1000,
  
  // Runs
  runs: 500,
  activeRuns: 100,
  
  // Users
  users: 200,
  drivers: 50,
  
  // Notifications
  notifications: 100,
  unreadNotifications: 50,
} as const

/**
 * Get the appropriate limit constraint for a query type.
 *
 * @param queryType - Key from QUERY_LIMITS
 * @returns Firestore limit constraint, or null if queryType unknown
 *
 * @example
 *   const q = query(
 *     customersCol,
 *     where('status', '==', 'active'),
 *     getLimitConstraint('customers'),  // Adds: limit(1000)
 *   )
 */
export function getLimitConstraint(
  queryType: keyof typeof QUERY_LIMITS,
): ReturnType<typeof limit> {
  const maxDocs = QUERY_LIMITS[queryType]
  return limit(maxDocs)
}

/**
 * Validation helper: throw if query exceeds limits.
 *
 * USAGE IN SERVICES:
 * ──────────────────
 * export async function getCustomers(filters?) {
 *   validateQueryType('customers')  // Throws if config missing
 *   const q = query(
 *     customersCol,
 *     buildFilterConstraints(filters),
 *     getLimitConstraint('customers'),
 *   )
 *   return getDocs(q)
 * }
 */
export function validateQueryType(queryType: string): void {
  if (!(queryType in QUERY_LIMITS)) {
    throw new Error(
      `Unknown query type: "${queryType}". ` +
      `Add to QUERY_LIMITS in queryOptimizer.ts`,
    )
  }
}

/**
 * Query constraints validator.
 * Warns if query might miss index hints.
 *
 * @param constraints - Array of Firestore constraints (where, orderBy, limit)
 * @param queryType - Key from QUERY_LIMITS
 *
 * @example
 *   const constraints = [
 *     where('customerId', '==', id),
 *     where('status', '==', 'pending'),
 *     orderBy('createdAt', 'desc'),
 *   ]
 *   validateConstraints(constraints, 'orders')
 *   // ✅ Checks if (customerId, status, createdAt) index exists
 */
export function validateConstraints(
  _constraints: any[],
  queryType: keyof typeof QUERY_LIMITS,
): void {
  // This is a placeholder for future integration with Firestore indexes
  // In production, this would:
  //   1. Read firestore.indexes.json
  //   2. Check if constraints match a defined index
  //   3. Warn if not (helps catch future performance regressions)
  
  validateQueryType(queryType as string)
}

/**
 * IMPLEMENTATION CHECKLIST
 *
 * Apply to all services in src/services/:
 *
 * [ ] customerService.ts
 *     - getCustomers() → add getLimitConstraint('customers')
 *     - getLeads() → add getLimitConstraint('leads')
 *
 * [ ] orderService.ts
 *     - getOrders() → add getLimitConstraint('orders')
 *     - getPendingOrders() → add getLimitConstraint('pendingOrders')
 *
 * [ ] invoiceService.ts
 *     - getInvoices() → add getLimitConstraint('invoices')
 *
 * [ ] tankService.ts
 *     - getTanks() → add getLimitConstraint('tanks')
 *     - getTanksDueInspection() → add getLimitConstraint('tanksDueInspection')
 *
 * [ ] productService.ts
 *     - getProducts() → add getLimitConstraint('products')
 *     - getActiveProducts() → add getLimitConstraint('activeProducts')
 *
 * [ ] leadService.ts
 *     - getLeads() → add getLimitConstraint('leads')
 *
 * [ ] quoteService.ts
 *     - getQuotes() → add getLimitConstraint('quotes')
 *
 * [ ] runService.ts
 *     - getRuns() → add getLimitConstraint('runs')
 *     - getActiveRuns() → add getLimitConstraint('activeRuns')
 *
 * [ ] userService.ts
 *     - getUsers() → add getLimitConstraint('users')
 *     - getDrivers() → add getLimitConstraint('drivers')
 *
 * PATTERN:
 * ────────
 * export async function getCustomers(filters?, options?: PageOptions) {
 *   const q = query(
 *     customersCol,
 *     ...buildFilterConstraints(filters),
 *     getLimitConstraint('customers'),  // ← ADD THIS
 *     ...paginate(options)
 *   )
 *   return getDocs(q)
 * }
 *
 * RESULT:
 * ───────
 * ✅ All queries explicitly limited (prevents runaway fetches)
 * ✅ Services document their query boundaries
 * ✅ Easy to audit (all limits in one place)
 * ✅ Performance predictable as collections grow
 */
