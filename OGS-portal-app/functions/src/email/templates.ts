/**
 * functions/src/email/templates.ts
 *
 * SendGrid dynamic template ID registry for OGS Portal.
 *
 * How to set up a template:
 *  1. Log in to app.sendgrid.com → Email API → Dynamic Templates → Create Template
 *  2. Add a version, set the subject line, build the HTML using Handlebars variables
 *  3. Copy the template ID (d-xxxx…) and paste it below
 *  4. Deploy functions — the ID is read at runtime, no redeploy needed if you
 *     only change template content in the SendGrid dashboard.
 *
 * Each template constant documents its required dynamic template data variables.
 * Pass matching keys in the `dynamicData` argument to `sendTemplateEmail`.
 */

// ── Template IDs ───────────────────────────────────────────────────────────────
// Replace each placeholder with the real template ID from the SendGrid dashboard.

/**
 * Order confirmation sent to the customer immediately after an order is created.
 *
 * Subject (set in SendGrid): "Order confirmed — OGS Portal"
 *
 * Dynamic data variables:
 *   customerName    string  — "Alice Nguyen"
 *   orderNumber     string  — "ORD-00042"
 *   product         string  — "Propane"
 *   quantity        number  — 200
 *   deliveryTier    string  — "standard" | "next-day" | "same-day"
 *   estimatedDate   string  — human-readable date, e.g. "March 18, 2026"
 *   total           string  — formatted currency, e.g. "$284.00"
 */
export const TEMPLATE_ORDER_CONFIRMATION = 'd-ORDER_CONFIRMATION_TEMPLATE_ID'

/**
 * Delivery confirmation sent after the driver marks the stop complete.
 *
 * Subject: "Your gas was delivered — OGS Portal"
 *
 * Dynamic data variables:
 *   customerName       string  — "Alice Nguyen"
 *   product            string  — "Propane"
 *   quantityDelivered  number  — 195
 *   deliveredAt        string  — formatted datetime, e.g. "March 18, 2026 at 10:42 AM"
 *   invoiceLink        string  — full URL to the invoice pay page
 */
export const TEMPLATE_DELIVERY_CONFIRMATION = 'd-DELIVERY_CONFIRMATION_TEMPLATE_ID'

/**
 * Invoice issued — sent when an invoice is moved to 'sent' status.
 *
 * Subject: "Invoice #{{invoiceNumber}} from Ohio Gas Supply"
 *
 * Dynamic data variables:
 *   customerName   string       — "Alice Nguyen"
 *   invoiceNumber  string       — "INV-0042"
 *   total          string       — "$284.00"
 *   dueDate        string       — "April 1, 2026"
 *   payLink        string       — full URL to PayInvoicePage
 *   lineItems      object[]     — [{ description, quantity, amount }]
 */
export const TEMPLATE_INVOICE_ISSUED = 'd-INVOICE_ISSUED_TEMPLATE_ID'

/**
 * Payment received confirmation.
 *
 * Subject: "Payment received — OGS Portal"
 *
 * Dynamic data variables:
 *   customerName   string  — "Alice Nguyen"
 *   amount         string  — "$284.00"
 *   invoiceNumber  string  — "INV-0042"
 *   receiptLink    string  — full URL to invoice PDF or pay page
 */
export const TEMPLATE_PAYMENT_RECEIVED = 'd-PAYMENT_RECEIVED_TEMPLATE_ID'

/**
 * Payment failed — action required.
 *
 * Subject: "Payment issue — action required"
 *
 * Dynamic data variables:
 *   customerName  string  — "Alice Nguyen"
 *   amount        string  — "$284.00"
 *   reason        string  — e.g. "Your card has insufficient funds."
 *   retryLink     string  — full URL to PayInvoicePage
 */
export const TEMPLATE_PAYMENT_FAILED = 'd-PAYMENT_FAILED_TEMPLATE_ID'

/**
 * Low tank alert sent to the customer.
 *
 * Subject: "Your {{gasType}} cylinder is running low"
 *
 * Dynamic data variables:
 *   customerName  string  — "Alice Nguyen"
 *   gasType       string  — "Propane" | "Natural Gas"
 *   levelPct      number  — 18
 *   orderLink     string  — full URL to the new-order page
 */
export const TEMPLATE_LOW_TANK_ALERT = 'd-LOW_TANK_ALERT_TEMPLATE_ID'

/**
 * Order estimate sent to the customer.
 *
 * Subject: "Order estimate from Ohio Gas Supply"
 *
 * Dynamic data variables:
 *   customerName    string  — "Alice Nguyen"
 *   orderNumber     string  — "ORD-00042"
 *   product         string  — "Propane"
 *   quantity        number  — 200
 *   deliveryTier    string  — "standard" | "next-day" | "same-day"
 *   estimatedDate   string  — human-readable date, e.g. "March 18, 2026"
 *   subtotal        string  — formatted currency, e.g. "$500.00"
 *   deliveryFee     string  — formatted currency, e.g. "$0.00"
 *   total           string  — formatted currency, e.g. "$500.00"
 *   lineItems       object[] — [{ description, quantity, unitPrice, amount }]
 */
export const TEMPLATE_ORDER_ESTIMATE = 'd-ORDER_ESTIMATE_TEMPLATE_ID'
