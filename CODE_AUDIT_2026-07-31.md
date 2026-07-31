# Denarius Full Code Audit

**Audit date:** 2026-07-31
**Audited commit:** `551ff2b`
**Scope:** FastAPI backend, React frontend, database migrations, Docker deployment, backups, authentication, dependency state, and available validation.
**Status:** Remediation completed on the uncommitted `dev` working tree; baseline findings are retained below for traceability.

## Remediation progress on `dev`

This section is the durable handoff for the uncommitted remediation work begun after the audit. The original findings below are retained as the baseline evidence.

| Finding | Working-tree status | Notes |
|---|---|---|
| AUDIT-001 | Implemented; verified for the default deployment | Single web worker, serialized migrations, elected scheduler owner, transaction advisory lock, row locking, and PostgreSQL-backed auto-post coverage. Multi-replica failover remains a documented limitation. |
| AUDIT-002 | Implemented; verified | Cron is the sole automatic backup owner; manual and cron backups use unique temporary files and atomic publication. |
| AUDIT-003–005 | Implemented; verified | Report contracts/order, Net Worth history, and `other` classification fixed with focused tests. |
| AUDIT-006 | Implemented; verified | Export format v1.1 carries omitted links/state/settings, preserves/remaps IDs, marks filtered archives, validates payloads, and imports through per-item savepoints with one final commit. |
| AUDIT-007 | Implemented; verified | Hidden adjustments excluded from dashboard, budget, and report aggregates. |
| AUDIT-008–010 | Implemented; verified | Correct schedule rewind, constrained money inputs, reachable filtered CSV export, duplicate route removal, and UI export action. |
| AUDIT-011 | Mostly implemented | `python-multipart` raised to 0.0.31; npm dependency tree updated. Two React Router advisories remain with no patched published release and affect RSC functionality not used by this SPA. |
| AUDIT-012 | Mitigated; residual recorded | Atomic refresh consumption, guarded single-flight refresh, access token memory-only, and refresh token moved to tab-scoped session storage. HttpOnly-cookie/CSRF migration remains future work. |
| AUDIT-013 | Implemented; verified | NULL categories included and summary/per-category recurring semantics aligned. |
| AUDIT-014 | Implemented; verified | Explicit null clearing works for nullable fields while database-required fields reject explicit null. |
| AUDIT-015 | Implemented; verified for the default deployment | Validated timezone, configured/reschedulable job timezone, app-local dates, and post-import rescheduling. Cross-process propagation remains a multi-replica limitation. |
| AUDIT-016 | Implemented; verified | Database failure now returns HTTP 503. |
| AUDIT-017 | Implemented; verified | Atomic account/mortgage/property bundle endpoints; mortgage and recurring payment paths now commit once; UI surfaces failures. |
| AUDIT-018 | Implemented; verified | Integrity races return controlled conflicts; JWT secrets require at least 32 characters. |
| AUDIT-019 | Implemented; verified | Active/non-deleted references and category/account-type compatibility now return controlled 4xx responses. |
| AUDIT-020 | Implemented; verified | Shared refresh promise, stale-session ownership guards, auth retry exclusions, best-effort hydration, and local-first logout. |

Validation infrastructure is now present: ESLint flat config, frontend Vitest tests, 51 backend unit tests plus one PostgreSQL money-flow integration test, and GitHub Actions CI. CI starts PostgreSQL, applies all Alembic migrations, exercises the application lifespan/health/scheduler registration, and validates Docker Compose. Frontend Docker installs from the lockfile; route-level lazy loading is also implemented.

### Final validation on 2026-07-31

