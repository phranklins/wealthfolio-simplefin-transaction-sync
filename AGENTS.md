# AGENTS.md

## What this is

A Wealthfolio addon (`wealthfolio-bank-sync`) that pulls transaction data from [SimpleFin Bridge](https://bridge.simplefin.org) and imports it into Wealthfolio accounts. Fuzzy matching prevents duplicate imports.

---

## Behavioral Guidelines

**These come first because they prevent the most mistakes.**

### 1. Think Before Coding

- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them—don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.

### 2. Simplicity First

- No features beyond what was asked.
- No abstractions for single-use code.
- No error handling for impossible scenarios.
- If 200 lines could be 50, rewrite it.

### 3. Surgical Changes

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated issues, mention them—don't fix them.
- Remove only what YOUR changes made unused.

### 4. Goal-Driven Execution

- Transform tasks into verifiable goals.
- For multi-step tasks, state a brief plan with verification steps.
- Unverified work is incomplete work.

### 5. Output Precision

- Lead with findings, not process descriptions.
- Use structured formats (lists, tables, code blocks).
- Include absolute file paths—never relative.

---

## Commands

All commands run from the repo root:

```bash
pnpm dev:server   # Dev server on http://localhost:3001 (live reload via Wealthfolio)
pnpm build        # Production build → dist/addon.js
pnpm dev          # vite build --watch (file watcher, no server)
pnpm type-check   # TypeScript validation (same as lint)
pnpm bundle       # clean + build + zip into dist/wealthfolio-bank-sync-{version}.zip
```

To get live reload, also run Wealthfolio in dev mode (separate terminal, separate repo):

```bash
VITE_ENABLE_ADDON_DEV_MODE=true pnpm tauri dev
```

Wealthfolio auto-discovers the addon dev server at `http://localhost:3001`.

## Build output

Vite builds `src/addon.tsx` → `dist/addon.js` (ES module, single file). `react` and `react-dom` are **external globals** supplied by the Wealthfolio host — never bundle them. `@wealthfolio/addon-sdk` and `@wealthfolio/ui` are bundled in.

## File map

```
src/
  addon.tsx                   Entry point — enable(), sidebar item, route registration
  contexts/
    BankSyncAddonProvider.tsx         React context: all shared state + ctx reference
  pages/
    SetupAuth.tsx             Step 1: paste SimpleFin setup token, claim access URL
    SetupMapping.tsx          Step 2: map SimpleFin accounts → Wealthfolio accounts
    SyncPage.tsx              Main page: fetch / review / import wizard
    index.ts                  Barrel
  components/
    PageHeader.tsx            Shared header with back button + action slot
    PrivacyAmount.tsx         Renders amount or •••••• based on privacyMode
    SfErrorsAlert.tsx         Displays SimpleFin errlist (ToS-required)
    ApiLogPopover.tsx         API call history popover (last 365 days)
    index.ts                  Barrel
  lib/
    simplefin.ts              claimAccessUrl(), fetchAccounts()
    matcher.ts                matchTransactions() — Dice coefficient fuzzy matching
    config.ts                 load/save/delete credentials and AddonConfig
    cache.ts                  localStorage response cache (1-hour TTL)
    skipped.ts                Permanently skipped transaction IDs (localStorage)
    apiLog.ts                 API call log + stats (today/week/month/busiest hour)
    activityType.ts           guessActivityType(), guessSymbol() heuristics
    date.ts                   formatDistanceToNow(timestamp)
    errors.ts                 getErrorMessage(err, fallback)
    constants.ts              StaleThresholdHours, SyncDays types + option arrays
    index.ts                  Barrel
  hooks/
    index.ts                  Barrel (hooks live here)
  types/
    index.ts                  All shared TypeScript types + DEFAULT_CONFIG + secret key constants
```

## AddonContext (ctx)

Everything flows through `ctx` (type `AddonContext` from `@wealthfolio/addon-sdk`):

| API | Purpose |
|---|---|
| `ctx.sidebar.addItem(...)` | Register sidebar nav entry |
| `ctx.router.add({ path, component })` | Register lazy React route |
| `ctx.api.accounts.getAll()` | List Wealthfolio accounts |
| `ctx.api.accounts.create(...)` | Create a new Wealthfolio account (used in SetupMapping) |
| `ctx.api.activities.getAll()` | Load all existing activities for duplicate detection |
| `ctx.api.activities.checkImport(accountId, activities)` | Validate before import |
| `ctx.api.activities.import(activities)` | Bulk import (primary path) |
| `ctx.api.activities.saveMany({ creates })` | Fallback import path |
| `ctx.api.portfolio.getHoldings(accountId)` | Get cash balance (filter `holdingType === "cash"`) |
| `ctx.api.navigation.navigate(path)` | Navigate within Wealthfolio (e.g. to `/activities`) |
| `ctx.api.secrets.get/set/delete` | Encrypted storage for credentials and config |
| `ctx.api.logger.error(...)` | Structured logging |
| `ctx.onDisable(fn)` | Cleanup called when user disables the addon |

## BankSyncAddonProvider state

`useBankSyncAddon()` returns:

| Field | Type | Purpose |
|---|---|---|
| `ctx` | `AddonContext` | Raw Wealthfolio SDK context |
| `accessUrl` | `string \| null` | SimpleFin ACCESS_URL (null = not yet set up) |
| `config` | `AddonConfig \| null` | Account mappings + settings |
| `isLoading` | `boolean` | Initial load gate |
| `reconfiguring` | `boolean` | True while re-entering SetupMapping without losing credentials |
| `setReconfiguring` | `fn` | Triggers SetupMapping re-entry |
| `refresh(showLoading?)` | `fn` | Re-load credentials + config from secrets |
| `privacyMode` | `boolean` | Hides all dollar amounts when true |
| `togglePrivacy` | `fn` | Flip privacyMode + persist to localStorage |

## Internal routing

A single route (`/addon/bank-sync`) renders `AddonRoot → AddonRouter`:

- No `accessUrl` → `SetupAuth`
- Has `accessUrl`, no mappings (or `reconfiguring === true`) → `SetupMapping`
- Has both → `SyncPage`

## SyncPage wizard steps

`Step` type: `"idle" | "fetching" | "reviewing" | "confirming" | "importing" | "done"`

1. **idle** — account cards, "Sync All Account Data" button, settings panel
2. **fetching** — loading skeletons while data is fetched + activities loaded
3. **reviewing** — editable transaction table; user assigns activity types (and symbols for securities)
4. **confirming** — summary of what will be imported; Import button
5. **importing** — in-progress spinner
6. **done** — count of imported transactions + optional balance reconciliation

## Data flow

### Auth (one-time)
1. User gets a Setup Token from SimpleFin's website
2. `claimAccessUrl(token)` base64-decodes it to a claim URL, POSTs with no body, receives `ACCESS_URL`
3. `ACCESS_URL` saved via `saveCredentials()` (secrets key: `"credentials"`)
4. Setup tokens are single-use — once claimed, the token is invalid

### Config
`AddonConfig` is JSON-stringified in secrets (key: `"config"`). Defaults:
```ts
{ mappings: [], staleThresholdHours: 48, syncDays: 90, lastFetchTimestamp: null }
```
`syncDays`: 30 | 60 | 90 — transaction window sent to SimpleFin.
`staleThresholdHours`: 24–720 — when to show the "stale" indicator on account cards.

### Fetch + cache
`fetchAccounts(accessUrl, start, end)` extracts basic-auth credentials from the `ACCESS_URL`, sends `GET {baseUrl}/accounts?version=2&start-date=<unix>&end-date=<unix>` with `Authorization: Basic ...`.

Response is cached in localStorage (`bank-sync:response-cache`, 1-hour TTL). The 1-hour cache is separate from the `staleThresholdHours` setting:
- **1-hour cache** — use cached data silently if fresh; prompt if older
- **staleThresholdHours** — shows a "stale" badge on account cards in the idle view

SimpleFin rate limit is **24 requests/day** shared across all apps on the same connection. The addon tracks every API call in `bank-sync:api-log` and displays stats (today/week/month/avg/busiest hour). A warning is shown when `today >= 20`.

### Duplicate matching (`matcher.ts`)
`matchTransactions(sfTransactions, wfActivities, mapping)` scores each SimpleFin transaction against existing Wealthfolio activities for the mapped account:

| Signal | Points |
|---|---|
| Amount matches (±$0.005 on absolute values) | 50 pts — **bail immediately if wrong** |
| Date within 1 day | 30 pts |
| Date within 3 days | 15 pts |
| Description similarity ≥ 0.7 (Dice coefficient vs `activity.comment`) | 20 pts |

Confidence thresholds: `high` ≥ 80, `low` ≥ 40, `new` < 40.

### Review table
- **high** confidence → "already imported" (collapsed collapsible)
- **low / new** → main review table; user must confirm activity type
- Pending (`tx.pending === true`) and zero-amount transactions are always excluded
- Users can skip transactions session-only (dismissed) or permanently (saved to `bank-sync:skipped-transactions`)
- Description field is an editable textarea; symbol field is editable for securities
- Each row can expand to show raw SimpleFin JSON (click the `{ }` icon)
- Investment columns (symbol, qty, unit price) only appear when any mapped account is `SECURITIES` type
- `guessActivityType()` and `guessSymbol()` pre-populate the dropdowns using description/payee/memo heuristics

### Import
1. `checkImport(accountId, activities)` is called per-account batch — filters to `isValid` only
2. `activities.import(allValid)` is the primary path
3. Falls back to `activities.saveMany({ creates })` if primary throws
4. After import, cash accounts get a balance reconciliation check (SimpleFin balance vs computed post-import Wealthfolio cash balance)

### Balance reconciliation
Detects when SimpleFin's reported balance differs from Wealthfolio's computed cash balance (from `portfolio.getHoldings`). Offers to create a single DEPOSIT or WITHDRAWAL adjustment entry. Available both after a sync (done step) and from the idle page account cards (when cached balance data shows a discrepancy).

## localStorage keys

| Key | Contents |
|---|---|
| `bank-sync:response-cache` | `{ data: SimpleFinResponse, timestamp: number }` |
| `bank-sync:skipped-transactions` | `string[]` of permanently-skipped transaction keys (`"sfAccountId:txId"`) |
| `bank-sync:privacy-mode` | `"true"` or `"false"` |
| `bank-sync:api-log` | `ApiLogEntry[]` — `{ timestamp: number, syncDays: number }[]` (trimmed to 365 days) |

## Permissions (manifest.json)

```
ui.sidebar.addItem
accounts.getAccounts
accounts.create
activities.getActivities
activities.createActivity
secrets.get / secrets.set / secrets.delete
```

`portfolio.getHoldings` and `navigation.navigate` are used at runtime but not declared in the manifest.

## SimpleFin API

**Auth:**
1. User visits `https://bridge.simplefin.org/simplefin/create` to get a Setup Token
2. Base64-decode → claim URL → `POST` (no body) → receive `ACCESS_URL`
3. Store `ACCESS_URL`. Token is single-use.

**Fetch:**
```
GET {ACCESS_URL}/accounts?version=2&start-date=<unix>&end-date=<unix>
```
Extract basic-auth from URL, send as `Authorization: Basic ...` header with credentials stripped from URL.

**Response shape:**
- `accounts[].transactions[].amount` — string like `"-42.50"` (positive = credit, negative = debit)
- `accounts[].transactions[].posted` — Unix epoch integer
- `accounts[].balance` — string
- `accounts[]."balance-date"` — Unix epoch integer
- `errlist` — **must always be shown to the user** (SimpleFin ToS requirement)

## Key constraints

- **errlist must be shown** — `SfErrorsAlert` renders it; never silently discard it
- **React/ReactDOM must stay external** — `vite.config.ts` externalizes them via `rollup-plugin-external-globals`
- **Rate limit is tight** — 24 requests/day shared with other apps (Actual Budget, Monarch, etc.). Never add fetch calls without gating on the cache.
- **No ESLint** — `lint` and `type-check` both run `tsc --noEmit`
- **Debug panel** — long-press the Settings button for 700 ms to open a raw JSON debug dialog (config, cache, API log)
- **SetupMapping auto-creates accounts** — uses `CREATE_CASH_SENTINEL` / `CREATE_SECURITIES_SENTINEL` sentinels in the mapping select to trigger `ctx.api.accounts.create()` with the right `accountType`
- **Opening external URLs** — `SetupAuth` uses Tauri's `plugin:opener|open_url` via `window.__TAURI_INTERNALS__.invoke`, with a clipboard fallback
