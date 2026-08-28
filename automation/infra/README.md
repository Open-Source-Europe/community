# Infra: n8n on Postgres behind Caddy

The VPS that runs the application automation. Three containers: `postgres`
(n8n's database, not the default SQLite), `n8n` itself, and `caddy` as a
reverse proxy that terminates TLS and gets certificates automatically.

## Variables this compose file needs

This compose file reads two sets of variables, documented in two different
places:

- **Three infra-only variables**, documented right here, in the table below.
  They belong to this directory, not to the n8n workflows.
- **Application variables** (`DRY_RUN`, `MISTRAL_API_KEY`, `FORM_URL_OSE`
  and so on), documented in [`automation/.env.example`](../.env.example).
  This README does not duplicate them — two copies of the same list drift,
  and that file is the one that ships with the application config.

| Variable | What it is |
|---|---|
| `N8N_HOST` | The public hostname n8n is served on, e.g. `automation.opensourceeurope.org`. Used for `N8N_HOST`, `WEBHOOK_URL` and `N8N_EDITOR_BASE_URL` in the compose file, and as the Caddyfile's TLS site address. |
| `POSTGRES_PASSWORD` | Password for the `n8n` role in the bundled Postgres. Generate with `openssl rand -hex 24`. |
| `N8N_ENCRYPTION_KEY` | Encrypts every credential n8n stores. Generate with `openssl rand -hex 32`. **Losing it makes every stored credential unrecoverable** — see the dedicated section below. |

Both sets go into one `.env` file in this directory before bringing the stack
up.

## Bringing the stack up

From this directory, on the VPS:

```bash
# infra secrets — generate once, save N8N_ENCRYPTION_KEY to the password manager
openssl rand -hex 32   # -> N8N_ENCRYPTION_KEY
openssl rand -hex 24   # -> POSTGRES_PASSWORD

# Both sets of variables go into one .env file, next to docker-compose.yml.
cp ../.env.example .env
#
# Then fill in every application value, and add the three infra-only variables
# from the table above (N8N_HOST, POSTGRES_PASSWORD, N8N_ENCRYPTION_KEY) —
# none of which are in .env.example.

docker compose up -d
docker compose logs -f n8n
```

Expect `Editor is now accessible via: https://<domain>/` in the logs, and no
mention of SQLite — if SQLite shows up, the `DB_TYPE` block in
`docker-compose.yml` isn't taking effect and needs fixing before anything is
stored, because migrating state out of SQLite afterwards is painful.

To stop the stack: `docker compose down` (the named volumes, and everything in
them, survive).

`n8n` is pinned to a specific version tag in `docker-compose.yml`, not
`:latest` — `postgres` and `caddy` pull a fresh image within their pinned
line automatically, but n8n does not, on purpose. Upgrading n8n is a
deliberate act: back up first (see "Backup" below), then bump the tag in
`docker-compose.yml` and run `docker compose pull && docker compose up -d`.

## N8N_ENCRYPTION_KEY: back it up, off this box, before anything else

`N8N_ENCRYPTION_KEY` encrypts every credential n8n stores — SMTP, Slack, Open
Collective, everything referenced by name from workflow nodes. **If this key
is lost, every one of those stored credentials is unrecoverable.** There is no
reset or recovery path: each credential has to be re-entered by hand, in every
workflow that references it. Generate it once, store it in the operator's
password manager the moment it's generated, and never regenerate it against
an existing database — a mismatched key does not decrypt what's already
there.

## Backup

n8n's own tables (workflows, credentials, execution history) **and** the
`ose_applications` Data table live in this same Postgres — Data tables are
just tables inside n8n's database. A single `pg_dump` of the `n8n` database
therefore covers all applicant state (stage, AI verdicts, form answers,
decisions) along with everything else, so one backup command is enough:

```bash
docker compose exec postgres pg_dump -U n8n n8n | gzip > n8n-backup-$(date +%F).sql.gz
```

Run this on a schedule (cron on the host, outside this compose file) and keep
backups somewhere other than this VPS — a backup that only exists on the box
it protects against does not survive the box failing.

## Restore

```bash
# stop n8n so nothing writes to the database mid-restore
docker compose stop n8n

# drop and recreate the database, then load the dump
docker compose exec -T postgres psql -U n8n -d postgres -c "DROP DATABASE n8n;"
docker compose exec -T postgres psql -U n8n -d postgres -c "CREATE DATABASE n8n OWNER n8n;"
gunzip -c n8n-backup-<date>.sql.gz | docker compose exec -T postgres psql -U n8n -d n8n

docker compose start n8n
docker compose logs -f n8n
```

A restore only produces a working instance if `N8N_ENCRYPTION_KEY` in `.env`
on the restoring box is the *same* key that was in use when the dump was
taken — the dump's credential rows are encrypted with it. Restoring a dump
under a different key leaves the credentials in the database but unreadable.

## Notes

- `.env` is never committed — see `automation/.env.example` for the
  application variable names, and the table above for the three infra-only
  ones it doesn't cover.
- Caddy issues and renews its own TLS certificate for `N8N_HOST` automatically
  on first request; that only succeeds once DNS for the hostname resolves to
  this box. Caddy only sees `N8N_HOST` because the `caddy` service in
  `docker-compose.yml` passes it through explicitly via its own
  `environment:` block — Compose's `${VAR}` interpolation of the YAML file
  does not, by itself, put a variable inside a container's environment.
