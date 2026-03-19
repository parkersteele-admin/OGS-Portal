# UI Standardization Audit Guide

Quick reference for auditing and standardizing Pages and Components to match the OGS Portal design system.

---

## Quick Audit Workflow

When reviewing a page or component for standardization:

```
1. IDENTIFY PATTERNS
   □ What design tokens are used? (colors, spacing, typography)
   □ What custom values are hardcoded? (px, hex colors, etc.)

2. COMPARE TO STANDARDS
   □ Is padding using --space-* scale?
   □ Is color using --color-* tokens?
   □ Typography using semantic weights (400/500/600/700)?
   □ Responsive at 375px, 768px, 1024px?

3. APPLY STANDARDIZATION
   □ Replace hardcoded values with tokens
   □ Align spacing tier to correct size (8px tight, 12px normal, 16px standard)
   □ Ensure color hierarchy (text > text-2 > text-3)

4. TEST & VERIFY
   □ Build succeeds (npm run build)
   □ TypeScript clean (npx tsc --noEmit)
   □ Visual regression check
   □ Responsive at breakpoints
```

---

## Common Issues & Fixes

### Issue: Hardcoded padding values
```css
/* ✗ Before */
.my-card {
  padding: 20px;
}

/* ✓ After */
.my-card {
  padding: var(--space-5);  /* 20px from scale */
}
```

### Issue: Inconsistent text colors
```css
/* ✗ Before */
.my-label {
  color: #888;
}
.my-title {
  color: #222;
}

/* ✓ After */
.my-label {
  color: var(--color-text-3);  /* Light gray labels */
}
.my-title {
  color: var(--color-text);    /* Dark primary text */
}
```

### Issue: Mixed font weights
```css
/* ✗ Before */
.my-header { font-weight: 800; }
.my-subtitle { font-weight: 550; }
.my-body { font-weight: 300; }

/* ✓ After */
.my-header { font-weight: 700; }     /* Bold */
.my-subtitle { font-weight: 600; }   /* Semibold */
.my-body { font-weight: 400; }       /* Normal */
```

### Issue: Arbitrary border radius
```css
/* ✗ Before */
.my-card { border-radius: 10px; }
.my-button { border-radius: 6px; }

/* ✓ After */
.my-card { border-radius: var(--radius); }     /* 8px modern */
.my-button { border-radius: var(--radius-sm); } /* 4px compact */
```

### Issue: Inconsistent card structure
```css
/* ✗ Before */
.old-card {
  padding: 24px;
  background: white;
}

/* ✓ After (for dashboard pages) */
.card-header {
  padding: var(--space-2) var(--space-4);  /* 8px v, 16px h */
  background: var(--color-bg-2);           /* Light gray distinction */
  border-bottom: 1px solid var(--color-border);
}

.card-body {
  padding: var(--space-3) var(--space-4);  /* 12px v, 16px h */
  background: var(--color-bg);             /* White content */
}
```

---

## Audit Checklist by Component Type

### Pages (Orders, Invoices, Tanks, Products, Billing, etc.)

Page Structure Check:
- [ ] Top-level wrapper uses consistent padding (24px desktop, 20px tablet, 16px mobile)
- [ ] Page title: 18px, weight 700, uses `--font-size-18`
- [ ] Alert bars: light gray bg (`--color-bg-2`), brand border, 12px v / 16px h padding
- [ ] All borders: `1px solid var(--color-border)` (consistent)
- [ ] Border radius: `var(--radius)` (8px) everywhere

Card Layout Check:
- [ ] Card headers: 8px v, 16px h padding, light gray bg, 14px bold title
- [ ] Card bodies: 12px v, 16px h padding, white bg
- [ ] Empty states: min-height 80px, centered, text-3 color
- [ ] No hardcoded box-shadows (use subtle borders + bg instead)

List/Table Check:
- [ ] Row padding: 8px v (use `var(--space-2)`)
- [ ] Row separator: 1px solid with `--color-bg-3` (very light)
- [ ] Last row: `border-bottom: none`
- [ ] Column gaps: `var(--space-3)` (12px minimum)

Responsive Check:
- [ ] Tested at 375px mobile (all touch targets ≥44px)
- [ ] Tested at 768px tablet (sidebar collapses, stacked layout)
- [ ] Tested at 1024px+ desktop (full layout)

