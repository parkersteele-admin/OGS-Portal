# Stripe Testing Guide — OGS Portal

> **Scope**: Local development and staging environments only.  
> All test credentials below are Stripe-provided and never hit real payment networks.

---

## Test Card Numbers

Use any future expiry date (e.g. `12/34`) and any 3-digit CVC.

| Card Number | Outcome | Notes |
|---|---|---|
| `4242 4242 4242 4242` | ✅ Payment succeeds | Standard Visa success path |
| `4000 0000 0000 9995` | ❌ Insufficient funds | Triggers `payment_intent.payment_failed` |
| `4000 0000 0000 0002` | ❌ Card declined | Generic decline |
| `4000 0025 0000 3155` | 🔐 Requires 3D Secure | Use to test the 3DS authentication flow |
| `4000 0000 0000 3220` | 🔐 3DS — succeeds after auth | Card passes after completing 3DS challenge |
| `4000 0000 0000 9979` | ❌ Stolen card | Stripe decline code `stolen_card` |

### Billing details

Any name, any valid-format address — Stripe test mode does not validate billing address.

---

## ACH / US Bank Account Test Credentials

Select "US bank account" in the PaymentElement, then enter:

| Routing Number | Account Number | Outcome |
|---|---|---|
| `110000000` | `000123456789` | ✅ Succeeds (instant verification) |
| `110000000` | `000111111116` | ❌ Fails (account closed) |
| `110000000` | `000111111113` | ❌ Insufficient funds |

---

## Webhook Local Testing — Stripe CLI

### 1. Install the Stripe CLI

```bash
brew install stripe/stripe-cli/stripe
```

### 2. Authenticate

```bash
stripe login
```

Follow the browser prompt to authorise your Stripe account.

### 3. Start the local listener

Choose the target based on your environment:

**With Firebase Emulators running (`VITE_USE_EMULATORS=true`)**
```bash
stripe listen --forward-to localhost:5001/ogs-portal/us-central1/stripeWebhook
```

**Against the live dev project (`ogs-portal`)**
```bash
stripe listen --forward-to https://us-central1-ogs-portal.cloudfunctions.net/stripeWebhook
```

**Against the production project (`ogs-portal-prod`)**
```bash
stripe listen --forward-to https://us-central1-ogs-portal-prod.cloudfunctions.net/stripeWebhook
```

The CLI prints a webhook signing secret (`whsec_...`).  
Copy it into the relevant `.env` / Firebase secret:

```
STRIPE_WEBHOOK_SECRET=whsec_<value printed by CLI>
```

### 4. Trigger test events

```bash
# Successful payment
stripe trigger payment_intent.succeeded

# Failed payment (insufficient funds)
stripe trigger payment_intent.payment_failed

# Subscription cancelled
stripe trigger customer.subscription.deleted
```

### 5. Trigger with custom metadata

The handlers look for `invoiceId` in `PaymentIntent.metadata`.  To test against a real invoice:

```bash
stripe payment_intents create \
  --amount=15000 \
  --currency=usd \
  --metadata[invoiceId]=inv_YOURFIRESTOREID \
  --metadata[customerId]=cust_YOURFIRESTOREID \
  --metadata[invoiceNumber]=INV-001 \
  --confirm \
  --payment-method=pm_card_visa
```

---

## Dev Browser Helpers (`stripe-test-helpers.ts`)

Available **only in development** (`import.meta.env.DEV`).  
Throws at import time in production builds.

```typescript
import {
  createTestInvoice,
  simulateAutopayCharge,
  simulatePaymentFailure,
  TEST_PAYMENT_METHODS,
} from '@/utils/stripe-test-helpers'
```

### `createTestInvoice(customerId, amount?)`

Creates a `status: 'sent'` invoice in Firestore with a single test line item.

```typescript
// $150 invoice for customer 'cust_abc123'
const invoice = await createTestInvoice('cust_abc123', 150)
console.log(invoice.id)  // Firestore doc ID
```

### `simulateAutopayCharge(invoiceId)`

Calls `createStripePaymentIntent` then confirms immediately using `pm_card_visa`.  
Requires the Stripe CLI listener to be forwarding events so the webhook fires.

```typescript
await simulateAutopayCharge(invoice.id)
// Watch Firestore: invoices/<id>.status → 'paid'
```

### `simulatePaymentFailure(invoiceId)`

Logs the client secret and guidance to confirm with the failure test card.  
Use the card `4000 0000 0000 9995` in the PaymentElement, or trigger via CLI.

```typescript
await simulatePaymentFailure(invoice.id)
// Watch Firestore: invoices/<id>.status → 'payment_failed'
```

---

## Running Unit Tests

```bash
cd functions

# Run once
npm test

# Watch mode
npm run test:watch

# With coverage report
npm run test:coverage
```

Tests live in `functions/src/__tests__/stripe.test.ts`.

### What is covered

| Test group | Scenarios |
|---|---|
| HTTP guards | `GET` → 405; missing signature → 400; bad signature → 400 |
| Idempotency | Duplicate `evt_` ID → 200 `{ duplicate: true }` |
| `payment_intent.succeeded` | Marks invoice `paid`; creates `payments` doc; skips already-paid invoice; sends receipt email; tolerates email failure |
| `payment_intent.payment_failed` | Sets `payment_failed` status + failure reason; creates high-priority dispatch notification; sets `autopayFollowUpFlag` on autopay customers; skips flag when autopay is off |

---

## End-to-End Checklist

1. `npm run emulate` — start Firebase emulators
2. `stripe listen --forward-to localhost:5001/ogs-portal/us-central1/stripeWebhook` — start CLI listener
3. Open `http://localhost:5173/portal/invoices` — log in as a customer
4. Open an invoice and navigate to the **Pay** page
5. Enter test card `4242 4242 4242 4242` — watch invoice flip to `Paid`
6. Repeat with `4000 0000 0000 9995` — watch invoice flip to `Payment failed`
7. Check the browser Notifications panel for in-app alerts
8. Check the dispatch user's notifications for the staff alert
