# UI Standardization Summary

This document summarizes the styling standardization applied to the OGS Portal dashboard and establishes conventions for future work.

---

## What Was Standardized

### 1. **Spacing & Density Consistency**

**Before:** Ad-hoc padding across components (some 24px, some 12px, some 16px)
**After:** Standardized scaling using 3 tiers: tight (8px), normal (12px), generous (16–20px)

**Dashboard Implementation:**
- Stat cards: `12px vertical, 16px horizontal` (compact, scannable)
- Card headers: `8px vertical, 16px horizontal` (visual distinction from body)
- Card bodies: `12px vertical, 16px horizontal` (breathing room)
- List rows: `8px vertical` (denser display, more content visible)
- Section gaps: `20px` between major blocks (breathing room)
- Grid gaps: `12px` between cards (intentional rhythm)

**Files Affected:**
- `src/pages/customer/Dashboard.css` — all `.cust-db__*` classes
- `src/components/ui/Sidebar.css` — refined nav row height to 24px
- `src/components/layouts/Layout.css` — responsive padding (24px → 20px → 16px)

---

### 2. **Typography Hierarchy Standardization**

**Pattern:** Weight + Size + Color convention for information hierarchy

**Stat Cards Example:**
```css
Label:     11px uppercase, weight 700, color text-3 (light gray)  → Minimal, descriptive
Value:     20px, weight 700, color text (dark)                    → Primary metric
Subtext:   12px, weight 400, color text-3 (light gray)            → Secondary context
```

**Card Headers Example:**
```css
Title:     14px, weight 700, color text (dark)                    → Clear section name
Link:      13px, weight 500, color brand                          → Actionable link
```

**Order Table Headers Example:**
```css
Column labels: 11px uppercase, weight 600, color text-3           → Minimal caps
```

**Implementation:** All found in `Dashboard.css` (`.cust-db__stat-label`, `.cust-db__card-title`, etc.)

---

### 3. **Color System Standardization**

**Colors now use consistent semantic meanings:**

| Token | Usage | Example |
|-------|-------|---------|
| `--color-brand` | Primary action, emphasis | Buttons, stat labels |
| `--color-bg-2` | Secondary surfaces | Stat card bg, card headers |
| `--color-text` | Primary content | Titles, values, body text |
| `--color-text-2` | Secondary content | Descriptions, metadata |
| `--color-text-3` | Tertiary content | Captions, labels, helpers |
| `--color-border` | Subtle divisions | Card borders, row separators |

**Dashboard Application:**
- Stat cards: `background: var(--color-bg-2)` (light gray distinction from page)
- Card bodies: `background: var(--color-bg)` (white, primary content)
- Card headers: `background: var(--color-bg-2)` (light gray, visual hierarchy)
- All text: semantic color tokens (no hardcoded colors anywhere)

---

### 4. **Border & Radius Standardization**

**Modern standard:** `8px` border-radius for all components
**Legacy:** `12px` for older cards (being standardized downward)
**Small controls:** `4px` for buttons, badges

**Dashboard Application:**
- All cards: `border-radius: var(--radius)` (8px)
- All borders: `1px solid var(--color-border)` (subtly darker than bg)

**Why:** 8px feels modern and professional; 12px felt soft/inflated

---

### 5. **Responsive Design Standardization**

**Breakpoints:**
- Desktop: `1024px+` — full sidebar, 3-col stats, 2-col cards
- Tablet: `768–1023px` — collapsed sidebar, 2-col stats (3rd spans), 1-col cards
- Mobile: `≤767px` — hidden sidebar, 2-col stats, stacked cards, mobile actions bar

**Sidebar Behavior:**
- Desktop → Tablet: 208px width collapses to 56px icon-only
- Tablet → Mobile: Hidden completely (mobile nav takes over)

