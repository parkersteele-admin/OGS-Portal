# Stripe Production Go-Live Checklist — OGS Portal

> Complete every item before switching `VITE_APP_ENV=production`.  
> Check off items as you complete them.

---

## Account Setup

- [ ] Stripe account activated and verified (Ohio Gas Supply Co.)
- [ ] Business details complete (EIN, bank account, address)
- [ ] Stripe Radar fraud rules configured
- [ ] ACH / bank transfer enabled in Stripe dashboard  
  *(Dashboard → Settings → Payment methods → US bank account)*

---

## Keys + Secrets

- [ ] Production publishable key added to GitHub secret `VITE_STRIPE_PUBLISHABLE_KEY_PROD`
- [ ] Production secret key added to Firebase Secret `STRIPE_SECRET_KEY`  
  *(Firebase console → ogs-portal-prod → Secret Manager)*
- [ ] Production webhook endpoint created in the Stripe dashboard

  | Environment | URL |
  |---|---|
  | Dev / staging | `https://us-central1-ogs-portal-dev.cloudfunctions.net/stripeWebhook` |
  | Production | `https://us-central1-ogs-portal-prod.cloudfunctions.net/stripeWebhook` |

- [ ] Webhook signing secret added to Firebase Secret `STRIPE_WEBHOOK_SECRET`  
  *(copy the `whsec_…` value shown after creating the endpoint)*

---

## Webhook Events to Subscribe

Enable these events on the production webhook endpoint in the Stripe dashboard:

- [ ] `payment_intent.succeeded`
- [ ] `payment_intent.payment_failed`
- [ ] `setup_intent.succeeded`
- [ ] `customer.updated`

---

## Testing in Production

Run these checks immediately after go-live before opening the portal to customers:

- [ ] Process one real **$0.50** charge using a live card and immediately refund it  
  *(confirm the Payment shows in Dashboard → Payments)*
- [ ] Verify the webhook events appear in Stripe Dashboard → Developers → Webhooks → Recent deliveries
- [ ] Verify the test invoice flips to `paid` in Firestore (`invoices/{id}.status`)
- [ ] Verify the customer receives the receipt email

---

## Monitoring

- [ ] Enable Stripe email alerts for failed payments  
  *(Dashboard → Settings → Notifications → Failed payments)*
- [ ] Schedule a monthly review of Stripe Radar fraud rules  
  *(Dashboard → Radar → Rules)*
- [ ] Set up a Slack or email alert on Firebase Functions error rate  
  *(Google Cloud → Monitoring → Alert policies → Cloud Functions → `stripeWebhook`)*
