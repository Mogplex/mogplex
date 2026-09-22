---
name: Mogplex App
description: Design guidance for Mogplex's repository workspaces and authenticated product surfaces.
colors:
  brand-accent: "oklch(66.57% 0.225 36.57)"
  brand-accent-hover: "oklch(61.6% 0.2079 36.63)"
  background-light: "oklch(96.88% 0.007 96)"
  card-light: "oklch(98.84% 0.006 95)"
  background-dark: "oklch(10.88% 0.006 132)"
  card-dark: "oklch(13.92% 0.007 128)"
  foreground-light: "oklch(17.48% 0.008 124)"
  foreground-dark: "oklch(94.57% 0.008 98)"
  muted-foreground-light: "oklch(54.72% 0.012 108)"
  muted-foreground-dark: "oklch(74.58% 0.011 103)"
  border-light: "oklch(89.8% 0.01 101)"
  border-dark: "oklch(28.11% 0.01 116)"
  success: "oklch(72.25% 0.192 149.58)"
  warning: "oklch(76.86% 0.1647 70.08)"
  destructive: "oklch(63.68% 0.2078 25.33)"
  info: "oklch(62.31% 0.188 259.81)"
typography:
  body:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "0.875rem"
    lineHeight: 1.4285714286
  label:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "0.75rem"
    lineHeight: 1.3333333333
  mono:
    fontFamily: "Geist Mono, SF Mono, monospace"
rounded:
  sm: "2px"
  md: "4px"
  lg: "6px"
  xl: "10px"
  2xl: "12px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  6: "24px"
  8: "32px"
components:
  button-primary:
    backgroundColor: "{colors.brand-accent}"
    textColor: "{colors.card-light}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: "36px"
  input:
    rounded: "{rounded.md}"
    height: "36px"
  card:
    rounded: "{rounded.lg}"
  app-navigation-link:
    rounded: "{rounded.lg}"
    height: "40px"
---

# Design System: Mogplex App

## Overview

This guide covers the authenticated app: repository workspaces, Control,
agents, flows, models, settings, and operational views. Read [PRODUCT.md](./PRODUCT.md)
for users, purpose, and accessibility principles. The interface should be
precise, calm, and capable, with the selected repository, runtime, task, and
action consequences visible where they matter.

**Scope matters.** This is product UI guidance, not a universal marketing style.
Landing pages and public marketing/auth surfaces have their own scoped styles in
[components/marketing](./components/marketing), including `landing-v2.css`,
`subpage.css`, and `auth.css`. Preserve their established typography and visual
direction when working there; do not apply this document as a marketing redesign.

The code is the source of truth. Values above describe the shared app defaults,
not every contextual override. Use the semantic tokens in
[app/globals.css](./app/globals.css), the fonts in [app/layout.tsx](./app/layout.tsx),
and the existing [UI primitives](./components/ui). Update this guide in the same
change when those defaults change. Do not copy its literal colors into components.

Dense layouts are appropriate when they preserve readable context and actions.
At narrow widths, rearrange or collapse panels deliberately instead of shrinking
text and controls. Keep motion tied to state feedback and respect reduced motion.
The former generated `DESIGN.json` remains a historical archive, not an active
token source or required companion to this guide.

## Colors

Warm neutrals carry the app, with orange for primary actions and restrained
semantic colors for state. Light and dark themes use the same semantic roles.

- Use `background`/`foreground` for the page and its text, `card`/`card-foreground`
  for raised content, and `popover`/`popover-foreground` for floating content.
- Use `primary`/`primary-foreground` for primary actions. The CSS `accent` role is
  a neutral interaction surface; it is different from the orange `brand-accent`.
- Use `muted-foreground` for secondary text and `border`/`input` for boundaries.
  Keep the `sidebar-*` roles for navigation.
- Use `accent-green`, `accent-amber`, `destructive`/`accent-red`, and `accent-blue`
  for success, warning, failure, and information. Preserve established chart and
  project-color mappings rather than assigning new meanings to their colors.
- Control has an existing `ink-*` scale and `addg`/`delr` roles. Preserve those
  mappings when editing Control; do not replace them with literal color values.

**State needs more than color.** Pair status with text, an icon, or another
accessible indicator. Confirm text and focus contrast in both themes.

## Typography

Use `font-sans` for human-readable text and `font-mono` for code, paths, commands,
identifiers, and machine values. The layout loads Geist Sans and Geist Mono;
the CSS font variables supply their fallback stacks.

Shared controls and descriptions commonly use `text-sm` (14px with a 20px line
height); compact metadata uses `text-xs` (12px with a 16px line height). These are
common roles, not a requirement to resize every view. Use the surrounding
screen's heading hierarchy instead of inventing a global heading size.

