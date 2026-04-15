# Design System — Palantir-style Situation Dashboard

## Product Context
- **What this is:** A high-stakes situation dashboard for mission-critical monitoring and response planning.
- **Who it's for:** Operational commanders, emergency responders, and strategic planners.
- **Space/industry:** Defense, Emergency Response, and Industrial Operations.
- **Project type:** Situation Dashboard / Command & Control Center.

## Aesthetic Direction
- **Direction:** Industrial / Utilitarian (Palantir AIP/Foundry inspired)
- **Decoration level:** Minimal (Data-first, no unnecessary embellishments)
- **Mood:** Serious, authoritative, mission-critical, and data-dense.
- **Reference sites:** Palantir Foundry, AIP Dashboards.

## Typography
- **Display/Hero:** Inter (Bold) — High legibility for critical status headers.
- **Body:** Inter (Regular/Medium) — Standard for operational text.
- **UI/Labels:** Inter (Semi-Bold, All-caps for status) — Clear distinction for metadata.
- **Data/Tables:** Geist Mono (Tabular-nums) — Essential for aligning numerical data and timestamps in mission-critical logs.
- **Code:** Geist Mono
- **Loading:** Google Fonts (Inter)
- **Scale:** Modular scale (base 16px)

## Color
- **Approach:** Restrained / Semantic (Color is rare and meaningful)
- **Primary (Background):** #0A0C10 (Deep charcoal/black for maximum contrast and low eye strain in dark rooms)
- **Secondary (Surface):** #161B22 (Slightly lighter for cards and panels)
- **Neutrals:** #8B949E (Muted text), #C9D1D9 (Primary text), #30363D (Borders)
- **Semantic:** 
  - Critical: #F85149 (Red)
  - Warning: #D29922 (Amber)
  - Success: #3FB950 (Green)
  - Info: #58A6FF (Blue)
- **Dark mode:** Default (Dark-only for command centers)

## Spacing
- **Base unit:** 4px
- **Density:** Compact (Maximum information density)
- **Scale:** 2xs(2) xs(4) sm(8) md(16) lg(24) xl(32) 2xl(48) 3xl(64)

## Layout
- **Approach:** Grid-disciplined (Strict columns, multi-pane layout)
- **Grid:** 12-column grid system.
- **Max content width:** 100vw (Full-screen dashboard)
- **Border radius:** Sharp/Minimal (sm: 2px, md: 4px)

## Motion
- **Approach:** Minimal-functional (Transitions only for state changes)
- **Easing:** enter(ease-out) exit(ease-in) move(ease-in-out)
- **Duration:** micro(50-100ms) short(150-250ms)

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-07 | Initial design system created | Created to match the provided Palantir dashboard image. |