- Python 3.12 container: **52/52 backend tests passed**, including a real PostgreSQL scenario covering income, expenses, transfers, transfer edits/deletes, mortgage payments, subscriptions, bills, recurring income, auto-posting, effective transfer filtering, recurring metadata, and inactive-account reversal.
- Alembic: upgraded a fresh PostgreSQL 15 database through revision `0023 (head)`.
- Application lifespan smoke: migrations, scheduler ownership, three scheduled jobs, health endpoint, authentication, and clean startup all verified against PostgreSQL.
- Frontend: `npm ci`, ESLint, **9/9 Vitest tests**, TypeScript, and the Vite production build passed.
- Deployment/config: `docker compose config --quiet` and `git diff --check` passed.
- Dependency scan: `python-multipart` is at the remediation floor. `npm audit --omit=dev` reports only the two React Router RSC advisory entries described under residuals.

### Manual acceptance and restore verification

- A complete v1.1 JSON export was restored into a newly created, empty development database through the application UI.
- The restored database exactly matched the export: 9 accounts, 36 categories, 38 expense accounts, 16 recurring items, 32 budgets, 1 mortgage detail, 0 Net Worth snapshots, and 481 transactions.
- Database integrity queries found zero dangling transaction-account, transaction-pair, transaction-recurring, recurring-account, property-mortgage, or mortgage-detail references, and zero nonreciprocal transaction pairs.
- The user manually verified account balances and the imported Transactions, Transfers, Recurring, Mortgage, Budgets, Reports, Net Worth, timezone, and dashboard state.
- **Result:** complete v1.1 export/import round trip accepted.
- **UAT follow-ups resolved before commit:** transaction ranges are now marked restorable when the supplied bounds exclude no stored transactions, genuinely partial ranges remain archival, and the import form displays the server's safe validation reason instead of replacing it with a generic message. Two focused backend tests cover the scope classification.

### Live deployment safety assessment

- The working tree introduces no new Alembic upgrade revision or startup data migration. Changes to existing migration files only make unsafe downgrade paths fail explicitly; deployed databases already at revision `0023` receive no schema/data rewrite.
- The production Compose database mount remains the named `denarius_db_data` volume at `/var/lib/postgresql/data`; the secrets mount remains `denarius_secrets`. A normal redeploy of the same Portainer stack reuses both.
- Application startup waits for PostgreSQL, serializes `alembic upgrade head` with an advisory lock, and fails the backend startup rather than recreating or clearing the database if migration/startup fails.
- The config initializer creates missing secret files independently and does not overwrite existing database passwords or JWT secrets.
- A code rollback should redeploy the prior image/source without running Alembic downgrade. Several historical downgrades are intentionally unsupported.
- **Conditional release verdict:** data-preserving for a same-stack redeploy using only `docker-compose.yml`, provided the stack is not renamed and neither “remove volumes” nor `docker compose down -v` is used. Expect a short application restart, not data loss.
- **Release blocker:** all remediation is still uncommitted on `dev`; pushing the current branch state would not publish these changes. Commit/merge and passing CI are required before updating live.

### Residual and intentionally deferred work

These are not blockers for the repository's default single-backend-container deployment, but remain flagged for a future hardening/refactor pass:

1. Scheduler election has no live retry/failover in an already-running non-owner replica; timezone rescheduling and job inspection are process-local. Scaling beyond the default single backend container needs an external scheduler or a retry/notification design.
2. Refresh tokens remain JavaScript-readable in tab-scoped `sessionStorage`; an HttpOnly-cookie design would require CSRF protection and a larger authentication migration.
3. React Router's two RSC-mode advisories have no patched published release in the current dependency line; this SPA does not use React Server Components.
4. A legacy v1.0 export did not record whether its transaction range was filtered, so an old partial archive cannot be distinguished from a full backup. v1.1 marks scope and rejects filtered archives as restore inputs.
5. Large frontend pages, router-heavy backend modules, the settings-store dynamic/static import warning, and the 577.73 kB main chunk remain maintainability/performance work.
6. Irreversible legacy enum/transfer migration downgrades, the root backend container, and external TLS termination remain deployment debt.

## Baseline executive summary (pre-remediation)

Denarius is not yet safe to treat as production-ready for financial data. The frontend builds, but several major features are broken at runtime, scheduled work can execute multiple times, backup/restore integrity is incomplete, and there is no functioning automated verification layer.

