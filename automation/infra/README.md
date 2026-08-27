# Infra: n8n on Postgres behind Caddy

The VPS that runs the application automation. Three containers: `postgres`
(n8n's database, not the default SQLite), `n8n` itself, and `caddy` as a
reverse proxy that terminates TLS and gets certificates automatically.

## Bringing the stack up

From this directory, on the VPS:

```bash
# secrets — generate once, save N8N_ENCRYPTION_KEY to the password manager
openssl rand -hex 32   # -> N8N_ENCRYPTION_KEY
openssl rand -hex 24   # -> POSTGRES_PASSWORD

cp ../.env.example .env   # fill in every value, including N8N_HOST,
                           # POSTGRES_PASSWORD and N8N_ENCRYPTION_KEY

docker compose up -d
docker compose logs -f n8n
```

Expect `Editor is now accessible via: https://<domain>/` in the logs, and no
mention of SQLite — if SQLite shows up, the `DB_TYPE` block in
`docker-compose.yml` isn't taking effect and needs fixing before anything is
stored, because migrating state out of SQLite afterwards is painful.

To stop the stack: `docker compose down` (the named volumes, and everything in
them, survive). To pick up a new image: `docker compose pull && docker compose
up -d`.

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

- `.env` is never committed — see `automation/.env.example` for the variable
  names and what each one is for.
- Caddy issues and renews its own TLS certificate for `N8N_HOST` automatically
  on first request; that only succeeds once DNS for the hostname resolves to
  this box.
