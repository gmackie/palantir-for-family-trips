# Ferry Leg + OCR-Assisted Entry — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make a ferry crossing a first-class, non-drivable road-trip leg with "leave-by" ETA gating, a splittable draft expense for the fare, and OCR-assisted entry from a ferry booking image/PDF.

**Architecture:** A new trip-scoped `ferryCrossings` table holds the crossing. A `ferries` tRPC router (guarded by `tripProcedure`) does CRUD, spawns/links a draft `transport` expense for the fare, and exposes `extractFromImage` backed by a generalized vision extractor. The road-trip planner treats the crossing as non-drivable time and computes a "leave-by" deadline. Receipt OCR path is left untouched; the extractor is generalized so ferry reuses it (DRY).

**Tech Stack:** Drizzle + postgres.js, tRPC, Zod, `@anthropic-ai/sdk` (`messages.parse` + `zodOutputFormat`), Vitest, React 19 / `@sortey/ui`, Expo.

**Design doc:** `docs/plans/2026-06-21-ferry-leg-ocr-design.md`

**Conventions to mirror (read first):**
- Schema style: `packages/db/src/schema.ts` (functional `pgTable("name", (t) => ({...}))`, existing `transitTypeEnum` ~line 914).
- Router style + guards: `packages/api/src/router/trips.ts`, `packages/api/src/auth/guards.ts` (`tripProcedure`).
- Money: never hand-roll — reuse expense draft creation in `packages/api/src/router/expenses.ts` and `@sortey/validators/money`.
- OCR: `packages/api/src/ocr/{index,schema,claude-extractor,gemini-extractor,mock-provider}.ts`.
- Route planner: `packages/api/src/router/route-planner.ts` (auto-split, `GoogleRouteLeg`, daylight/12h budget).

---

## Task 1: Add `ferry` to the transit enum

**Files:**
- Modify: `packages/db/src/schema.ts:914-921` (`transitTypeEnum`)

**Step 1:** Add `"ferry"` to the `transitTypeEnum` array (after `"car"`, before `"other"`).

**Step 2:** Typecheck: `pnpm -F @sortey/db typecheck` → PASS (no other code switches exhaustively on this enum; if a `switch` errors, add a `case "ferry"` no-op).

**Step 3:** Commit.
```bash
git add packages/db/src/schema.ts
git commit -m "feat(db): add ferry to transitTypeEnum"
```

---

## Task 2: `ferryCrossings` table + migration

**Files:**
- Modify: `packages/db/src/schema.ts` (add table near `memberTransits`)
- Generate: `packages/db/drizzle/0007_*.sql`

**Step 1:** Add the table (mirror existing pgTable style; reference `trips`, `tripSegments`, `user`, `expenses`):
```ts
export const ferrySourceEnum = ["manual", "ocr"] as const;
export type FerrySource = (typeof ferrySourceEnum)[number];

export const ferryCrossings = pgTable("ferry_crossing", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  tripId: t.uuid().notNull().references(() => trips.id, { onDelete: "cascade" }),
  createdByUserId: t.text().notNull().references(() => user.id, { onDelete: "cascade" }),
  operator: t.varchar({ length: 200 }),
  departureTerminal: t.varchar({ length: 200 }),
  arrivalTerminal: t.varchar({ length: 200 }),
  scheduledDepartureAt: t.timestamp({ mode: "date", withTimezone: true }),
  durationMinutes: t.integer(),
  arrivalCutoffMinutes: t.integer().notNull().default(30),
  vehicleReservation: t.boolean().notNull().default(false),
  confirmationNumber: t.varchar({ length: 100 }),
  fareCents: t.integer(),
  currency: t.varchar({ length: 3 }).notNull().default("USD"),
  fareNote: t.varchar({ length: 200 }),
  afterSegmentId: t.uuid().references(() => tripSegments.id, { onDelete: "set null" }),
  source: t.text().$type<FerrySource>().notNull().default("manual"),
  sourceRaw: t.text(),
  ocrProvider: t.varchar({ length: 20 }),
  ocrConfidence: t.numeric({ precision: 4, scale: 3 }),
  expenseId: t.uuid().references(() => expenses.id, { onDelete: "set null" }),
  createdAt: t.timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
  updatedAt: t.timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
}));

export const insertFerryCrossingSchema = createInsertSchema(ferryCrossings);
```

**Step 2:** Generate migration: `pnpm db:generate` → produces `0007_*.sql`. Inspect it — must be a single `CREATE TABLE`, no drops.

**Step 3:** Apply locally: `pnpm db:push` (or `pnpm db:migrate`) against the dev DB → PASS.

**Step 4:** Commit.
```bash
git add packages/db/src/schema.ts packages/db/drizzle/
git commit -m "feat(db): add ferry_crossing table"
```