The most urgent issues are duplicate scheduler execution under two Uvicorn workers, concurrent backup jobs targeting the same files, broken frontend/backend contracts across all Reports tabs, broken Net Worth history, and an incomplete JSON backup format.

## Critical findings

### AUDIT-001: Recurring transactions can be posted twice

- `backend/Dockerfile:25` starts Uvicorn with two workers.
- `backend/app/main.py:69-75` runs migrations and starts APScheduler from the application lifespan.
- Every worker therefore starts its own scheduler and runs migrations.
- `backend/app/services/recurring_service.py:156-205` selects due items without a database lock, job lease, or idempotency constraint.

Two workers can select the same recurring item, create duplicate transactions, advance its due date twice, and adjust account balances twice. Alembic migration execution can also race during startup.

### AUDIT-002: Automatic backups race and can falsely report success

- Each of the two backend workers schedules a backup at 02:00 in `backend/app/scheduler/setup.py:37-42`.
- `backup-cron` independently runs at 02:00 via `docker-compose.yml:107-128`.
- All three jobs write second-resolution `db-YYYY-MM-DD_HH-MM-SS.sql.gz` names into the same bind-mounted directory.
- `backup/backup.sh:10-17` uses `pg_dump | gzip` with `set -e` but without `pipefail`.

The jobs can collide on the same file. The cron script can also announce a successful backup when `pg_dump` failed but `gzip` exited successfully.

## High-severity findings

### AUDIT-003: All four Reports tabs consume the wrong API fields

The backend schemas in `backend/app/schemas/report.py` do not match the frontend interfaces in `frontend/src/pages/ReportsPage.tsx`:

- Spending API: `category_name`, `total`; UI: `category`, `amount`.
- Income/expense API: `expenses`; UI: `expense`.
- Trend API: `total`; UI: `total_expense`.
- Cash-flow API: `by_month`, `total_income`, `total_expenses`; UI: `monthly`, `total_inflow`, `total_outflow`.

The result is empty charts, `NaN` values, or incorrect totals. In addition, `backend/app/routers/reports.py:120-151` orders monthly trends ascending before applying `LIMIT`, returning the oldest months rather than the latest.

### AUDIT-004: Net Worth history crashes once a snapshot exists

`backend/app/schemas/net_worth.py:23-31` returns `snapshot_date`, but `frontend/src/pages/NetWorthPage.tsx:46-50,87-90` reads `month`. `formatMonth(undefined)` then calls `.split()` and throws.

### AUDIT-005: `other` accounts are omitted from net worth totals

`backend/app/services/networth_service.py:11-18` includes `other` in neither `ASSET_TYPES` nor `LIABILITY_TYPES`. The UI treats `other` as a normal positive-balance account, but its value contributes to neither assets nor liabilities.

### AUDIT-006: JSON export/import is not a faithful backup

`backend/app/routers/export.py` omits important state, including:

- Account `initial_balance`, `account_number`, and `linked_mortgage_id`.
- Recurring `expense_account_id` and last-payment tracking.
- Transaction `expense_account_id`, `recurring_item_id`, `paired_transaction_id`, and `is_hidden`.
- Monthly budget totals, budget preferences, timezone, and other application settings.

Consequences include unpaired imported transfers/mortgage legs, hidden transactions becoming visible, recurring spending losing its recurring relationship, and later account recalculation losing the opening balance invariant.

The import code catches broad exceptions without rolling back or using savepoints. A failed database flush can poison the SQLAlchemy session while earlier entity sections remain committed.

### AUDIT-007: Hidden balance adjustments pollute financial reports

`backend/app/routers/accounts.py:262-281` creates hidden income/expense transactions when an account balance is reconciled. Dashboard, budget, and reporting aggregate queries do not exclude `Transaction.is_hidden`, so a balance correction can appear as real income or spending.

### AUDIT-008: Deleting an older recurring payment corrupts its schedule

`backend/app/services/recurring_service.py:361-379` rewinds recurring state only when the deleted transaction is the current `last_paid_transaction_id`. Deleting an earlier weekly or biweekly payment lowers the paid count but leaves `next_due_date` advanced. Marking the replacement payment advances it yet again.

