/**
 * functions/src/onboardingPackets/psaTemplate.ts
 *
 * Master Product Supply and Equipment Service Agreement (PSA) and the
 * ACH / Credit Card Payment Authorization text used by digital onboarding.
 *
 * This file is the single source of truth: the public signing page renders
 * the text returned by getOnboardingPacketPublic, and the signed PDFs are
 * generated from the same constants. A SHA-256 hash of the exact text a
 * customer saw is stored with their signature.
 *
 * IMPORTANT: Any wording change MUST bump PSA_VERSION / ACH_VERSION. Packets
 * snapshot the version at send time and always render that snapshot, so
 * previously signed agreements are never altered.
 */

export const PSA_VERSION = 'PSA-2026-11-v1'
export const ACH_VERSION = 'ACH-2026-11-v1'

export const PSA_TITLE = 'Product Supply and Equipment Service Agreement'

export const PSA_INTRO =
  'This agreement governs commercial propane deliveries and any equipment supplied by Ohio Gas Supply ' +
  'Co. (Supplier) to the customer identified below (Customer). The service term does not fix prices. Product ' +
  'prices and service charges may change under Section 2.'

export const PSA_RATE_NOTE =
  'Rates below are initial rates only, subject to Section 2. Confirm product size and applicable charges before signing.'

export const PSA_RATE_FOOTNOTE =
  'Only equipment supplied is subject to rental. Taxes are additional. Other charges require prior written disclosure and authorization under Section 2.'

export interface PsaSection {
  number: number
  title: string
  /** Group heading shown above this section (first section of each group only). */
  group: string | null
  paragraphs: string[]
}

