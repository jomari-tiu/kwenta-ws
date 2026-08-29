# financial-tracker-api

Express + Drizzle + Postgres API for a single-user personal finance tracker.

Companion repo: `../financial-tracker-web` (Vite React SPA). These are two
standalone repos on purpose — they are meant to deploy to different platforms.

## Local setup

```bash
cp .env.example .env      # then set OWNER_PASSWORD and JWT_SECRET
docker compose up -d      # Postgres 17 on :5432
npm install
npm run db:push           # sync schema locally (no migration file)
npm run db:seed           # owner + starter categories/accounts
npm run dev               # http://localhost:8000
```

Health check: <http://localhost:8000/health>

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | tsx watch |
| `npm run typecheck` / `lint` / `test` | the pre-finish gate — all three must pass |
| `npm run db:push` | fast local schema sync while iterating |
| `npm run db:generate` | create a migration file when PR-ready |
| `npm run db:migrate` | apply committed migrations |
| `npm run db:studio` | browse the DB |
| `npm run db:seed` | idempotent, re-runnable |

## Conventions

Layering is strict: **route → controller → service → repository**. Drizzle
queries live *only* in `*.repository.ts` — ESLint enforces this by restricting
imports of `db/client`.

- `type` never `interface`. `T`-prefixed type names. Named exports.
- Validation is Zod, via `validateBody` / `validateQuery` / `validateParams`.
- List endpoints take `pageNumber` / `pageSize` / `search` and return
  `{ data, meta }` — the shape the web repo's `useGet({ isList: true })` expects.
- Commits: one-line Conventional Commits, no body, no `Co-Authored-By` trailers.

### Two invariants that will bite if forgotten

**Money is integer centavos** (`bigint`, `*Centavos` suffix). Postgres
`sum(bigint)` returns `numeric`, which postgres.js hands back as a **string** —
so `"1200" + "800"` is `"1200800"` with no error. Every aggregate select must go
through `toCentavos()` in `src/common/money.ts`.

**Calendar dates are `date` columns with `mode: 'string'`**, never `timestamptz`
and never a JS `Date`. `mode: 'date'` yields UTC midnight, and
`.toISOString().slice(0,10)` then reads one day early — which *looks correct in
dev* (Manila) and is wrong in any UTC runtime. "Today" always comes from
`todayInAppTz()` in `src/common/date.ts`, never `current_date` and never
`new Date().toISOString()`.

## Not deployed

Deployment is deliberately not set up. `render.yaml` is absent by design; add it
only if that changes. Note that several details assume a **single instance**:
migrate-on-start, the in-memory recurring-catchup throttle, and the advisory
lock around materialization.

## Moving your data to another server

Export and import cover the whole database in one file, so a local instance can
be lifted into production without retyping anything.

```
GET  /api/v1/data/export              -> kwenta-backup-YYYY-MM-DD.json
POST /api/v1/data/import?mode=empty   -> refuses unless the target is empty
POST /api/v1/data/import?mode=replace -> wipes the target first
```

Both are behind auth, and the UI for them is the **Backup** page under Setup.

**Procedure**

1. On the old server, Backup → *Download backup*.
2. Stand up the new server and run `npm run db:migrate` then `npm run db:seed`.
   The seed creates the owner from `OWNER_PASSWORD`; it also inserts starter
   categories and accounts, so import with `mode=replace` to clear them.
3. Log in on the new server, Backup → *Choose a backup file*.

**What it does and does not carry**

- Rows keep their original UUIDs, so every reference between them survives.
  This is why the target must be empty or replaced — the import never remaps ids
  and would collide with an existing row.
- The whole import is ONE transaction. A failure part-way leaves the target
  exactly as it was rather than half-migrated.
- `users` is deliberately excluded. That row holds an argon2 password hash and a
  token version; production sets its own password from `OWNER_PASSWORD`. A
  migration moves the money, not the login.
- `formatVersion` is checked on import. A file from a future schema is refused
  outright instead of being partially loaded.
- Every plain date in the file was written under the exporting server's
  `APP_TIMEZONE`, which is recorded in the file as `appTimezone`. Keep the two
  servers on the same zone or the day a transaction falls on can shift.