### AUDIT-009: Core money inputs accept zero and negative values

Transaction, mortgage, payment, recurring, and budget schemas lack consistent positive-value constraints. A negative expense increases an account balance, a negative income decreases it, and a zero mortgage term can cause calculation errors.

Primary files:

- `backend/app/schemas/transaction.py`
- `backend/app/schemas/mortgage.py`
- `backend/app/schemas/recurring_item.py`
- `backend/app/schemas/budget.py`

### AUDIT-010: CSV transaction export is unreachable and has no UI

`backend/app/routers/transactions.py:114` registers `GET /{transaction_id}` before `GET /export` at line 187. `/transactions/export` is captured by the UUID route and fails validation. A duplicate `GET /{transaction_id}` is also registered at line 228. The README advertises CSV export, but no frontend code invokes it.

### AUDIT-011: Known vulnerable dependencies are installed

`npm audit --omit=dev` reported eight affected dependency entries: five high and three moderate. Affected packages include Axios, React Router, lodash, PostCSS, form-data, follow-redirects, and picomatch.

`pip-audit` reported five advisories against `python-multipart==0.0.22`, including multipart and form-parser CPU exhaustion issues relevant to the import endpoint. The reported remediation floor is `0.0.31`.

### AUDIT-012: Refresh tokens remain exposed to replay and XSS theft

- `frontend/src/store/authStore.ts:31-46` persists refresh tokens in `localStorage`.
- `backend/app/services/auth_service.py:78-102` reads the token row, marks it revoked, and issues a replacement without a row lock or atomic conditional update.

Two simultaneous requests can reuse one refresh token successfully. Any successful XSS can also steal the 30-day credential.

## Medium-severity findings

### AUDIT-013: Budget “uncategorized” totals omit NULL categories

`backend/app/routers/budgets.py:158-176` uses `~Transaction.category_id.in_(budgeted_ids)`. SQL evaluates this to unknown for `NULL`, so truly uncategorized transactions are excluded whenever at least one budget category exists.

Per-category spending also includes recurring expenses while the summary total explicitly excludes them, making the budget views semantically inconsistent.

### AUDIT-014: Optional fields cannot reliably be cleared

`backend/app/routers/transactions.py:254` uses `model_dump(exclude_none=True)` even though the UI sends `null` to clear notes, categories, and expense accounts. Those edits are silently ignored. Category icons and mortgage loan types have the same problem.

The Accounts UI additionally sends `undefined` rather than `null` for cleared institution, account number, and notes fields.

### AUDIT-015: Timezone support is only partially implemented

Some request paths use `get_app_date`, but these still use the host date/time:

- Manual recurring payment defaults.
- Mark-paid-without-transaction defaults.
- Recurring matching.
- Net-worth snapshot defaults.
- Export filenames.
- APScheduler trigger timezone.

Scheduled jobs therefore run according to the container timezone rather than the configured application timezone.

### AUDIT-016: Health checks remain green when PostgreSQL is unavailable

`backend/app/routers/system.py:44-51` catches database exceptions but still returns HTTP 200 and `status: ok`. The Docker healthcheck in `docker-compose.yml:85-90` therefore treats a database-disconnected backend as healthy.

### AUDIT-017: Mortgage and property saves are non-atomic and failures are hidden

`frontend/src/pages/AccountsPage.tsx:241-303` saves accounts, mortgage details, mortgage accounts, and property links through separate requests. Mortgage errors are intentionally swallowed as non-fatal. This can leave silently unsaved mortgage details or orphan mortgage accounts while the dialog still closes successfully.

Mortgage recording and normal recurring mark-paid paths also use multiple commits, allowing transaction/balance changes to persist before recurring tracking is updated.

### AUDIT-018: Authentication integrity errors can become HTTP 500 responses

Concurrent duplicate registration, competing admin claims, and attempts to create a second admin can surface raw database `IntegrityError` responses. Refresh rotation is not atomic. `JWT_SECRET` is required but has no minimum-length validation in `backend/app/config.py`.

