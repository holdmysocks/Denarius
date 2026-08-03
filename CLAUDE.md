# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Running the App
```bash
docker compose up -d          # Production (app at http://localhost:9723)
docker compose up              # Development (hot-reload via docker-compose.override.yml)
```

### Frontend (from `frontend/`)
```bash
npm install                    # Install dependencies
npm run dev                    # Vite dev server (proxies /api → localhost:8000)
npm run build                  # TypeScript check + Vite production build
npm run lint                   # ESLint (zero warnings enforced: --max-warnings 0)
```

### Backend (from `backend/`)
```bash
pip install -r requirements.txt
uvicorn app.main:app --reload  # Dev server on port 8000
```

### Database Migrations (from `backend/`)
Migrations auto-run on backend startup (`alembic upgrade head` in lifespan hook). To create a new migration:
```bash
alembic revision -m "0023_description_here"   # Manual (preferred — use sequential numbering)
alembic upgrade head                           # Apply migrations
alembic downgrade -1                           # Roll back one step
```
New models must be imported in `alembic/env.py` for autogenerate detection.

## Architecture

### Request Flow
Nginx (port 9723) serves the React SPA and proxies `/api/*` to FastAPI (port 8000). All API endpoints live under `/api/v1/`. OpenAPI docs at `/api/docs`.

### Backend Layering
`routers/` → `services/` → `models/` — routers handle HTTP, services hold business logic, models define ORM. FastAPI `Depends()` injects DB sessions and auth. All DB operations are async (AsyncSession + asyncpg).

### Auth
JWT Bearer tokens: access (15 min), refresh (30 days). The Axios client (`frontend/src/api/client.ts`) auto-refreshes on 401 via interceptor. Backend auth deps in `backend/app/dependencies.py` (`get_current_user`, `require_admin`). First registered user becomes admin.

### Scheduled Jobs (APScheduler)
- `auto_post_recurring.py` — daily 00:05, auto-posts recurring transactions
- `net_worth_snapshot.py` — 1st of month 01:00
- `backup.py` — daily 02:00

### State Management (Frontend)
Zustand stores (`store/authStore`, `dashboardStore`, `themeStore`). Server data fetched via TanStack Query. Path alias: `@/*` → `src/*`.

## Key Conventions

- **UUID primary keys** on all models, **soft deletes** via `deleted_at` column, **timestamp mixins** (`created_at`, `updated_at`)
- **Migration naming**: sequential `0001_`, `0002_`, etc. — currently at `0025`
- **Category `once_per_month`**: enforced by `recurring_service._check_once_per_month_category` — returns 409 if already assigned to another active recurring item
- **Settings via Pydantic**: `backend/app/config.py` reads from `.env` (required: `POSTGRES_PASSWORD`, `JWT_SECRET`)
- **No test suite**: project has no automated tests; verify changes manually via the running app

---

<!-- dgc-policy-v11 -->
# Dual-Graph Context Policy

This project uses a local dual-graph MCP server for efficient context retrieval.

## MANDATORY: Always follow this order

1. **Call `graph_continue` first** — before any file exploration, grep, or code reading.

2. **If `graph_continue` returns `needs_project=true`**: call `graph_scan` with the
   current project directory (`pwd`). Do NOT ask the user.

3. **If `graph_continue` returns `skip=true`**: project has fewer than 5 files.
   Do NOT do broad or recursive exploration. Read only specific files if their names
   are mentioned, or ask the user what to work on.

4. **Read `recommended_files`** using `graph_read` — **one call per file**.
   - `graph_read` accepts a single `file` parameter (string). Call it separately for each
     recommended file. Do NOT pass an array or batch multiple files into one call.
   - `recommended_files` may contain `file::symbol` entries (e.g. `src/auth.ts::handleLogin`).
     Pass them verbatim to `graph_read(file: "src/auth.ts::handleLogin")` — it reads only
     that symbol's lines, not the full file.
   - Example: if `recommended_files` is `["src/auth.ts::handleLogin", "src/db.ts"]`,
     call `graph_read(file: "src/auth.ts::handleLogin")` and `graph_read(file: "src/db.ts")`
     as two separate calls (they can be parallel).

5. **Check `confidence` and obey the caps strictly:**
   - `confidence=high` -> Stop. Do NOT grep or explore further.
   - `confidence=medium` -> If recommended files are insufficient, call `fallback_rg`
     at most `max_supplementary_greps` time(s) with specific terms, then `graph_read`
     at most `max_supplementary_files` additional file(s). Then stop.
   - `confidence=low` -> Call `fallback_rg` at most `max_supplementary_greps` time(s),
     then `graph_read` at most `max_supplementary_files` file(s). Then stop.

## Token Usage

A `token-counter` MCP is available for tracking live token usage.

- To check how many tokens a large file or text will cost **before** reading it:
  `count_tokens({text: "<content>"})`
- To log actual usage after a task completes (if the user asks):
  `log_usage({input_tokens: <est>, output_tokens: <est>, description: "<task>"})`
- To show the user their running session cost:
  `get_session_stats()`

Live dashboard URL is printed at startup next to "Token usage".

## Rules

- Do NOT use `rg`, `grep`, or bash file exploration before calling `graph_continue`.
- Do NOT do broad/recursive exploration at any confidence level.
- `max_supplementary_greps` and `max_supplementary_files` are hard caps - never exceed them.
- Do NOT dump full chat history.
- Do NOT call `graph_retrieve` more than once per turn.
- After edits, call `graph_register_edit` with the changed files. Use `file::symbol` notation (e.g. `src/auth.ts::handleLogin`) when the edit targets a specific function, class, or hook.

## Context Store

Whenever you make a decision, identify a task, note a next step, fact, or blocker during a conversation, call `graph_add_memory`.

**To add an entry:**
```
graph_add_memory(type="decision|task|next|fact|blocker", content="one sentence max 15 words", tags=["topic"], files=["relevant/file.ts"])
```

**Do NOT write context-store.json directly** — always use `graph_add_memory`. It applies pruning and keeps the store healthy.

**Rules:**
- Only log things worth remembering across sessions (not every minor detail)
- `content` must be under 15 words
- `files` lists the files this decision/task relates to (can be empty)
- Log immediately when the item arises — not at session end

## Session End

When the user signals they are done (e.g. "bye", "done", "wrap up", "end session"), proactively update `CONTEXT.md` in the project root with:
- **Current Task**: one sentence on what was being worked on
- **Key Decisions**: bullet list, max 3 items
- **Next Steps**: bullet list, max 3 items

Keep `CONTEXT.md` under 20 lines total. Do NOT summarize the full conversation — only what's needed to resume next session.