The shared input uses `text-base` (16px) below the `md` breakpoint and `text-sm`
from `md` upward. Preserve this distinction. Use display typography only within
surfaces that already define it, not in routine app labels or controls.

## Elevation

Use tonal surfaces and one-pixel borders for ordinary separation. The app's
`--radius` is 6px; the frontmatter radius keys match the Tailwind aliases derived
from it. The badge's explicit 3px radius is a component-specific exception.

The app shadow vocabulary in `app/globals.css` is:

| Token | Geometry | Role |
| --- | --- | --- |
| `--app-shadow-sm` | `0 1px 2px`, 5% opacity | Small control separation |
| `--app-shadow-md` | `0 4px 12px`, 10% opacity | Raised content |
| `--app-shadow-lg` | `0 10px 30px`, 18% opacity | Floating overlays |
| `--app-shadow-card` | `0 12px 30px`, 12% opacity | Surfaces using `shadow-app-card` |
| `--app-shadow-panel` | `0 18px 50px`, 14% opacity | Surfaces using `shadow-app-panel` |

All five use the dark neutral hue defined in CSS. These app tokens are distinct
from Tailwind's `shadow-xs`, `shadow-sm`, and `shadow-lg` utilities used by shared
primitives. Reuse the component's existing elevation before adding another shadow.

## Components

Reuse the implementations below, including their variant APIs and accessibility
behavior. Defaults can be overridden by the owning screen; inspect it first.

- **[Button](./components/ui/button.tsx):** 4px corners; default, small, and large
  heights of 36px, 32px, and 40px. Use the existing primary, destructive, outline,
  secondary, ghost, and link variants. Primary hover uses `primary/90`, not the
  separate brand-hover token. Focus uses a 3px ring; active feedback scales to
  97% with a 150ms base transition. Keep loading labels stable in width where
  practical and explain unavailable actions nearby.
- **[Input](./components/ui/input.tsx):** 36px height, 4px corners, horizontal
  padding of 12px, a transparent light background, and `input/30` in dark mode.
  Preserve the focus ring, `aria-invalid` treatment, responsive text size, and
  associated label. A placeholder is not a label.
- **[Card](./components/ui/card.tsx):** 6px corners, border, and `shadow-sm`.
  The container has 24px vertical padding and gap; header, content, and footer
  provide their own 24px horizontal padding. Do not add another blanket padding
  layer or wrap every section in a card.
- **[Badge](./components/ui/badge.tsx):** 3px corners, 12px medium text, and
  padding of 2px vertically and 8px horizontally. Reuse `live`, `warn`, and
  `error` variants for their existing meanings and include a readable label.
- **[App navigation](./components/app-sidebar.tsx):** app links use 40px rows,
  6px corners, Iconoir icons, and `aria-current` on the active destination.
  The generic [sidebar menu](./components/ui/sidebar-menu.tsx) has different
  defaults (32px rows, 4px corners); these are separate components.
  Settings opens a secondary menu in the same sidebar, with a back arrow to
  restore the main navigation. Each Settings section has a scoped page URL.
  The mobile navigation sheet follows the same pattern and closes after a
  section is selected. Billing has Billing Settings and Usage tabs.
  Connections has Integrations and MCP Servers tabs; MCP Servers is not a
  Settings section.
- **[Dialog](./components/ui/dialog.tsx):** reuse the Radix-backed focus and
  dismissal behavior, 6px corners, 24px padding, and responsive action layout.
  Provide a title and description. Use inline disclosure when it can complete
  the task without interrupting the surrounding work.

For each changed interaction, account for hover, focus, active, disabled,
loading, empty, error, and success states where applicable. Use semantic controls
and accessible names for icon actions. Preserve usable touch targets and verify
keyboard flow and narrow layouts when changing UI.

## Do's and Don'ts

- Do show the exact resource and context affected by an action.
- Do reuse semantic theme tokens and existing primitives.
- Do distinguish repository state, agent execution, and sandbox lifecycle.
- Do explain unavailable actions and errors in language the operator can act on.
- Do preserve light/dark behavior, visible focus, and reduced-motion support.
- Do update this document when shared defaults change, with code as evidence.
- Don't resemble a decorative AI demo, a disconnected chatbot, or a Git client
  that obscures runtime behavior, as described in PRODUCT.md.
- Don't add ornamental motion, novelty controls, or broad visual churn.
- Don't collapse distinct resources into one label or icon.
- Don't copy marketing display treatments into routine app controls.
- Don't infer new token values or universal component rules from the old archive.
