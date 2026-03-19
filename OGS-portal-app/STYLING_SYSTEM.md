# Styling System Overview

The OGS Portal uses a lightweight, token-based design system to maintain visual consistency across all customer-facing pages.

---

## 📋 Documentation Files

| File | Purpose | Audience |
|------|---------|----------|
| **STYLING_CONVENTIONS.md** | System rules, design decisions, best practices | All developers |
| **UI_STANDARDIZATION_SUMMARY.md** | What changed, how it's implemented, validation checklist | Designers & leads |
| **UI_AUDIT_GUIDE.md** | Step-by-step audit process, common fixes, templates | Developers applying standards |
| **src/styles/tokens.css** | Single source of truth for all design tokens | All CSS files |
| **src/pages/customer/Dashboard.css** | Reference implementation of best practices | Page developers |

---

## 🎨 Design System Principles

### 1. Token-Based (Never hardcode values)
All styling uses CSS custom properties from `tokens.css`:
- **Colors:** `--color-*` (semantic + neutral)
- **Spacing:** `--space-1` through `--space-8` (4px–48px scale)
- **Typography:** `--font-size-*` (10px–24px) + weights (400/500/600/700)
- **Borders:** `--radius` (8px), `--radius-sm` (4px)
- **Shadows:** `--shadow`, `--shadow-sm`, `--shadow-lg`
- **Transitions:** `--transition-fast`, `--transition`, `--transition-slow`

### 2. Spacing Hierarchy (3 tiers)
- **Tight:** 8px (`--space-2`) — Internal row padding, icon gaps
- **Normal:** 12px (`--space-3`) — Default component gap
- **Generous:** 16–20px (`--space-4`/`--space-5`) — Section breathing room

### 3. Typography Hierarchy (4 weights)
- **700 (Bold)** → Page titles, primary labels, stat values
- **600 (Semibold)** → Section headers, form labels
- **500 (Medium)** → Secondary text, navigation labels
- **400 (Normal)** → Body paragraphs, descriptions

### 4. Responsive Design (3 breakpoints)
- **Mobile:** ≤767px (sidebar hidden, stacked layout)
- **Tablet:** 768–1023px (sidebar 56px icon-only, 2-col layout)
- **Desktop:** 1024px+ (sidebar 208px, full layout)

### 5. Semantic Colors (6 core moods)
- `--color-brand` (Orange) → Primary actions
- `--color-success` (Green) → Positive states
- `--color-warning` (Yellow) → Cautions
- `--color-danger` (Red) → Errors/destructive
- `--color-info` (Blue) → Information
- `--color-neutral` (Gray) → Secondary content

### 6. Component-First Patterns
Reusable patterns from Dashboard that apply everywhere:
1. **Stat cards** — Compact info display (light gray bg, 12v/16h padding)
2. **Content cards** — Main sections (white bg, light header, 12v/16h body padding)
3. **List rows** — Scannable content (8px v padding, subtle separators)
4. **Empty states** — Guided feedback (min-height 80px, centered)
5. **Section rhythm** — Intentional spacing (16–20px between blocks)

---

## 🚀 Quick Start for New Developers

### When You Build a New Page:

1. **Copy the dashboard structure:**
   ```tsx
   <div className="cust-db">
     <div className="cust-db__header">
       <h1 className="cust-db__title">Page Title</h1>
       <div className="cust-db__header-actions">
         {/* Buttons */}
       </div>
     </div>
     
     <div className="cust-db__card">
       <div className="cust-db__card-header">
         <h2 className="cust-db__card-title">Section</h2>
       </div>
       <div className="cust-db__card-body">
         {/* Content */}
       </div>
     </div>
   </div>
   ```

2. **Use design tokens in CSS:**
   ```css
   .my-component {
     padding: var(--space-3) var(--space-4);  /* 12px h, 16px v */
     color: var(--color-text);                 /* Primary text */
     font-size: var(--font-size-14);          /* Body size */
     font-weight: 600;                         /* Semibold */
     border: 1px solid var(--color-border);   /* Standard border */
     border-radius: var(--radius);            /* 8px modern radius */
   }
   ```

3. **Test responsive:**
   - 375px (mobile)
   - 768px (tablet)
   - 1024px+ (desktop)

4. **Build & verify:**
   ```bash
   npm run build  # Should succeed
   npx tsc --noEmit  # Should pass
   ```

---

## 📐 Spacing Reference

### How Spacing Tokens Map to Real Sizes

```
Card padding patterns:
├─ Stat cards (compact)     → 12px v, 16px h
├─ Card bodies (standard)   → 12px v, 16px h
├─ Card headers (minimal)   → 8px v, 16px h
└─ List rows (dense)        → 8px v

Section spacing:
├─ Between sections         → 20px (--space-5)
├─ Between cards in grid    → 12px (--space-3)
├─ Between rows in list     → 8px (--space-2)
└─ Page margins             → 24px (desktop), 20px (tablet), 16px (mobile)
```