export const PSA_SECTIONS: PsaSection[] = [
  {
    "number": 1,
    "title": "Orders and service term",
    "group": "Pricing and payment terms",
    "paragraphs": [
      "This agreement applies to orders accepted by Supplier for the delivery location above. Each order is subject to acceptance, available supply, safe access, and Customer’s credit status. No minimum purchase, exclusive supply obligation, guaranteed volume, or automatic delivery program applies unless expressly agreed in a signed addendum. Customer must monitor its inventory and order with reasonable lead time. Estimated delivery dates are not guaranteed.",
      "After the initial 12-month term, service continues month to month. Either party may terminate on 30 days’ written notice. Sections 8 and 9 permit earlier suspension or termination. Termination does not discharge accrued payment, equipment return or surviving obligations."
    ]
  },
  {
    "number": 2,
    "title": "Variable pricing and changes in charges",
    "group": null,
    "paragraphs": [
      "NO FIXED PRICE COMMITMENT. The initial rate schedule is not a price guarantee for any period. Supplier may increase or decrease propane prices and service charges in good faith to reflect changes in wholesale or terminal propane costs, commodity markets, supply availability, freight, fuel, labor, insurance, equipment, compliance costs, taxes, and other commercially reasonable costs of providing service. Adjustments need not follow a particular index or match an index percentage. No price cap or automatic price reduction applies.",
      "For each delivery, Customer will pay Supplier’s then-current price disclosed before delivery. Supplier may change product pricing as often as market conditions warrant. Product price changes are effective for future deliveries upon written notice to the designated contact before dispatch. For standing orders, Supplier must provide that notice before dispatch; Customer may cancel an undelivered order without penalty before dispatch if it rejects the revised price. No delivery will be dispatched at a changed price if notice has not been provided.",
      "Recurring rental changes require 15 calendar days’ advance written notice. Delivery, hazmat, fuel, emergency, minimum-order, failed-delivery, or other service charges must be disclosed before the affected service and authorized by Customer. New or increased government taxes and mandatory assessments may be passed through at their effective date with notice before the affected delivery. Supplier may combine notices with a quote, order confirmation, or emailed rate schedule; an invoice alone is not advance notice.",
      "Changes apply prospectively and do not reprice completed deliveries. Customer may decline future orders or terminate before a recurring increase takes effect by written notice and arranging equipment return; accrued charges remain due. No signed amendment is needed for changes expressly permitted by this section. A fixed price exists only in a separate writing signed by Supplier that expressly states the product, quantity, price, delivery window, and fixed price expiration. A purchase order or prior invoice does not establish a fixed price."
    ]
  },
  {
    "number": 3,
    "title": "Payment and credit protection",
    "group": null,
    "paragraphs": [
      "Unless approved credit terms appear in the payment terms above, payment is due on delivery. Supplier accepts ACH, cash, credit card, or check, subject to acceptance and clearing. Supplier may require prepayment, a reasonable deposit, cash on delivery, or adequate assurance of payment if Customer is overdue or Supplier reasonably determines its credit has deteriorated. Deposits may be applied to amounts due, with any remaining balance refunded after account settlement and equipment return.",
      "Overdue undisputed balances accrue a simple late charge of 1.5% per month or the maximum lawful rate, whichever is less, only to the extent permitted by law. Customer must promptly identify invoice disputes in writing and pay undisputed amounts when due. Supplier may recover actual returned-payment charges and reasonable collection costs, including attorneys’ fees only where recoverable by law. Payment disputes do not authorize retention of Supplier’s equipment."
    ]
  },
  {
    "number": 4,
    "title": "Delivery and transfer of risk",
    "group": "Delivery safety and equipment",
    "paragraphs": [
      "The order confirmation must identify cylinder size and net fill, or the unit of measure for bulk deliveries. Delivery records establish quantities, absent manifest error. Title to propane and risk of loss pass on completion of delivery at the designated location; Supplier-owned cylinders, cages, dollies, and tanks remain Supplier’s property. Customer must promptly report shortages or visible damage and provide supporting information. Latent defects must be reported promptly after discovery; this does not waive rights that cannot lawfully be waived.",
      "Customer must provide a safe, lawful, unobstructed delivery location, access for delivery and equipment retrieval, adequate storage, and personnel authorized to receive deliveries. Supplier may refuse or postpone delivery because of unsafe conditions, incompatible or uncertified equipment, weather, inaccessible premises, or a suspected leak. Additional trips or emergency service are chargeable only at rates disclosed and authorized before the service."
    ]
  },
  {
    "number": 5,
    "title": "Customer-owned equipment and safety duties",
    "group": null,
    "paragraphs": [
      "Customer is responsible for the condition, suitability, maintenance, certification, and lawful use of its tanks, cylinders, piping, regulators, appliances, and other systems. Before initial service, Supplier may review accessible equipment for delivery suitability and may require qualified repairs, testing, or upgrades before service begins or resumes. A visual or delivery review is not a comprehensive inspection, certification, engineering review, or assumption of responsibility for Customer’s system, and does not limit Supplier’s own legal duties.",
      "Customer must follow labels, safety data sheets, manufacturer instructions, and applicable laws; use trained personnel; maintain required ventilation and storage clearances; and prevent tampering, unauthorized refilling, cross-filling, modification, or use of damaged equipment. Customer must immediately report leaks, damage, loss, or unsafe conditions. If gas odor or a suspected leak is detected, evacuate and call 911 from a safe location; do not operate switches, create ignition sources, or attempt repairs. Supplier service is not an emergency response system."
    ]
  },
  {
    "number": 6,
    "title": "Supplier-owned equipment",
    "group": null,
    "paragraphs": [
      "Record all Supplier-owned equipment in a delivery receipt signed by Customer. Customer must safeguard equipment, retain ownership markings, use it only for its intended purpose with Supplier-supplied product, and not sell, pledge, move off-site, modify, or permit another supplier to fill it without Supplier’s written consent. Customer is responsible for loss, theft, contamination, or damage while in its custody, except ordinary wear or damage caused by Supplier.",
      "For Customer-responsible damage, Customer owes reasonable documented repair cost, capped at reasonable replacement cost. For loss or destruction, Customer owes the agreed reasonable replacement value, or documented reasonable replacement cost if none is listed, without double recovery. Charges are compensation, not a penalty. Supplier may require insurance appropriate to equipment value and use, with coverage requirements agreed in writing.",
      "Rental runs from delivery until return or Supplier pickup. Customer must request pickup promptly after termination and make equipment safely accessible within 10 business days. If Customer provides timely notice and access, rental stops when the equipment is ready for the agreed pickup; Supplier delay does not extend rental. Accrued rental is not credited toward purchase. Any security deposit is credited to the final balance."
    ]
  },
  {
    "number": 7,
    "title": "Product warranty and limitations",
    "group": "Remedies and acceptance",
    "paragraphs": [
      "Supplier warrants that propane conforms at delivery to the grade and specifications expressly stated in the accepted order and applicable legal requirements, and that it has the right to sell the product. Customer must notify Supplier promptly of a claimed defect and allow reasonable inspection and a safe opportunity to cure. For nonconforming product, Supplier will, at its option, replace the affected product or refund its purchase price. This is the exclusive product warranty remedy to the extent permitted by law, subject to remedies required if it fails of its essential purpose.",
      "EXCEPT FOR THE EXPRESS WARRANTIES ABOVE, SUPPLIER DISCLAIMS IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE TO THE EXTENT PERMITTED BY LAW. Customer must determine suitability for its application. No disclaimer excuses Supplier from applicable product safety obligations."
    ]
  },
  {
    "number": 8,
    "title": "Supply interruptions and suspension",
    "group": null,
    "paragraphs": [
      "Supplier is excused from delay or nonperformance caused by events beyond reasonable control, including upstream supply failure, allocation, transportation disruption, extreme weather, fire, labor disruption, or government action, to the extent the event prevents performance. Supplier will give reasonably prompt notice, use commercially reasonable mitigation efforts, and allocate available supply fairly among affected customers. Supplier is not required to buy replacement product at commercially unreasonable cost. Cost changes alone are addressed under Section 2. Customer remains responsible for amounts already due.",
      "Supplier may suspend service immediately for unsafe conditions, nonpayment, lack of adequate assurance when lawfully required, misuse of equipment, or material breach. Supplier will give notice and a reasonable opportunity to cure where practicable, but need not deliver into unsafe conditions or extend unapproved credit. Supplier may terminate for an uncured material breach after 10 days’ written notice, or immediately for a serious safety violation or unlawful use. Customer may terminate if an interruption exceeds 30 consecutive days."
    ]
  },
  {
    "number": 9,
    "title": "Liability and third-party claims",
    "group": null,
    "paragraphs": [
      "TO THE EXTENT PERMITTED BY LAW, SUPPLIER IS NOT LIABLE FOR LOST PROFITS, LOSS OF PRODUCTION OR USE, BUSINESS INTERRUPTION, OR INDIRECT, SPECIAL, OR CONSEQUENTIAL DAMAGES. Supplier’s aggregate liability arising from this agreement will not exceed the amounts Customer paid or owes for product and services during the 12 months preceding the event. These limitations do not apply to bodily injury, death, damage to tangible property, Supplier’s gross negligence or willful misconduct, fraud, or liability that cannot lawfully be limited.",
      "Customer will indemnify Supplier against third-party claims and reasonable related costs to the extent caused by Customer’s negligence, willful misconduct, unlawful use, or unauthorized alteration or misuse of product or equipment. Customer has no duty to indemnify Supplier for Supplier’s own negligence or misconduct. Supplier must promptly notify Customer and reasonably cooperate; no settlement may impose an admission or nonmonetary obligation on Supplier without its written consent."
    ]
  },
  {
    "number": 10,
    "title": "General terms and notices",
    "group": null,
    "paragraphs": [
      "Ohio law governs, subject to applicable mandatory law. Disputes will be brought in courts with jurisdiction in the Ohio county of Supplier’s business address. Written notices may be delivered personally, by recognized courier, or by email to the designated contacts. Email notices are effective when sent without a delivery failure during business hours, otherwise the next business day. Each party must update its contact details. Safety concerns require immediate telephone reporting as well.",
      "This agreement and signed addenda supersede prior proposals on the same subject. Customer purchase-order terms do not amend it; Supplier expressly rejects additional or conflicting terms. Except for Section 2 changes, amendments require both parties’ signatures. Neither waiver nor unenforceability of one provision invalidates the rest. Payment, equipment return, warranty limitations, liability, and indemnity survive as applicable. Electronic signatures and counterparts are effective. Each signer represents authority to bind the named business; no personal guarantee is created.",
      "By signing, the parties accept this entire agreement, including variable pricing and the warranty and liability provisions. Complete all applicable blanks before signing."
    ]
  }
]