**Content Responsiveness:**
```css
/* Desktop (1024px+) */
.cust-db__stats { grid-template-columns: repeat(3, 1fr); }
.cust-db__grid { grid-template-columns: 1fr 1fr; }

/* Tablet (768–1023px) */
@media (768–1023px) {
  .cust-db__stats { grid-template-columns: repeat(2, 1fr); }
  .cust-db__grid { grid-template-columns: 1fr; }
}

/* Mobile (≤767px) */
@media (max-width: 767px) {
  .cust-db__stats { grid-template-columns: 1fr 1fr; }
  .cust-db__grid { grid-template-columns: 1fr; }
  .cust-db__mobile-actions { display: flex; } /* Sticky footer */
}
```

---

### 6. **Component Pattern Standardization**

#### Button System
- `.ui-btn`: Base button class
- Variants: `--primary`, `--secondary`, `--ghost`, `--success`, `--danger`
- Sizes: `--sm` (12px), `--md` (14px, default), `--lg` (16px)
- Used throughout dashboard for all CTA buttons

#### Card System
- `.ui-card` (generic): 24px padding, for dialogs/modals
- Dashboard cards (`.cust-db__card`): 12px/16px padding, tighter for density
- Pattern: `__header` (light bg) → `__body` (content)

#### Badge System
- `.ui-badge`: Status indicators with semantic colors
- Variants: `--brand`, `--success`, `--warning`, `--danger`, `--info`, `--neutral`
- Used for order status, invoice status, etc.

---

## What Changed vs. What Stayed

### Changed Components
| Component | Before | After | Why |
|-----------|--------|-------|-----|
| Sidebar width | 224px | 208px | More modern, cleaner proportions |
| Sidebar logo | Orange badge box | Text wordmark "OGS · Portal" | Professional, typographic |
| Sidebar icon-gap | 12px | 6px | Denser navigation |
| Sidebar row height | Variable | Consistent 24px | Easy scanning |
| Stat card padding | 16px | 12px v / 16px h | More compact, scannable |
| Stat card bg | White | Light gray | Visual distinction |
| Card border-radius | Varied (12px/8px) | Consistent 8px | Modern, clean |
| Dashboard max-width | 1200px | None (full width) | Better viewport usage |
| Layout padding | 24px | Responsive (24/20/16px) | Better mobile fit |

### Unchanged (Standard)
- Font family: IBM Plex Sans (all text)
- Color tokens: Semantic system (brand, success, warning, danger, info, neutral, neutrals)
- Spacing scale: `--space-1` through `--space-8` (4px–48px)
- Typography scale: 10 sizes (10px–24px)
- Breakpoints: 3-tier system (mobile/tablet/desktop)

---

## How to Use This Going Forward

### When Building a New Dashboard Page

1. **Copy dashboard structure:**
   ```tsx
   <div className="cust-db">
     <div className="cust-db__header">
       <h1 className="cust-db__title">Page Title</h1>
       <div className="cust-db__header-actions">
         {/* CTAs go here */}
       </div>
     </div>
     
     {/* Content cards */}
     <div className="cust-db__card">
       <div className="cust-db__card-header">
         <h2 className="cust-db__card-title">Card Title</h2>
       </div>
       <div className="cust-db__card-body">
         {/* Content here */}
       </div>
     </div>
   </div>
   ```

2. **Use design tokens always:**
   ```css
   /* ✓ GOOD */
   padding: var(--space-3) var(--space-4);
   color: var(--color-text);
   font-size: var(--font-size-14);
   
   /* ✗ BAD */
   padding: 12px 16px;
   color: #222;
   font-size: 14px;
   ```

3. **Apply typography weight intentionally:**
   ```css
   .my-title { font-weight: 700; }      /* Primary info */
   .my-label { font-weight: 600; }      /* Secondary info */
   .my-subtext { font-weight: 500; }    /* Helper text */
   body { font-weight: 400; }           /* Default */
   ```

4. **Test responsive breakpoints:**
   - Build at 375px (mobile)
   - Build at 768px (tablet)
   - Build at 1024px (desktop)

---

## Shared Components Inventory

Files implementing standardized patterns:

- **`src/styles/tokens.css`** — Single source of truth for all design decisions
- **`src/components/ui/Button.css`** — Reusable button component (5 variants, 3 sizes)
- **`src/components/ui/Card.css`** — Generic card (for modals/dialogs; use `.cust-db__card` for dashboard)
- **`src/components/ui/Badge.css`** — Status badge (6 semantic variants)
- **`src/components/ui/Sidebar.tsx / .css`** — Main navigation
- **`src/components/layouts/Layout.css`** — App shell (sidebar + topbar + content)
- **`src/pages/customer/Dashboard.css`** — Dashboard pattern reference
- **`src/styles/global.css`** — Typography, headings, resets

---

## Three Phases of Standardization

### ✓ Phase 1: Dashboard Modernization (Completed)
- Removed fixed-width constraint
- Refined sidebar density
- Compacted card spacing
- Updated logo/branding
- Responsive layout at 3 breakpoints
- **Status:** All changes built & tested ✓

### → Phase 2: Pattern Documentation (Just Completed)
- Created STYLING_CONVENTIONS.md (system rules)
- Updated Dashboard.css header (reference comment)
- Created this summary document (proof of implementation)
- **Status:** Documentation complete; ready for reference

### ⏳ Phase 3: Apply to Other Pages (Next)
- Copy dashboard patterns to Orders page
- Copy dashboard patterns to Invoices page
- Copy dashboard patterns to Tanks page
- Copy dashboard patterns to Products page
- **Status:** When needed; use Dashboard.css as template

---

## Quick Reference

### Spacing Tier Sizes
```
Tight:    --space-2 = 8px     (internal row padding, icon gaps)
Normal:   --space-3  = 12px    (default gap, card padding v)
Standard: --space-4  = 16px    (default padding h, component spacing)
Generous: --space-5  = 20px    (section gaps, breathing room)
```

### Font Weight Hierarchy
```
700 (Bold)      → Page titles, card titles, stat values, strong labels
600 (Semibold)  → Section headers, form labels, action text
500 (Medium)    → Secondary text, helper text, nav labels
400 (Normal)    → Body paragraphs, descriptions (default)
```

### Color Tier Usage
```
--color-text     → Primary content (headings, body text)
--color-text-2   → Secondary content (descriptions, metadata)
--color-text-3   → Tertiary content (labels, captions, hints)
--color-brand    → Primary action (buttons, emphasis)
--color-bg-2     → Secondary surfaces (stat cards, headers)
--color-border   → Subtle divisions (card borders, row lines)
```

### Component Padding Sizes
```
Stat card:  12px v,  16px h  (compact fit)
Card body:  12px v,  16px h  (standard)
Card header: 8px v,  16px h  (minimal distinction)
Row item:    8px v   (list row density)
Page margin: 24px (desktop), 20px (tablet), 16px (mobile)
```

---

## Validation Checklist

Before shipping a new dashboard page using this system, verify:

- [ ] All colors use `--color-*` tokens (never hardcoded hex/rgb)
- [ ] All spacing uses `--space-*` tokens (never hardcoded px)
- [ ] All font sizes use `--font-size-*` tokens (never hardcoded px)
- [ ] All borders use `--radius` (8px) for modern look
- [ ] Font weights limited to 400, 500, 600, 700
- [ ] Stat cards follow pattern: light gray bg, 12v/16h padding
- [ ] Card headers distinguish: light gray bg, 8v/16h padding
- [ ] List rows: 8px v padding, subtle borders
- [ ] Empty states: min-height 80px, centered, light gray bg
- [ ] Responsive tested at 375px, 768px, 1024px
- [ ] Touch targets ≥44px on mobile
- [ ] Focus outlines visible for keyboard nav
- [ ] Section spacing: 16–20px between major blocks

---

## Summary

**Goal Achieved:** Dashboard styling modernized and standardized into a reusable system.

**Key Improvements:**
1. Removed fixed-width constraint → Full viewport usage
2. Tightened sidebar density → More professional appearance
3. Compacted card spacing → Better information density
4. Updated typography → Clear visual hierarchy
5. Refined colors → Consistent semantic meaning
6. Added responsive design → Works across all devices
7. Documented conventions → Reusable for other pages

**Result:** Dashboard is modern, responsive, consistent, and serves as a template for standardizing other customer portal pages.
