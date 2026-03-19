# OGS Portal Styling Conventions

This document standardizes UI patterns used throughout the customer portal. Reference these conventions when building/refactoring components and pages.

---

## 1. Design Tokens (Immutable)

All styling uses CSS custom properties defined in `src/styles/tokens.css`.

### Color System
```css
/* Brand */
--color-brand: #E87722;              /* Primary action color */
--color-brand-light: #FEF4EC;        /* Light background */
--color-brand-dark: #7A3A08;         /* Hover/active state */

/* Semantic */
--color-success: #1D9E75;
--color-warning: #BA7517;
--color-danger: #E24B4A;
--color-info: #378ADD;

/* Neutrals */
--color-bg: #FFFFFF;                 /* Page bg, card bg */
--color-bg-2: #F7F7F7;               /* Section bg, hover bg */
--color-bg-3: #EFEFEF;               /* Tertiary bg */
--color-text: #222222;               /* Primary text */
--color-text-2: #555555;             /* Secondary text */
--color-text-3: #888888;             /* Tertiary text / labels */
--color-border: #E0E0E0;             /* Default border */
--color-border-2: #C0C0C0;           /* Inactive border */
```

### Spacing Scale
```css
--space-1: 4px;                      /* Tiny gaps, icon padding */
--space-2: 8px;                      /* Small gaps, internal padding */
--space-3: 12px;                     /* Default gap between items */
--space-4: 16px;                     /* Default padding for components */
--space-5: 20px;                     /* Large padding */
--space-6: 24px;                     /* Card padding, major sections */
--space-7: 32px;                     /* Double major section *)
--space-8: 48px;                     /* Page margins */
```

**Rule:** Use space scale consistently. Avoid arbitrary pixel values.

### Typography Scale
```css
--font-size-10: 10px;                /* Tiny labels (use sparingly) */
--font-size-11: 11px;                /* Badge, caption text */
--font-size-12: 12px;                /* Small labels, secondary info */
--font-size-13: 13px;                /* Body text, form labels */
--font-size-14: 14px;                /* Default body, button text */
--font-size-16: 16px;                /* Subheadings, large buttons */
--font-size-18: 18px;                /* Page titles */
--font-size-20: 20px;                /* Stat values */
--font-size-24: 24px;                /* Hero text */
```

### Border Radius
```css
--radius-sm: 4px;                    /* Small controls (buttons, badges) */
--radius: 8px;                       /* Default (cards, inputs, modals) */
--radius-lg: 12px;                   /* Large containers (older cards) */
```

**Rule:** Prefer `--radius` (8px) for modern components. Use `--radius-sm` for tight controls.

### Shadows
```css
--shadow-sm: 0 1px 3px rgba(0,0,0,0.08);      /* Subtle elevation */
--shadow: 0 4px 12px rgba(0,0,0,0.1);         /* Default elevation */
--shadow-lg: 0 12px 32px rgba(0,0,0,0.12);    /* High elevation */
```

**Rule:** Use sparingly. Prefer border + background on light UI.

### Transitions
```css
--transition-fast: 100ms ease;       /* Micro-interactions (icon, color) */
--transition: 150ms ease;            /* Default transitions */
--transition-slow: 250ms ease;       /* Entrance/exit animations */
```

---

## 2. Typography Hierarchy

**Use consistent font weights:**
- **700 (bold):** Page titles, card titles, primary labels, stat values
- **600 (semibold):** Section headers, form labels, action text
- **500 (medium):** Secondary text, helper text, nav labels
- **400 (normal):** Body text, descriptions (default)

**Standard font pairings:**
```css
/* Headlines & Labels (700) */
.h1, .label--primary { font-weight: 700; }

/* Section titles (600) */
.h2, .label--secondary { font-weight: 600; }

/* Body & secondary info (500, 400) */
.body, .label--tertiary { font-weight: 500; }
p { font-weight: 400; }
```

**Font family:**
- Use `var(--font-sans)` for all UI text
- Use `var(--font-mono)` only for code/serial numbers

---

## 3. Component Patterns

### Buttons
**Classes:** `.ui-btn`, `.ui-btn--primary`, `.ui-btn--secondary`, `.ui-btn--ghost`

**Standard sizes:**
- `.ui-btn--sm` (padding: 4px 12px, font: 12px)
- `.ui-btn--md` (padding: 8px 16px, font: 14px) — default
- `.ui-btn--lg` (padding: 12px 24px, font: 16px)

**Variants:**
- Primary: Orange background, white text → use for CTAs (Place Order, etc.)
- Secondary: Transparent, orange text, border → use for secondary actions (Report Level, etc.)
- Ghost: Transparent → use for low-priority actions
- Success/Danger: Semantic colors for destructive/positive actions

### Cards
**Classes:** `.ui-card`, `.ui-card__header`, `.ui-card__body`, `.ui-card__footer`

⚠️ **Standard (dashboard-style):**
- Border-radius: `--radius` (8px)
- Background: `--color-bg` (white) OR `--color-bg-2` (light gray for stat cards)
- Header padding: `8px vertical, 16px horizontal` → `var(--space-2) var(--space-4)`
- Body padding: `12px vertical, 16px horizontal` → `var(--space-3) var(--space-4)`
- Header background: `--color-bg-2` (subtle distinction)
- Border: `1px solid var(--color-border)`
- NO box-shadow (prefer border + background separation)

**Old `.ui-card` (generic, larger padding):**
- 24px padding throughout (too much for dense UIs)
- 12px border-radius (softer, less modern)
- Used for modal/dialog content
- Do not use for dashboard — use custom dashboard card classes