---

## Task 3: Ferry booking OCR schema

**Files:**
- Modify: `packages/api/src/ocr/schema.ts` (append; leave `receiptExtractionSchema` untouched)
- Test: `packages/api/src/ocr/__tests__/ferry-schema.test.ts`

**Step 1 (test first):**
```ts
import { describe, expect, it } from "vitest";
import { ferryBookingSchema } from "../schema";

describe("ferryBookingSchema", () => {
  it("parses a WSF-style booking", () => {
    const parsed = ferryBookingSchema.parse({
      operator: "Washington State Ferries",
      departureTerminal: "Edmonds",
      arrivalTerminal: "Kingston",
      departureAt: "2026-07-09T14:05:00",
      confirmationNumber: "WSF-12345",
      fareCents: 1675,
      currency: "USD",
      vehicleReservation: true,
      passengerNote: "Car + 2 passengers",
    });
    expect(parsed.arrivalTerminal).toBe("Kingston");
    expect(parsed.fareCents).toBe(1675);
  });

  it("defaults optional fields", () => {
    const parsed = ferryBookingSchema.parse({
      operator: "WSF", departureTerminal: "Edmonds", arrivalTerminal: "Kingston",
      departureAt: "2026-07-09T14:05:00", currency: "USD",
    });
    expect(parsed.vehicleReservation).toBe(false);
    expect(parsed.fareCents).toBeNull();
  });
});
```

**Step 2:** Run → FAIL (`ferryBookingSchema` not exported).

**Step 3:** Add to `schema.ts`:
```ts
export const ferryBookingSchema = z.object({
  operator: z.string().describe("Ferry operator/line, e.g. 'Washington State Ferries'"),
  departureTerminal: z.string().describe("Departure terminal/dock name"),
  arrivalTerminal: z.string().describe("Arrival terminal/dock name"),
  departureAt: z.string().describe("ISO 8601 scheduled departure. If no time, use 12:00:00 local."),
  confirmationNumber: z.string().nullable().default(null).describe("Booking/confirmation number if printed"),
  fareCents: z.number().int().nonnegative().nullable().default(null).describe("Total fare in minor units (cents)"),
  currency: z.string().min(3).max(3).describe("ISO 4217 currency code"),
  vehicleReservation: z.boolean().default(false).describe("True if a vehicle space is reserved"),
  passengerNote: z.string().nullable().default(null).describe("Free text e.g. 'Car + 2 passengers'"),
});
export type FerryBooking = z.infer<typeof ferryBookingSchema>;
```

**Step 4:** Run → PASS. **Step 5:** Commit `feat(ocr): ferry booking extraction schema`.

---

## Task 4: Generalize the vision extractor (DRY) + ferry fixture

**Files:**
- Create: `packages/api/src/ocr/extract-structured.ts` — generic vision→Zod helper
- Modify: `packages/api/src/ocr/claude-extractor.ts` — refactor `ClaudeReceiptExtractor.extract` to delegate to the helper (behavior unchanged)
- Modify: `packages/api/src/ocr/mock-provider.ts` — support a ferry fixture lookup
- Create: `packages/api/src/ocr/__fixtures__/ferry-wsf.json` — canned `FerryBooking`
- Test: `packages/api/src/ocr/__tests__/ferry-extract.test.ts`

**Step 1 (test first):** drive a `MockOCRProvider`-style ferry extraction returning the fixture:
```ts
import { describe, expect, it } from "vitest";
import { extractFerryBooking } from "../index";

it("mock provider extracts ferry booking from fixture", async () => {
  process.env.OCR_PROVIDER = "fixture";
  const result = await extractFerryBooking({ imageBytes: Buffer.from("wsf"), mimeType: "image/png" });
  expect(result.arrivalTerminal).toBe("Kingston");
});
```

**Step 2:** Run → FAIL (`extractFerryBooking` not exported).

**Step 3:** Implement:
- `extract-structured.ts`: `extractStructured<T>({ client, model, systemPrompt, userText, schema, imageBytes, mimeType }): Promise<T>` — the exact `messages.parse` body currently in `claude-extractor.ts`, but `output_config.format = zodOutputFormat(schema)` and `userText`/`systemPrompt` parameterized.
- Refactor `ClaudeReceiptExtractor.extract` to call `extractStructured({ schema: receiptExtractionSchema, systemPrompt: RECEIPT_EXTRACTION_SYSTEM_PROMPT, userText: "Extract this receipt into the structured JSON format." , ... })`. Receipt tests must still pass.
- Add `FERRY_EXTRACTION_SYSTEM_PROMPT` (terminals, departure time, confirmation, fare, vehicle).
- `index.ts`: `export async function extractFerryBooking(input): Promise<FerryBooking>` — resolves provider via the same env precedence as receipts; `fixture`/`DEV_MODE=local` reads `__fixtures__/ferry-wsf.json`; otherwise runs `extractStructured` with the ferry schema/prompt.