### Modals & Dialogs

Modal Structure Check:
- [ ] Border radius: `var(--radius)` (8px)
- [ ] Padding: `var(--space-6)` (24px) standard
- [ ] Background: `var(--color-bg)` (white)
- [ ] Header padding: `var(--space-5) var(--space-6)` (20px v, 24px h)
- [ ] Border top: subtle 1px line for separation

Modal Header Check:
- [ ] Title: 18px, weight 700
- [ ] Close button: right-aligned, subtle hover state

Modal Body Check:
- [ ] Content padding: `var(--space-6)` (24px)
- [ ] Form inputs: consistent height 44px min (mobile touch target)
- [ ] Gap between fields: `var(--space-4)` (16px)

Modal Footer Check:
- [ ] Padding: `var(--space-5) var(--space-6)` (20px v, 24px h)
- [ ] Border top: `1px solid var(--color-border)`
- [ ] Actions: right-aligned, gap `var(--space-3)` (12px)

### Forms & Inputs

Form Layout Check:
- [ ] Label: 14px, weight 500, color `--color-text` (not 600; labels are secondary)
- [ ] Input height: min 40px (touch-friendly)
- [ ] Input padding: 8px v, 12px h (use `--space-2` and `--space-3`)
- [ ] Input border: `1px solid var(--color-border)`
- [ ] Focus outline: visible, 2px outline with brand color
- [ ] Input bg: white (`--color-bg`)
- [ ] Placeholder: `--color-text-3` (light gray)
- [ ] Error text: `--color-danger` (red), 12px
- [ ] Input gap: `var(--space-2)` (8px between label and input)
- [ ] Field group gap: `var(--space-4)` (16px between fields)

### Navigation Items

Nav Item Check:
- [ ] Height: min 24px (tight), max 32px (spacious)
- [ ] Icon-label gap: `var(--space-2)` (6px after refactor)
- [ ] Padding: `var(--space-2)` v (8px) around item
- [ ] Active state: 2px left border accent (no background)
- [ ] Hover state: subtle left border hint
- [ ] Text: 14px, weight 500

---

## Standardization Priority List

**High Priority (Apply Next):**
1. Orders page (`src/pages/customer/OrdersPage.tsx` & `.css`)
2. Invoices page (`src/pages/customer/InvoicesPage.tsx` & `.css`)
3. Tanks page (`src/pages/customer/TanksPage.tsx` & `.css`)

**Medium Priority (Apply After):**
4. Billing pages (`src/pages/billing/`)
5. Autopay pages (`src/pages/customer/`)
6. Customer info pages (`src/pages/customer/`)

**Low Priority (Apply As Needed):**
7. CRM pages (admin-only, less critical)
8. Dispatch pages (admin-only, less critical)
9. Driver app pages (separate interface)

---

## Files to Reference

When standardizing, keep these open:

- **STYLING_CONVENTIONS.md** — System rules & standards
- **UI_STANDARDIZATION_SUMMARY.md** — Applied changes & examples
- **src/styles/tokens.css** — All design tokens (colors, spacing, typography)
- **src/pages/customer/Dashboard.css** — Reference implementation (proven pattern)
- **src/components/ui/Sidebar.css** — Navigation reference
- **src/components/layouts/Layout.css** — App shell reference
- **src/styles/global.css** — Typography reset & headings

---

## Test After Standardization

1. **Build Test:**
   ```bash
   npm run build
   ```
   Should complete in <500ms with no TS errors.

2. **Type Check:**
   ```bash
   npx tsc --noEmit
   ```
   Should pass with zero errors.

3. **Visual Regression Test:**
   - Open in browser at `http://localhost:5173`
   - Compare before/after screenshots at 375px, 768px, 1024px
   - Check: spacing, colors, typography, borders, shadows

4. **Responsive Test:**
   - Mobile (375px): All buttons clickable, no overflow
   - Tablet (768px): Sidebar collapses, layout adapts
   - Desktop (1024px): Full layout visible

5. **Focus/Keyboard Test:**
   - Tab through page: all interactive elements focusable
   - Focus outline: visible on buttons, inputs, links

---

## Before/After Template

Use this when documenting a standardization PR:

### Before (Issues)
```
- Hardcoded padding (20px, 14px, 8px mix)
- Arbitrary font sizes (15px, 17px, 19px)
- Hardcoded colors (#555, #888, #e87722)
- Inconsistent weight (500, 600, 700, 800 mix)
- Border radius all over (6px, 10px, 12px)
```

### After (Standard)
```
✓ Padding uses --space-* scale (8px, 12px, 16px, 20px, 24px)
✓ Font sizes use --font-size-* scale (14px, 16px, 18px, 20px)
✓ Colors use --color-* tokens (semantic not hardcoded)
✓ Font weight: 400, 500, 600, 700 only
✓ Border radius: --radius (8px) or --radius-sm (4px)
```

---

## Common Standardization Time Estimates

| Component Type | Size | Est. Time |
|---|---|---|
| Small form page | ~100 lines CSS | 15–30 min |
| Data table page | ~200 lines CSS | 30–60 min |
| Multi-section dashboard | ~300 lines CSS | 60–90 min |
| Modal/dialog | ~50 lines CSS | 10–15 min |
| Sidebar/nav | ~100 lines CSS | 20–30 min |

---

## Questions to Ask When Reviewing

When code review asks for standardization, check:

1. **Consistency:** Does this page use same colors/sizes as Dashboard?
2. **Token Usage:** Am I using design tokens or hardcoding values?
3. **Responsive:** Does it work at 375px, 768px, 1024px?
4. **Hierarchy:** Is typography weight intentional (700=primary, 600=secondary, etc.)?
5. **Spacing Logic:** Is spacing following tight/normal/generous tiers?
6. **Accessibility:** Are touch targets ≥44px? Focus outlines visible?
7. **Reusability:** Can this pattern be copied to similar pages?

---

## Git Commit Message Template

```
refactor(styling): standardize {page name} to design system

- Replace hardcoded padding with --space-* tokens
- Update text colors to --color-* semantic tokens
- Align typography weights: 400/500/600/700
- Fix responsive layout at 375px/768px/1024px
- Verify build passes: npm run build ✓
```

---

## When Standardization Isn't Needed

Skip standardization for:
- Admin-only pages (CRM, Dispatch) — different user base, lower priority
- One-off custom layouts (if truly unique and not reusable)
- Deprecated pages (being removed soon)
- Experimental features (standardize after validation)

Always standardize for:
- Customer-facing pages (Orders, Invoices, Tanks, Autopay)
- Shared components (Buttons, Cards, Navigation)
- Pages with multiple instances (repeated pattern)

---

## Quick Token Cheat Sheet

### Color Tokens
```css
/* Use these: */
--color-text        /* Dark gray, primary text */
--color-text-2      /* Medium gray, secondary text */
--color-text-3      /* Light gray, tertiary/labels */
--color-brand       /* Orange, primary action */
--color-success     /* Green */
--color-warning     /* Yellow-orange */
--color-danger      /* Red */
--color-info        /* Blue */
--color-bg          /* White, primary bg */
--color-bg-2        /* Light gray, secondary bg */
--color-bg-3        /* Lighter gray, tertiary bg */
--color-border      /* Medium gray, borders */
```

### Spacing Tokens
```css
/* Use these: */
--space-1  /* 4px tight gaps (icon padding) */
--space-2  /* 8px small gaps (row padding) */
--space-3  /* 12px normal gap (default) */
--space-4  /* 16px standard padding (default) */
--space-5  /* 20px large padding (breathing room) */
--space-6  /* 24px major padding (sections) */
--space-7  /* 32px double spacing */
--space-8  /* 48px page margins */
```

### Font Size Tokens
```css
/* Use these: */
--font-size-11  /* Badge, caption (11px) */
--font-size-12  /* Small labels (12px) */
--font-size-13  /* Form labels (13px) */
--font-size-14  /* Default body (14px) */
--font-size-16  /* Subheadings (16px) */
--font-size-18  /* Page titles (18px) */
--font-size-20  /* stat values (20px) */
```

### Font Weight Tokens
```css
/* Use ONLY these: */
400  /* Normal body text (default) */
500  /* Medium secondary text */
600  /* Semibold section headers */
700  /* Bold titles & primary labels */
```

---

## Summary

**Goal:** Every page in the OGS Portal follows the same design system rules.

**Process:** Audit → Compare → Apply → Test → Commit

**Result:** Consistent, professional UI that users recognize across all pages.