### AUDIT-019: Reference validation is incomplete

Transaction and recurring creation often rely on foreign-key failure rather than returning a controlled 4xx response. Soft-deleted accounts can still be loaded with `db.get()` and have balances modified. Category type is not checked against transaction type.

### AUDIT-020: Frontend authentication boot/logout paths are fragile

- A successful login followed by a failed timezone or `/me` request is shown as a failed login even though tokens have already been stored.
- Logout clears local credentials only after the server request succeeds, so offline/server failure can leave the UI authenticated.
- Strict Mode or simultaneous startup refreshes can rotate the same refresh token concurrently.

## Baseline incomplete work register (superseded by remediation status above)

These items should remain explicitly flagged until addressed:

1. **No committed backend or frontend tests.** Only orphaned compiled test artifacts exist locally.
2. **No CI workflow.** The previous GitHub Actions workflow was deleted.
3. **Linting is configured but unusable.** ESLint 9 has no `eslint.config.js`, `eslint.config.mjs`, or `eslint.config.cjs`.
4. **JSON backup is partial rather than restorable application state.**
5. **CSV export is advertised but inaccessible and absent from the UI.**
6. **Timezone integration is incomplete.**
7. **Several Alembic downgrades are empty `pass` operations.** Migration `0022` intentionally soft-deletes legacy transfer history and cannot restore it.
8. **API response types are largely absent in the frontend.** This allowed the Reports and Net Worth contract failures to compile.
9. **Large monolithic components remain:** Settings 1,019 lines; Dashboard 986; Recurring 898; Transactions 897; Accounts 753; Budgets 729.
10. **Backend business logic remains concentrated in routers**, especially `export.py`, `budgets.py`, and `transactions.py`.

## Lower-priority maintainability and deployment debt

- `backend/app/routers/export.py` is 659 lines with duplicated per-entity import logic.
- Transaction-form logic is duplicated between Dashboard and Transactions pages.
- The production frontend bundle is approximately 1.205 MB minified / 340 KB gzip.
- Vite reports that the dynamic settings-store import cannot create a separate chunk because the module is also imported statically.
- Frontend Docker builds use `npm install` without copying the lockfile first; builds are not lockfile-reproducible.
- The backend container runs as root.
- Docker Compose `version` declarations are obsolete.
- `backend/package-lock.json` is an unrelated empty lockfile.
- TLS is not provided by the app; deployment depends on a trusted network, VPN, or external TLS terminator.
- Refresh-token cleanup for expired/revoked rows is not implemented.
- Scheduler exceptions are logged without tracebacks or external alerting.
- Health checks do not validate scheduler state or migration version.

## Baseline validation results (pre-remediation)

- `npm run build`: **passed**.
- Build warnings: ineffective dynamic import and a main chunk larger than 500 KB.
- `npm run lint`: **failed** because the ESLint configuration is absent.
- Backend tests: **not runnable** because no test sources or pytest dependency are committed.
- Local Python compile: unavailable as a meaningful check because the host Python is 3.9 while the project targets 3.12.
- Backend Docker build: attempted, but the Python base-image pull timed out.
- `docker compose config`: parsed successfully with obsolete-version warnings.
- `npm audit --omit=dev`: 8 affected dependency entries, 5 high and 3 moderate.
- `pip-audit --no-deps --disable-pip`: 5 advisories in `python-multipart`.

## Working-tree context at audit time

The following uncommitted edits predated the audit and were not modified by it:

- `README.md`: repository URLs changed from `foiler25/Denarius` to `holdmysocks/Denarius`.
- `frontend/src/pages/settings/SettingsPage.tsx`: source repository URL changed to `holdmysocks/Denarius`.

## Baseline next step (completed in this working tree)

Plan fixes in dependency order, beginning with scheduler idempotency/worker ownership and reliable backups, then restore frontend/backend API contracts, then establish tests and CI before changing additional money-moving logic.