**Step 4:** Run ferry test + existing OCR tests: `pnpm -F @sortey/api test ocr` → PASS (receipt path unchanged).

**Step 5:** Commit `feat(ocr): generalized vision extractor + ferry booking extraction`.

---

## Task 5: "Leave-by" computation (pure function, TDD)

**Files:**
- Create: `packages/api/src/router/ferry-eta.ts`
- Test: `packages/api/src/router/__tests__/ferry-eta.test.ts`

**Step 1 (test first):**
```ts
import { describe, expect, it } from "vitest";
import { computeLeaveBy } from "../ferry-eta";

describe("computeLeaveBy", () => {
  it("subtracts drive time + cutoff from departure", () => {
    const leaveBy = computeLeaveBy({
      scheduledDepartureAt: new Date("2026-07-09T14:05:00Z"),
      arrivalCutoffMinutes: 30,
      driveMinutesToTerminal: 75,
    });
    // 14:05 - 30 - 75 = 12:20
    expect(leaveBy?.toISOString()).toBe("2026-07-09T12:20:00.000Z");
  });
  it("returns null when departure unknown", () => {
    expect(computeLeaveBy({ scheduledDepartureAt: null, arrivalCutoffMinutes: 30, driveMinutesToTerminal: 75 })).toBeNull();
  });
});
```

**Step 2:** Run → FAIL.
**Step 3:** Implement `computeLeaveBy` (return `null` if `scheduledDepartureAt` is null; else `departure - (cutoff + drive) minutes`). Also export `ferryNonDrivableMinutes({durationMinutes, arrivalCutoffMinutes})` = `(durationMinutes ?? 0) + arrivalCutoffMinutes`.
**Step 4:** Run → PASS.
**Step 5:** Commit `feat(api): ferry leave-by + non-drivable time helpers`.

---

## Task 6: `ferries` router — CRUD + guard

**Files:**
- Create: `packages/api/src/router/ferries.ts`
- Modify: `packages/api/src/root.ts` (import + mount `ferries: ferriesRouter`)
- Test: `packages/api/src/router/__tests__/ferries.test.ts`

**Step 1 (test first):** mirror the membership-guard pattern from `trips.test.ts`. Cover: `create` returns a row scoped to the trip; a non-member calling `listForTrip` gets a `FORBIDDEN`/`NOT_FOUND` from `tripProcedure` (negative case).

**Step 2:** Run → FAIL.

**Step 3:** Implement `ferriesRouter` with `tripProcedure` for: `create`, `update`, `delete`, `listForTrip`. Inputs validated with Zod derived from `insertFerryCrossingSchema` (omit server-managed fields). `source` defaults `"manual"`. No expense yet (Task 7).

**Step 4:** Mount in `root.ts`. Run `pnpm -F @sortey/api test ferries` → PASS.

**Step 5:** Commit `feat(api): ferries router CRUD under tripProcedure`.

---

## Task 7: Fare → draft expense link

**Files:**
- Modify: `packages/api/src/router/ferries.ts`
- Test: extend `packages/api/src/router/__tests__/ferries.test.ts`

**Step 1 (test first):** creating a ferry with `fareCents > 0` populates `expenseId`, and an expense row exists with category `transport`, amount = `fareCents`, currency = ferry currency, split across trip members. Creating with no fare leaves `expenseId` null.

**Step 2:** Run → FAIL.

