# SCEN identity — developer handoff

Two marks in one family: **SCEN Student Hub** (open arch + node) and **SCEN Coordinator Tools**
(filled arch + stepped columns). Standalone marks — do not merge with the Sorbonne University
Abu Dhabi logo; place that lockup separately at equal or greater visual weight.

## Files

| File | Use |
|---|---|
| `student-hub-mark.svg` | primary mark, light backgrounds |
| `student-hub-mark-reversed.svg` | on navy / photos |
| `student-hub-mark-mono.svg` | 1-color; inherits `color` via `currentColor` |
| `student-hub-icon.svg` | app icon / favicon (rounded navy tile, 120×120) |
| `coordinator-tools-*.svg` | same four for the coordinator app |

Marks are `viewBox="0 0 100 104"`; icons `0 0 120 120`. All are flat paths, no embedded fonts.

## Tokens

```css
:root {
  --scen-navy: #182B62;
  --scen-accent: #EA3A24;
  --scen-surface: #F2F2EF;
}
```

## Type

Archivo (Google Fonts).
- Name: `font-weight: 800; letter-spacing: .05em` — "SCEN"
- Label: `font-weight: 600; text-transform: uppercase; letter-spacing: .22em` — "Student Hub" / "Coordinator Tools", ~35% of the name's size.

## Rules

- Minimum mark height: 24px on screen.
- Clear space on all sides: the plinth width (~8% of the mark height).
- Never restack, recolor beyond the variants above, outline, or add effects.

## Snippets

Header lockup:

```jsx
<a href="/" className="flex items-center gap-3 text-[#182B62]">
  <img src="/assets/logos/student-hub-mark.svg" alt="" className="h-9 w-auto" />
  <span className="flex flex-col leading-none">
    <span className="text-xl font-extrabold tracking-[.05em]">SCEN</span>
    <span className="mt-1 text-[10px] font-semibold uppercase tracking-[.22em] opacity-60">
      Student Hub
    </span>
  </span>
</a>
```

Favicon:

```html
<link rel="icon" type="image/svg+xml" href="/assets/logos/student-hub-icon.svg" />
<link rel="apple-touch-icon" href="/assets/logos/student-hub-icon.png" /> <!-- rasterize at 180px -->
```

Inline mono mark (inherits text color):

```jsx
<svg viewBox="0 0 100 104" className="h-6 w-auto fill-current" aria-hidden>
  <path fillRule="evenodd" d="M14 88 L14 44 A36 36 0 0 1 86 44 L86 88 Z M28 88 L28 46 A22 22 0 0 1 72 46 L72 88 Z" />
  <rect x="8" y="92" width="84" height="9" rx="2" />
</svg>
```
