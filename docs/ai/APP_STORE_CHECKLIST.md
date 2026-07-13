# App Store Connect Checklist — Sortey iOS

**Last updated:** 2026-07-13  
**ASC app:** com.gmacko.sortey · ascAppId `6775057200`  
**Latest production build:** EAS `ad91ed11` · iOS **0.1.0 (7)** · channel `production` · finished 2026-07-13  

**EAS Submit (automated):** build **7 already uploaded** to ASC/TestFlight  
(`submission dcc419a5` status `FINISHED` at 2026-07-13T19:43Z). Later re-submits of the same build error (duplicate).  

```bash
# From apps/expo — uses eas.json submit.production (ascAppId 6775057200)
pnpm submit:ios                    # latest production iOS build
pnpm submit:ios:id <build-id>      # specific build
pnpm build:ios:production:submit   # build + auto-submit in one shot
```

Do **not** pass `--what-to-test` unless on Expo Enterprise (changelog param is plan-gated).

(see `LAUNCH_READINESS.md`)

## Assets

| Asset | Status | Path / notes |
|-------|--------|----------------|
| App icon 1024 | ✅ | Expo assets / ASC |
| iPhone 6.9" screenshots | 🟡 Drafts (3 of ~5–8 needed) | `apps/expo/assets/app-store/drafts/` |
| iPad 13" screenshots | ❌ | Capture from iPad simulator or device |
| Preview video | Optional | Skip for v1 |

### Draft screenshots (1320×2868)

- `iphone-69-01-your-trips.png`
- `iphone-69-02-trip-home.png`
- `iphone-69-03-today.png`

**Still capture (recommended set):** Drive mode, map/route, expenses or lodging, settle (if group).

Upload path: App Store Connect → Sortey → iOS App → 1.0 Prepare for Submission → Previews and Screenshots.

## App Privacy questionnaire (draft answers)

Use these as a starting point in ASC → App Privacy. Confirm against live code + privacy policy at https://sortey.app/privacy.

| Data type | Collected? | Linked to identity? | Tracking? | Purpose |
|-----------|------------|---------------------|-----------|---------|
| Email address | Yes | Yes | No | Account (magic link) |
| Name / display name | Yes | Yes | No | Trip membership |
| Precise location | Yes | Yes | No | Journey log, Driving Mode, side-trip, amenities |
| Photos | Yes | Yes | No | Receipts / journey photos (user-initiated) |
| Product interaction | Yes (if analytics on) | Possibly | No | Improve product |
| Crash data | Yes (Sentry) | No / diagnostics | No | App functionality |
| Performance data | Yes (Sentry) | No | No | App functionality |
| Device ID (push token) | Yes | Yes | No | Push notifications |

**Not collected for tracking ads.** No third-party advertising SDK.

Contact URL: https://sortey.app/privacy · Support: use the support URL already in ASC.

## TestFlight smoke (build 7+)

Install from TestFlight (fresh binary required after 2026-07-13 fingerprint change).

| # | Step | Pass? |
|---|------|-------|
| 1 | Magic-link sign-in | |
| 2 | Open trips list → open road trip | |
| 3 | **Today** loads; leave-by / fuel / service queue visible | |
| 4 | Airplane mode → log fuel → see offline queue banner | |
| 5 | Re-enable network → Sync now / auto-flush | |
| 6 | **Drive** → Route Ahead gradient + predicted stops | |
| 7 | **Plan Route** → dual candidates → plan selected | |
| 8 | Lodging → rooms assign + flight refresh (if flight row) | |
| 9 | Settings / OTA channel shows production | |

3. Internal testing group → external if needed → **Submit for Review**.

## Review notes (paste into ASC)

> Sortey is a private group trip / road-trip companion. Sign in with magic link (email). Demo: create or open a trip, use Today and Driving Mode. Location is used only while logging journey stops and while Driving Mode is open. No account purchase flows in v1.

## Remaining manual steps (cannot automate from this agent without ASC session)

- [ ] Upload full screenshot sets (6.9" + iPad 13") — start from `apps/expo/assets/app-store/drafts/`
- [ ] Complete App Privacy answers (draft table above)
- [ ] TestFlight green on device (fresh binary after 2026-07-13 fingerprint)
- [ ] Submit for App Review

### Suggested upload command (human)

1. Open [App Store Connect](https://appstoreconnect.apple.com) → Sortey → 1.0 Prepare for Submission  
2. Drag drafts + any new captures into iPhone 6.9" slot  
3. Privacy → Edit → paste questionnaire answers  
4. TestFlight → Internal → install → smoke  
5. Add for Review → Submit