### Visual Example

```
┌─────────────────────────────────────────┐
│ Page Title                              │  18px, bold, text
│                                         │  12px gap (--space-3)
├─────────────────────────────────────────┤
│ ┌─ Card Header ──────────────────────┐ │  Light gray bg, 8px v
│ │                                    │ │  16px h padding
│ ├────────────────────────────────────┤ │  12px gap to body
│ │ Card Body Content                  │ │  White bg, 12px v
│ │                                    │ │  16px h padding
│ └────────────────────────────────────┘ │
│                                        │  16px gap to next card
│ ┌─ Card 2 ──────────────────────────┐ │
│ │ More content                       │ │
│ └────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

---

## 🎯 Component Patterns

### Button (`.ui-btn`)
```css
.ui-btn {              /* Base class required */
  padding: 8px 16px;   /* Sizes: sm, md (default), lg */
  --variant: primary;  /* Variants: secondary, ghost, success, danger */
}
```
**Usage:** All CTAs, form submissions, actions
**Example:** "Place Order", "Save", "Cancel"

### Card (`.ui-card` or `.cust-db__card`)
```css
.ui-card {             /* Generic card for modals/dialogs */
  padding: 24px;       /* Looser padding, standard size */
}

.cust-db__card {       /* Dashboard card for pages */
  --header-padding: 8px 16px;  /* Light gray header */
  --body-padding: 12px 16px;   /* White body */
}
```
**Usage:** Group related content
**Pattern:** Header (title) → Body (content) → Footer (optional)

### Badge (`.ui-badge`)
```css
.ui-badge {            /* Status indicator */
  --variant: success;  /* success, warning, danger, info, brand, neutral */
  padding: 4px 8px;    /* Small, compact */
  font-size: 11px;     /* Minimal size */
}
```
**Usage:** Status labels, tags, metadata
**Example:** "Pending", "Delivered", "Overdue"

### Alert (`.cust-db__alert`)
```css
.cust-db__alert {
  background: var(--color-brand-light);  /* Light bg */
  border: 1px solid var(--color-brand);  /* Brand border */
  padding: 12px 16px;                    /* Standard padding */
}
```
**Usage:** Informational messages, warnings, notices

### Empty State (`.cust-db__empty`)
```css
.cust-db__empty {
  min-height: 80px;                      /* Guided visual space */
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-3);            /* Light gray text */
}
```
**Usage:** No data states, loading placeholders
**Message:** "No orders yet. Place your first order."

---

## 🔄 Responsive Patterns

### Desktop (1024px+)
```css
.layout {
  display: flex;
  sidebar: 208px;
}

.grid { grid-template-columns: repeat(3, 1fr); }
```

### Tablet (768–1023px)
```css
.sidebar { width: 56px; }  /* Icon-only */
.grid { grid-template-columns: repeat(2, 1fr); }
```

### Mobile (≤767px)
```css
.sidebar { display: none; }  /* Mobile nav instead */
.grid { grid-template-columns: 1fr; }  /* Stacked */
.actions { position: fixed; bottom: 60px; }  /* Sticky footer */
```

---

## 🛠️ Common CSS Patterns

### Semantic Text Colors
```css
.title { color: var(--color-text); }       /* Primary → dark gray */
.subtitle { color: var(--color-text-2); }  /* Secondary → medium gray */
.label { color: var(--color-text-3); }     /* Tertiary → light gray (labels) */
.accent { color: var(--color-brand); }     /* Action → orange */
```

### Padding Convention
```css
/* Never hardcode px. Use tokens. */
.component {
  padding: var(--space-3) var(--space-4);  /* 12px v, 16px h (most common) */
}

/* Variations */
.tight { padding: var(--space-2); }        /* 8px all */
.standard { padding: var(--space-4); }     /* 16px all */
.spacious { padding: var(--space-5); }     /* 20px all */
```

### Border Convention
```css
.component {
  border: 1px solid var(--color-border);
  border-radius: var(--radius);  /* 8px modern */
  box-shadow: none;              /* Prefer borders over shadows */
}

