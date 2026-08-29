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