**Step 3:** In `create`/`update`, when `fareCents` is set, call the **existing** expense-draft creation path used elsewhere (reuse the helper `expensesRouter` uses — do NOT duplicate money logic; if it's inlined in `expenses.ts`, extract a shared `createTransportDraft(...)` into `packages/api/src/expenses/` and have both call it). Store the returned id in `ferryCrossings.expenseId`. On fare change, update the linked expense; on delete, soft-handle per existing expense rules.

**Step 4:** Run → PASS. **Step 5:** Commit `feat(api): ferry fare spawns splittable transport expense`.

---

## Task 8: `extractFromImage` mutation

**Files:**
- Modify: `packages/api/src/router/ferries.ts`
- Test: extend ferries test (use `OCR_PROVIDER=fixture`)

**Step 1 (test first):** `extractFromImage` with a base64 image returns parsed `FerryBooking` fields (from fixture) and does NOT persist anything.

**Step 2:** Run → FAIL.

**Step 3:** Add `extractFromImage` (`tripProcedure`): input `{ imageBase64, mimeType }` (rasterize PDF→PNG if `application/pdf` — use existing image util if present, else accept image MIME only for v1 and note PDF as follow-up). Calls `extractFerryBooking`; returns fields for the form to pre-fill. Wrap in try/catch → on failure return `{ ok: false }` (never throw to the client).

**Step 4:** Run → PASS. **Step 5:** Commit `feat(api): ferries.extractFromImage OCR pre-fill`.

---

## Task 9: Route-planner ETA gating

**Files:**
- Modify: `packages/api/src/router/route-planner.ts`
- Test: `packages/api/src/router/__tests__/route-planner-ferry.test.ts`

**Step 1 (test first):** given a planner result and one ferry crossing on the trip, the day-split output includes the ferry's `ferryNonDrivableMinutes` as non-driving time (does not consume the 12h driving budget) and surfaces a `leaveBy` for the leg whose drive ends at the terminal.

**Step 2:** Run → FAIL.

**Step 3:** Read `ferryCrossings` for the trip in the planner output assembly; for the leg arriving at `departureTerminal` (or positioned via `afterSegmentId`), attach `{ leaveBy, nonDrivableMinutes }` using Task 5 helpers. Keep the change additive — existing planner output shape stays; ferry data is attached, not replacing.

**Step 4:** Run planner tests → PASS. **Step 5:** Commit `feat(api): route planner accounts for ferry legs`.

---

## Task 10: `@sortey/ui` — ferry card + input form

**Files:**
- Create: `packages/ui/src/ferry-leg-card.tsx` + `ferry-leg-card.stories.tsx`
- Create: `packages/ui/src/ferry-input-form.tsx` + `ferry-input-form.stories.tsx`
- Modify: `packages/ui/src/index.ts` (barrel) + `packages/ui/package.json` (subpath exports)

**Step 1:** `ferry-leg-card.tsx` — presentational: operator, terminals (Edmonds → Kingston), departure + "leave by" (monospace times per `DESIGN.md`), fare, vehicle-reservation badge. Props only; no fetching.

**Step 2:** `ferry-input-form.tsx` — tabbed **Manual / Scan ticket**. Scan tab: file input + "Extract" button → `onExtract(file)` callback (parent wires `ferries.extractFromImage`); results pre-fill the manual fields for review before submit. TanStack Form, matching existing form components.

**Step 3:** Stories: Default + Empty + Loading (states matrix). Add barrel + subpath exports (`"./ferry-leg-card"`, `"./ferry-input-form"`).

**Step 4:** `pnpm -F @sortey/ui typecheck` + storybook builds. **Step 5:** Commit `feat(ui): ferry leg card + input form`.

---

## Task 11: Web wiring — road-trip route view

**Files:**
- Modify: `apps/nextjs/src/app/trips/[tripId]/road-trip/` (page + `_components`)

**Step 1:** Add a "Ferries" section: list crossings (`ferries.listForTrip`), an "Add ferry" affordance opening `ferry-input-form`, wiring `ferries.create`/`extractFromImage`. Show `leaveBy` from the planner output where present.

**Step 2:** `pnpm -F @sortey/nextjs typecheck` + a Playwright happy-path (add ferry manually → appears in list). **Step 3:** Commit `feat(web): ferry legs on road-trip view`.

---

## Task 12: Mobile — Driving Mode ferry card (read-only)

**Files:**
- Modify: `apps/expo/src/app/trip/[tripId]/drive.tsx` (+ a component under `apps/expo/src/components/trip/`)

**Step 1:** Read-only card: next ferry for the trip with departure + "leave by" countdown. No entry on mobile in v1.

**Step 2:** `pnpm -F @sortey/expo typecheck`. **Step 3:** Commit `feat(mobile): ferry card in Driving Mode`.

---

## Task 13: Docs + status sync

**Files:**
- Modify: `docs/ai/STATUS.md` (note ferry leg + first OCR write-path wiring)
- Modify: `docs/ai/COOKBOOK.md` if a new recipe is warranted (generalized extractor)

**Step:** Update, then full gate: `pnpm turbo run typecheck` + `pnpm -F @sortey/api test` → PASS. Commit `docs: record ferry leg + OCR wiring`.

---

## Final verification (whole feature)
- `pnpm turbo run typecheck` clean across workspaces.
- `pnpm -F @sortey/api test` passes (ferry schema, extractor, leave-by, ferries router incl. guard + fare→expense, planner gating).
- Local manual: create a trip → road-trip view → "Add ferry" → Scan a WSF confirmation (DEV_MODE=local fixture) → fields pre-fill → save → fare appears as a splittable transport expense → planner shows "leave by".
- `DESIGN.md` aesthetic respected (monospace times, semantic status colors).
