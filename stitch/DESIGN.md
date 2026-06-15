---
name: Kinetic Governance
colors:
  surface: '#f7f9fb'
  surface-dim: '#d8dadc'
  surface-bright: '#f7f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f6'
  surface-container: '#eceef0'
  surface-container-high: '#e6e8ea'
  surface-container-highest: '#e0e3e5'
  on-surface: '#191c1e'
  on-surface-variant: '#45464d'
  inverse-surface: '#2d3133'
  inverse-on-surface: '#eff1f3'
  outline: '#76777d'
  outline-variant: '#c6c6cd'
  surface-tint: '#565e74'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#131b2e'
  on-primary-container: '#7c839b'
  inverse-primary: '#bec6e0'
  secondary: '#515f74'
  on-secondary: '#ffffff'
  secondary-container: '#d5e3fd'
  on-secondary-container: '#57657b'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#0b1c30'
  on-tertiary-container: '#75859d'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae2fd'
  primary-fixed-dim: '#bec6e0'
  on-primary-fixed: '#131b2e'
  on-primary-fixed-variant: '#3f465c'
  secondary-fixed: '#d5e3fd'
  secondary-fixed-dim: '#b9c7e0'
  on-secondary-fixed: '#0d1c2f'
  on-secondary-fixed-variant: '#3a485c'
  tertiary-fixed: '#d3e4fe'
  tertiary-fixed-dim: '#b7c8e1'
  on-tertiary-fixed: '#0b1c30'
  on-tertiary-fixed-variant: '#38485d'
  background: '#f7f9fb'
  on-background: '#191c1e'
  surface-variant: '#e0e3e5'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  title-sm:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-caps:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.05em
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  container-margin: 32px
  gutter: 16px
  stack-sm: 8px
  stack-md: 16px
  stack-lg: 24px
---

## Brand & Style

The design system is engineered for high-stakes enterprise environments where clarity, precision, and security are paramount. The brand personality is authoritative yet unobtrusive, positioning itself as a reliable infrastructure tool rather than a consumer-facing product. 

The aesthetic follows a **Corporate / Modern** direction with a focus on systematic organization. It leverages a rigorous grid, subtle depth, and a restrained color palette to reduce cognitive load during complex administrative tasks. The goal is to evoke a sense of "controlled transparency"—making complex permission structures feel navigable and safe. High-density information is balanced by generous white space in the surrounding chrome to maintain focus on the data.

## Colors

The palette is anchored in a professional range of Slate and Navy blues, providing a sturdy foundation for administrative navigation. 

- **Primary:** Deep Navy (#0F172A) is reserved for high-level navigation, primary buttons, and critical headers.
- **Secondary/Tertiary:** Mid-tone slates manage sub-navigation and secondary UI elements, ensuring a clear visual hierarchy of importance.
- **Backgrounds:** A tiered system of neutrals (Slate-50 to Slate-200) separates the canvas from the content containers.
- **Semantic Colors:** Success, Warning, and Error colors are used strictly for status indicators, validation, and destructive actions (e.g., "Revoke Access"). These colors must maintain a 4.5:1 contrast ratio against white for accessibility.

## Typography

This design system utilizes **Inter** for its exceptional legibility in data-heavy interfaces. The typographic scale is compact to accommodate complex table views and nested permission lists without excessive scrolling.

- **Headlines:** Use Bold and Semi-Bold weights to anchor page sections. 
- **Body:** The default size is 14px for standard interaction, scaling down to 13px for dense data grids.
- **Labels:** Uppercase labels with slight letter spacing are used for table headers and section overviews to differentiate them from interactive content.
- **Monospace:** **JetBrains Mono** is introduced for technical identifiers like API keys, User IDs, or JSON permission snippets, ensuring no ambiguity between similar characters (e.g., 0 and O).

## Layout & Spacing

The layout utilizes a **12-column fluid grid** for main content areas, with a fixed-width sidebar for primary navigation (256px). 

- **Spacing Rhythm:** Based on a 4px baseline. Most components use 8px (sm) or 16px (md) increments for internal padding.
- **Data Grids:** Use a condensed 8px vertical padding for table rows to maximize information density.
- **Breakpoints:**
  - **Desktop (1280px+):** Full sidebar and multi-column data views.
  - **Tablet (768px - 1279px):** Sidebar collapses to icons; tables may introduce horizontal scrolling for secondary columns.
  - **Mobile (<767px):** Single column layout; navigation moves to a top-bar with a drawer. Mobile is considered a "viewing/approval" mode rather than a full "configuration" mode.

## Elevation & Depth

This design system uses **Tonal Layers** combined with low-opacity **Ambient Shadows** to define hierarchy.

1. **Floor (Level 0):** The primary background (#F8FAFC).
2. **Card/Surface (Level 1):** White background with a 1px border (#E2E8F0). No shadow. This is for standard table containers.
3. **Elevated (Level 2):** White background with a soft shadow (0px 4px 6px -1px rgba(0,0,0,0.1)). Used for dropdowns, popovers, and active state cards.
4. **Overlay (Level 3):** Modal windows. Features a 15% opacity Slate-900 backdrop blur and a deeper shadow (0px 20px 25px -5px rgba(0,0,0,0.1)).

Borders are the primary method of separation, while shadows are reserved for temporary or floating UI elements.

## Shapes

The shape language is **Soft (0.25rem)**, emphasizing a professional and engineered feel. 

- **Small Components:** Checkboxes, small buttons, and input fields use a 4px radius.
- **Medium Components:** Cards, modals, and larger containers use an 8px (rounded-lg) radius.
- **Status Pills:** Use a fully rounded (pill-shaped) radius to distinguish them from interactive buttons.

Sharp corners are avoided to keep the interface approachable, but large radii are avoided to maintain a serious, enterprise-grade aesthetic.

## Components

- **Buttons:** 
  - *Primary:* Solid Slate-900 with white text. 
  - *Secondary:* White background with Slate-200 border and Slate-700 text. 
  - *Ghost:* No background or border; text color matches intent (Primary or Error).
- **Inputs:** Solid 1px border (#CBD5E1). Active state uses a 2px Primary blue ring with 0px offset. Labels are always visible above the field.
- **Data Tables:** Zebra striping is not used; instead, use thin #F1F5F9 bottom borders. Hover states on rows use #F8FAFC. 
- **Chips/Badges:** Small, subtle backgrounds (e.g., Success Green at 10% opacity) with high-contrast text for role tags or status indicators.
- **Navigation:** Vertical sidebar with active states indicated by a 3px left-aligned primary blue border and a subtle background tint.
- **Permission Toggles:** Custom switch component with a clear "On" (Primary) and "Off" (Slate-300) state to prevent accidental permission changes.