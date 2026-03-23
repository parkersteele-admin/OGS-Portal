# Customer Journey — OGS Portal

*How a new customer moves from first contact to active account.*

---

## Overview

```
Website Signup → Onboarding (5 steps) → OGS Reviews Lead → Quote Sent → Pricing Unlocked → Active Customer
```

---

## Phase 1 — Signup (`/signup`)

The customer discovers Ohio Gas Supply and creates an account on the public signup page.

**What the customer provides:**
- Company / business name
- Full name
- Email address
- Phone number
- Password

**What happens automatically:**
1. Firebase Auth account is created with the `owner` role
2. A `customers/{companyId}` Firestore document is created (`setupComplete: false`, `pricingUnlocked: undefined`)
3. The `onCustomerCreated` Cloud Function fires and creates a `leads/{companyId}` document with `status: 'pending_setup'` and `isWebSignup: true`
4. The OGS dispatch team receives an internal notification email
5. The new lead appears in the CRM **Leads** board under the **Website Signups** (Pending Setup) column

**Duplicate detection:** If the company name or email domain matches an existing account, the customer is prompted to request to join the existing company instead of creating a duplicate.

**Destination:** Customer is redirected to `/portal/onboarding`

---

## Phase 2 — Onboarding (`/portal/onboarding`)

The customer completes a 5-step guided setup wizard. If they leave partway through, the dashboard shows a banner to resume where they left off.

### Step 1 — Business Information
- Legal company name, billing address
- Business type (medical, industrial, restaurant, etc.)
- Tax exempt status & certificate upload
- TDDD number (if medical/dental)

### Step 2 — Delivery Setup
- One or more delivery locations
- Address, site access notes, cylinder storage type
- Each location is saved as `customers/{id}/locations/{locationId}`

### Step 3 — Gas Usage & Products
- Which gas products they currently use (CO₂, Nitrogen, Beer Gas)
- Approximate tank sizes and quantities
- Current supplier (important context for OGS pricing decisions)

### Step 4 — Payment & Notifications
- Payment method preference:
  - **COD** — pay at time of delivery
  - **Credit Card on File** — card saved, charged on delivery
  - **ACH Autopay** — bank account auto-debited on invoice date
  - **Net 30** — monthly invoicing (requires credit approval)
- Card/ACH setup (if applicable) via Stripe
- SMS notification opt-in for delivery updates

### Step 5 — Review & Submit
- Customer reviews all entered information
- On submit: `setupComplete` is set to `true`, company status moves to `pending_quote`
- A `quoteRequests/{id}` document is created in Firestore
- OGS dispatch receives a "New Quote Request" email with a link to the customer record

**Destination:** Customer lands on `/portal/dashboard`

---

## Phase 3 — OGS Reviews the Lead (CRM)

While the customer waits, the OGS sales team works the account in the CRM.

**What the sales team sees:**
- The lead appears in `/crm/leads` under the **Pending Setup** → **New** progression
- The "Website" badge identifies web signups vs. manually created leads
- The customer record shows a **🔒 Pricing Locked** badge

**What the customer sees (`/portal/dashboard`):**
- A banner prompting them to complete onboarding (if not done)
- Their tanks, invoices, and orders sections (all empty at this stage)
- The **Products** nav item and **New Order** button are present but will show the pricing gate if clicked

**Pricing gate:** Until pricing is explicitly unlocked, the customer sees a "Pricing not yet available" screen on `/portal/catalog` and `/portal/order` with a message to contact the sales team.

---

## Phase 4 — Quote Sent

A sales rep builds a quote in `/crm/quotes` and clicks **Send**.

**What happens automatically:**
1. The quote `status` is set to `sent` in Firestore
2. The `onQuoteSent` Cloud Function fires on the `quotes/{quoteId}` document
3. `pricingUnlocked: true` is written to `customers/{companyId}`
4. The customer's portal immediately unlocks — the pricing gate is removed

**What the customer receives:**
- An email notification that their quote is ready (if configured)
- Access to the full product catalog and order wizard

The sales team can also **manually unlock or re-lock pricing** at any time using the 🔒/🔓 Pricing toggle button on the customer record in the CRM.

---

## Phase 5 — Active Customer (`/portal`)

The customer now has full portal access.

| Page | Path | What it does |
|------|------|--------------|
| Dashboard | `/portal/dashboard` | Tanks, balance, recent orders & invoices |
| New Order | `/portal/order` | Multi-item order wizard (off-route, or standing route schedule) |
| My Orders | `/portal/orders` | Order history with status tracking |
| Invoices | `/portal/invoices` | Open & paid invoices, pay online |
| Autopay | `/portal/autopay` | Set up / manage ACH or card autopay |
| My Tanks | `/portal/tanks` | Deployed tanks with current fill levels, report button |
| Products | `/portal/catalog` | Full product catalog with pricing, quick-add to order |
| My Profile | `/portal/profile` | Name, phone, notification prefs |
| Team | `/portal/settings/team` | Invite team members, manage company users |

### Ongoing Customer Actions
- **Report a tank level** → visible on dashboard and tanks page, triggers low-level alerts
- **Place an order** → off-route (one-time) or route (recurring schedule)
- **Pay an invoice** → online via Stripe from the invoices page
- **Autopay** → set up once, auto-charged on invoice date
- **Invite team members** → owner/manager roles can invite others to the company account

---

## OGS Internal Flow (parallel)

| Trigger | OGS Action |
|---------|-----------|
| New signup | Lead appears in CRM `/crm/leads` — Pending Setup column |
| Onboarding complete | Dispatch email + quote request created in Firestore |
| Sales rep reviews | Lead moves through pipeline: New → Contacted → Qualified → Proposal |
| Quote built & sent | Pricing automatically unlocked for the customer |
| Quote accepted | Lead marked Won; customer is fully active |
| Delivery completed | `onDeliveryComplete` trigger updates tank levels and creates invoice |
| Invoice generated | Customer receives email notification |

---

## Key Firestore Documents Created During Journey

| Collection | Document | Created When |
|-----------|----------|-------------|
| `customers/{companyId}` | Company profile | Signup |
| `users/{uid}` | Portal user account | Signup |
| `leads/{companyId}` | CRM lead record | Signup (via CF trigger) |
| `quoteRequests/{id}` | Quote request snapshot | Step 5 submit |
| `quotes/{quoteId}` | Formal quote | Sales rep creates in CRM |
| `customers/{id}/locations/{id}` | Delivery locations | Step 2 |
| `customers/{id}/tanks/{id}` | Tanks | Provisioned by OGS operations |
| `orders/{orderId}` | Customer orders | Customer places order |
| `invoices/{invoiceId}` | Invoices | Delivery completed |