export interface RateLine {
  label: string
  charge: string
  basis: string
}

/** Default initial rate schedule — sales can edit per packet before sending. */
export const DEFAULT_RATE_SCHEDULE: RateLine[] = [
  { label: 'Propane 33 lb cylinder',     charge: '$45.00',    basis: 'Per cylinder supplied' },
  { label: 'Hazmat fee',                 charge: '$4.50',     basis: 'Per delivery' },
  { label: 'Scheduled delivery charge',  charge: '$30.00',    basis: 'Per delivery' },
  { label: 'Emergency delivery charge',  charge: '$100.00',   basis: 'As requested' },
  { label: '12 cylinder cage rental',    charge: '$30.00',    basis: 'Per month' },
  { label: '12 cylinder cage purchase',  charge: '$2,031.00', basis: 'One-time purchase' },
]

export const ACH_TITLE = 'ACH & Credit Card Payment Authorization'

export const ACH_AUTHORIZATION_PARAGRAPHS: string[] = [
  'I authorize Ohio Gas Supply Co. ("OGS") and its payment processor to initiate electronic ACH debits from the bank account identified above, or to charge my securely stored card if that payment method is selected, for amounts due under my product supply agreement, invoices, and related rental arrangements. This authorization covers:',
  '\u2022 Variable-amount charges for product deliveries, delivery fees, and other invoiced charges, processed on or after the delivery/invoice date.',
  '\u2022 Recurring rental charges (including cylinders and cages), billed on the 1st of each month in arrears for the preceding month.',
  'Amounts may vary based on deliveries, quantities, rental periods, and applicable charges. OGS will provide an invoice or other written statement identifying the amount and basis of each charge. Where required by applicable ACH rules or law, OGS will provide advance notice of changes in amount or timing. I authorize OGS to retain the payment credentials securely with its payment processor for future authorized transactions.',
  'This authorization remains effective until I revoke it by written notice to OGS at the billing contact address or email provided on my invoice, allowing at least 5 business days for processing. Revocation does not cancel amounts already owed or debits already submitted. I certify that I am authorized to act for the account holder and that the information provided is accurate.',
]

export const ACH_CARD_NOTE =
  'For credit card payments, OGS will arrange secure card entry through its payment processor. Card numbers and security codes are never collected on this form.'

export const ACH_FOOTNOTE = 'ACH debits are subject to bank and payment processor approval.'

export const ESIGN_CONSENT_TEXT =
  'I agree to sign these documents electronically. I understand my electronic signature has the same legal effect as a handwritten signature, that I may request paper copies from Ohio Gas Supply at any time, and that I will receive copies of the signed documents by email.'