/* For tight controls */
.tight-control {
  border-radius: var(--radius-sm);  /* 4px */
}
```

### Focus State Convention
```css
.interactive:focus-visible {
  outline: 2px solid var(--color-brand);
  outline-offset: 2px;
}
```

---

## 📊 File Architecture

```
src/
├─ styles/
│  ├─ tokens.css          ← Single source of truth
│  ├─ global.css          ← Typography reset, headings
│  └─ variables.css       ← Any additional custom properties
│
├─ components/
│  ├─ ui/
│  │  ├─ Button.css       ← .ui-btn, variants, sizes
│  │  ├─ Card.css         ← .ui-card
│  │  ├─ Badge.css        ← .ui-badge
│  │  ├─ Sidebar.css      ← Navigation
│  │  └─ Input.css        ← Form fields
│  │
│  └─ layouts/
│     └─ Layout.css       ← App shell (.layout, .layout__main, etc.)
│
└─ pages/
   ├─ customer/
   │  ├─ Dashboard.css           ← Reference pattern (use as template)
   │  ├─ OrdersPage.css          ← Apply dashboard pattern
   │  ├─ InvoicesPage.css        ← Apply dashboard pattern
   │  └─ TanksPage.css           ← Apply dashboard pattern
   │
   ├─ billing/
   │  └─ ...
   │
   └─ ...
```

---

## ✅ Validation Checklist

Before committing CSS changes:

- [ ] All colors use `--color-*` tokens (never hardcoded)
- [ ] All spacing uses `--space-*` tokens
- [ ] All font sizes use `--font-size-*` tokens
- [ ] Font weight: 400, 500, 600, 700 only
- [ ] Border radius: `--radius` (8px) for modern, `--radius-sm` (4px) for controls
- [ ] Responsive tested: 375px, 768px, 1024px
- [ ] Build clean: `npm run build` exits 0
- [ ] TS clean: `npx tsc --noEmit` exits 0
- [ ] No hardcoded hex colors, px values, or font sizes

---

## 🚫 What NOT To Do

❌ **Don't hardcode px values**
```css
/* BAD */
padding: 20px; color: #888; font-size: 14px;
```

❌ **Don't create custom font weights**
```css
/* BAD */
font-weight: 550;  /* Use 500 or 600 instead */
```

❌ **Don't use arbitrary border radius**
```css
/* BAD */
border-radius: 10px;  /* Use --radius (8px) or --radius-sm (4px) */
```

❌ **Don't mix card styles**
```css
/* BAD */
.my-card { padding: 20px; }
.other-card { padding: 12px; }
/* Choose one pattern: either ui-card or cust-db__card */
```

❌ **Don't skip responsive breakpoints**
```css
/* BAD */
.grid { grid-template-columns: repeat(3, 1fr); }
/* Should have @media queries for 768px and 375px */
```

---

## 📚 Learning Path

**For designers:**
1. Read STYLING_CONVENTIONS.md (understanding rules)
2. Review Dashboard.css (seeing implementation)
3. Check tokens.css (learning available values)

**For new developers:**
1. Read this file (overview)
2. Read UI_AUDIT_GUIDE.md (practical how-to)
3. Copy Dashboard.css as template
4. Reference tokens.css while coding

**For maintainers:**
1. All files above
2. Keep tokens.css as source of truth
3. Add standardization comments to complex CSS
4. Use UI_AUDIT_GUIDE.md for code review

---

## 💡 Tips & Tricks

### Use CSS Variables in JS (if needed)
```javascript
const spacing = getComputedStyle(document.documentElement)
  .getPropertyValue('--space-4')
  .trim();
// Returns "16px"
```

### Generate Utility Classes (optional)
```css
/* If you need utility helpers */
.u-p-sm { padding: var(--space-2); }
.u-p-md { padding: var(--space-3); }
.u-p-lg { padding: var(--space-4); }

.u-text-primary { color: var(--color-text); }
.u-text-secondary { color: var(--color-text-2); }
.u-text-tertiary { color: var(--color-text-3); }
```

### Test Dark Mode (Future)
```css
/* When dark mode is added */
@media (prefers-color-scheme: dark) {
  :root {
    --color-bg: #1a1a1a;
    --color-text: #f5f5f5;
    /* ... etc */
  }
}
```

---

## 📞 Questions?

- **How do I add a new token?** Update `tokens.css` and document in STYLING_CONVENTIONS.md
- **What if I need a custom color?** Check if a semantic color works first; add if truly unique
- **Can I use Tailwind?** No; we use a lightweight token system instead (more maintainable)
- **Should I use CSS-in-JS?** No; CSS files ensure consistency and performance

---

## 📝 Summary

**The goal:** A lightweight, token-based design system that's easy to learn, easy to maintain, and scales across all pages.

**The approach:**
1. ✅ Design tokens (colors, spacing, typography)
2. ✅ Responsive breakpoints (3 tiers)
3. ✅ Component patterns (buttons, cards, badges)
4. ✅ Page patterns (dashboard structure)
5. ✅ Documentation (this file + 2 more)

**The result:** Consistent, professional, scalable UI across the entire customer portal.
