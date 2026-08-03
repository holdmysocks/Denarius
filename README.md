# Denarius

Self-hosted personal finance tracker for families. Deploys via Docker Compose; ideal for use over a private network or behind a VPN such as Tailscale or WireGuard.

> **Status:** v1.1.1 — stable release for self-hosted personal finance tracking.

## Features

- **Dashboard** — Net worth, monthly spending, upcoming bills, recent transactions
- **Transactions** — Manual entry, CSV export, filtering by date/category/account
- **Budgets** — Monthly per-category budgets with progress tracking and rollover
- **Recurring & Subscriptions** — Subscriptions (Netflix, Spotify), recurring bills, due date alerts, auto-posting
- **Mortgage** — Amortization schedule, extra payment calculator
- **Net Worth** — Assets vs liabilities, historical chart, monthly auto-snapshot
- **Reports** — Spending by category (pie), income vs expense (bar), monthly trends
- **Multi-user** — Family members share data; first user becomes admin
- **REST API** — Full OpenAPI documentation at `/api/docs` (development only)

## Quick Start

### 1. Clone and configure

```bash
git clone https://github.com/holdmysocks/Denarius.git
cd Denarius
cp .env.example .env
```

`.env` is optional — sensible defaults are baked in and the database password and JWT secret auto-generate on first run. Edit it only if you want to override something (e.g. `APP_PORT` or `ALLOWED_ORIGINS`).

### 2. Start

```bash
docker compose up -d
```

The app will be available at `http://localhost:9723`.

### 3. First Login

Open the app and register your first account — it is automatically assigned the **admin** role. Subsequent registrations are members until promoted from the Users tab.

## Deploying with Portainer

Denarius can be deployed as a Portainer **Stack** in a few clicks.

### Option A: Git-based stack (recommended)

1. In Portainer, go to **Stacks → Add stack**.
2. Give it a name (e.g. `denarius`).
3. Select **Repository** as the build method and use:
   - **Repository URL**: `https://github.com/holdmysocks/Denarius`
   - **Reference**: `refs/heads/main`
   - **Compose path**: `docker-compose.yml`
4. Under **Environment variables**, optionally add any of the variables listed in the [Environment Variables](#environment-variables) table. None are required — defaults work out of the box.
5. Click **Deploy the stack**.

Portainer will pull the repo, build the images, and bring the stack up. The web UI will be reachable on the host at `http://<host-ip>:9723` (or the value of `APP_PORT`).

### Option B: Web editor

1. **Stacks → Add stack → Web editor**.
2. Paste the contents of [`docker-compose.yml`](./docker-compose.yml) into the editor.
3. Add environment variables as needed.
4. Deploy.

> **Note:** the web-editor option requires the `./backend` and `./backup` build contexts to be available on the Docker host. The Git-based option is easier because Portainer fetches the full repo for you.

### Updating the stack

When a new release is published, open the stack in Portainer and click **Pull and redeploy**. Portainer will fetch the latest commit, rebuild any changed images, and restart the services. Your data (Postgres volume, secrets volume, and the `./backups` directory) is preserved across redeploys.

## Remote access via Tailscale / VPN

Denarius binds to a single host port (`9723` by default) and does not ship with TLS — keep it on a trusted network or expose it through a VPN.

For Tailscale users:

```bash
# On the Docker host
sudo tailscale up
```

Then open `http://<machine-name>.<tailnet>.ts.net:9723` from any device on your tailnet.

If you change the access URL, update `ALLOWED_ORIGINS` in `.env` so CORS still works:

```
ALLOWED_ORIGINS=http://localhost:9723,http://denarius.tailnet.ts.net:9723
```

## API Documentation

In **development** (`ENVIRONMENT=development`), interactive OpenAPI docs are served at:

```
http://localhost:9723/api/docs
```

The docs are disabled in production for security. Mobile or third-party clients can still authenticate via `POST /api/v1/auth/login` and use the bearer token against the documented endpoints.

## Backups

Backups are stored in `./backups/` as compressed SQL files. Filenames include a UTC timestamp and uniqueness suffix so simultaneous manual runs cannot collide.

### Automatic Backups
- The `backup-cron` service runs `pg_dump` daily at 02:00
- `backup-cron` is the sole automatic backup owner; the backend retains only the manual backup API
- Backups are retained for `BACKUP_RETAIN_DAYS` days (default: 30)

### Manual Backup
```bash
# Via Docker
docker compose exec backup-cron /usr/local/bin/backup.sh

# Via API (admin)
curl -X POST http://localhost:9723/api/v1/system/backup \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Restore from Backup
```bash
# List backups
ls ./backups/

# Restore
gunzip -c ./backups/db-2025-01-01_02-00-00.sql.gz | \
  docker compose exec -T postgres psql -U denarius -d denarius
```

## Development

```bash
# Start with dev overrides (hot reload)
docker compose up

# The override file enables:
# - Backend hot reload (uvicorn --reload)
# - PostgreSQL port exposed at 5432
```

Frontend-only dev (Vite proxies `/api` to `localhost:8000`):

```bash
cd frontend
npm install
npm run dev
```

Backend-only dev:

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### Cutting a release

The version is declared in several files that must not drift apart. Rather
than editing them by hand, use:

```bash
scripts/bump-version.py 1.2.0 --commit --tag
```

Nothing is pushed — review, then `git push origin dev && git push origin v1.2.0`.
To verify the declarations agree without changing anything:

```bash
scripts/bump-version.py --check
```

## Environment Variables

All variables are optional. The two secrets (`POSTGRES_PASSWORD` and `JWT_SECRET`) are auto-generated on first run and stored in a Docker volume; only override them if you have a specific reason to.

| Variable | Default | Description |
|---|---|---|
| `POSTGRES_DB` | `denarius` | Database name |
| `POSTGRES_USER` | `denarius` | Database user |
| `POSTGRES_PASSWORD` | _auto-generated_ | Database password (32 random chars on first run) |
| `JWT_SECRET` | _auto-generated_ | Secret key for JWT signing (64 hex chars on first run) |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `15` | JWT access token lifetime |
| `REFRESH_TOKEN_EXPIRE_DAYS` | `30` | Refresh token lifetime |
| `ENVIRONMENT` | `production` | `production` or `development` |
| `ALLOWED_ORIGINS` | `http://localhost:9723` | CORS allowed origins (comma-separated) |
| `APP_PORT` | `9723` | Host port for the web UI |
| `BACKUP_RETAIN_DAYS` | `30` | Days to keep backup files |

## Architecture

```
host:9723 → nginx → /*       → React SPA
                  → /api/*   → FastAPI (port 8000)
                                  ↓
                              PostgreSQL 15

backup-cron (pg_dump daily at 02:00 → ./backups/)
```

**Tech Stack:**
- Backend: Python 3.12, FastAPI, SQLAlchemy 2.0, Alembic, APScheduler
- Frontend: React 18, Vite, TypeScript, Shadcn/ui, Tailwind CSS, Recharts
- Database: PostgreSQL 15
- Proxy: Nginx

## Contributing

Issues and pull requests are welcome at [github.com/holdmysocks/Denarius](https://github.com/holdmysocks/Denarius).