### Badges
**Classes:** `.ui-badge`, `.ui-badge--{variant}`

**Variants:** `brand`, `success`, `warning`, `danger`, `info`, `neutral`

**Usage:** Status indicators, metadata tags, small labels. Not for primary text.

### Section Headers
**Pattern:** Use `<h2>` or appropriate heading + class

```css
.section__title {
  font-size: var(--font-size-14);
  font-weight: 700;
  color: var(--color-text);
  letter-spacing: -0.01em;
  margin-bottom: var(--space-3);
}
```

---

## 4. Dashboard-Specific Patterns

### Page Structure
```
┌─ Dashboard (full width) ────────────────────┐
│ ┌─ Header (title + actions) ─────────────┐  │
│ │                                        │  │
│ ├─ Alert bar (if present)               │  │
│ │                                        │  │
│ ├─ Stat grid (3-col desktop, 2-col tab) │  │
│ │ • Stat cards: light gray bg, tight pad │  │
│ │                                        │  │
│ ├─ Two-column card grid                  │  │
│ │ • Active tanks | Recent invoices       │  │
│ │                                        │  │
│ ├─ Full-width card section                │  │
│ │ • Recent orders                        │  │
│ │                                        │  │
└─────────────────────────────────────────────┘
```

### Stat Cards (`.cust-db__stat`)
- Background: `--color-bg-2` (light gray)
- Padding: `12px 16px` (compact, scannable)
- Border: `1px solid --color-border`
- Border-radius: `--radius` (8px)
- Content: Label → Value → Subtext (clear hierarchy)
- Label: 11px, weight 700, text-3 (light gray)
- Value: 20px, weight 700, text (dark) — primary metric
- Subtext: 12px, weight 400, text-3 — context

### Content Cards (`.cust-db__card`)
- Same border/radius/padding as stat cards
- Header: 8px V, 16px H padding; background: `--color-bg-2`
- Body: 12px V, 16px H padding
- Minimum content height: 80px (empty states feel guided)
- Row padding: 8px V (denser list display)

### Section Spacing Rhythm
- Page header → alert: `--space-3` (12px)
- Alert → stats: `--space-3` (12px)
- Stat block → grid: `--space-5` (20px) — more breathing room
- Grid → full-width card: `--space-4` (16px)
- Card → card: `--space-4` (16px)

**Rule:** Tight internal spacing (8–12px), generous external spacing (16–20px).

### Empty States
- Display: Flex centered
- Min-height: 80px
- Background: Subtle icon placeholder (via `::before` pseudo-element)
- Text color: `--color-text-3` (light gray)
- Vertical centering for guided feel

---

## 5. Responsive Design

### Breakpoints
- **Desktop:** 1024px+ (full sidebar + 3-col stat grid + 2-col card grid)
- **Tablet:** 768–1023px (collapsed sidebar + 2-col stats + 1-col cards)
- **Mobile:** ≤767px (sidebar hidden + stacked layout + bottom nav)

### Sidebar Behavior
- Desktop: 208px, full labels
- Tablet: 56px, icons only
- Mobile: Hidden (mobile nav instead)

### Action Buttons
- Desktop: Always visible in header
- Mobile: Duplicate in sticky footer above mobile nav

---

## 6. Best Practices

### DO:
✓ Use design tokens (never hardcode colors/spacing)
✓ Stack spacing consistently (3 levels: tight 8px, normal 12px, relaxed 16–20px)
✓ Weight text intentionally (700 for primaries, 600 for section headers, 500 for secondary, 400 for body)
✓ Use semantic colors (success, warning, danger) for status
✓ Keep borders subtle (1px, `--color-border`)
✓ Test responsive breakpoints (768px, 1024px)
✓ Use `.ui-btn` component for all buttons
✓ Use `.ui-badge` for status/tags
✓ Use `.cust-db__*` classes for dashboard-specific layouts

### DON'T:
✗ Hardcode color values (use CSS variables)
✗ Hardcode px values for spacing (use `--space-*`)
✗ Use arbitrary font sizes (use `--font-size-*`)
✗ Mix card styles (choose dashboard-card or ui-card, not both)
✗ Add box-shadows unless elevation is critical
✗ Use font-weight other than 400, 500, 600, 700
✗ Forget `letter-spacing: -0.01em` on large headings
✗ Set min-widths that break responsive layouts

---

## 7. Implementation Checklist

When building a new component or refactoring:

- [ ] Use `--color-*` tokens for all colors
- [ ] Use `--space-*` tokens for all spacing/padding/margin
- [ ] Use `--font-size-*` tokens for all font sizes
- [ ] Use `--radius` (8px) for modern components
- [ ] Set font-weight explicitly (not inherited)
- [ ] Test at 768px and 1024px breakpoints
- [ ] Ensure touch targets ≥ 44px on mobile
- [ ] Use semantic HTML (h1-h6, buttons, etc.)
- [ ] Add focus-visible outlines for keyboard nav
- [ ] Verify color contrast (WCAG AA)
- [ ] Document component if it becomes reusable

---

## 8. Migration Path

**Phase 1 (Done):** Refactor dashboard with standardized patterns
**Phase 2 (Next):** Apply dashboard patterns to other customer pages (Orders, Invoices, Tanks, etc.)
**Phase 3 (Future):** Consolidate reusable patterns into shared component library

---

## References

- Design tokens: `src/styles/tokens.css`
- Shared components: `src/components/ui/Button.css`, `Card.css`, `Badge.css`
- Global styles: `src/styles/global.css`
- Dashboard: `src/pages/customer/Dashboard.css`
- Sidebar: `src/components/ui/Sidebar.css`
- Layout: `src/components/layouts/Layout.css`
