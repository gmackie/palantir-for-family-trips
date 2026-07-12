# Implementation Plan: Today Command + Reality Replan

**Design:** `docs/plans/2026-07-12-today-command-and-replan-design.md`  
**Slices:** S0 → S6

## S0 — Schema
- [ ] `trip_day.status`, `completed_at`, `actual_note`
- [ ] `trip.run_state`, `run_state_since`, `run_state_note`
- [ ] Migration `0011_today_command.sql` + apply prod
- [ ] Types in schema.ts + day-plan-ops SELECT

## S1 — todayCommand API
- [ ] Pure `computeLeaveBy` + tests
- [ ] `today-command-ops.ts` assembly
- [ ] `planner.todayCommand` + `setDayStatus` + `setRunState`

## S2 — Mobile Today
- [ ] `today.tsx` screen
- [ ] Entry from road-trip-detail + drive
- [ ] Mark done / navigate Maps

## S3 — replanPreview soft_days
- [ ] `replan-reality.ts` presets
- [ ] `planner.replanPreview`
- [ ] Mobile replan sheet (preview only)

## S4 — applyReplan soft_route
- [ ] Server apply via planItinerary fromDate path
- [ ] Accept on sheet

## S5 — Side-trip → run state + replan
- [ ] SideTripCard: Explore / Replan
- [ ] setRunState side_trip

## S6 — Web parity
- [ ] TodayCommandPanel + replan modal on dashboard
