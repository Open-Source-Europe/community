# Infra: n8n on Postgres behind Caddy

The VPS that runs the application automation. Three containers: `postgres`
(n8n's database, not the default SQLite), `n8n` itself, and `caddy` as a
reverse proxy that terminates TLS and gets certificates automatically.

## The box

Provisioned 2026-08: OVHcloud **VPS-1 2027** — 2 vCore, 4096 MB, 40 GB NVMe,
**Strasbourg SBG6** (EU). Debian 13 (trixie).

That is roughly 4x what this stack needs. At rest n8n uses ~300-500 MB,
Postgres ~150 MB at this data volume, Caddy ~30 MB; the application load is a
few workflow executions a day. The constraint on a box this size is never
throughput — it is unbounded execution history, which is what
`EXECUTIONS_DATA_PRUNE` below is for.

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
| `N8N_HOST` | The **admin** hostname — the editor, and the Open Collective webhook endpoint. `automation.opensourceeurope.org`. n8n builds `WEBHOOK_URL` and `N8N_EDITOR_BASE_URL` from it, and Caddy serves it as a TLS site. |
| `APPLY_HOST` | The **applicant-facing** hostname — `apply.opensourceeurope.org`, whose bare URL is the OSE application form. Caddy's TLS site address for that name. See "Two hostnames" below. |
| `EXECUTIONS_DATA_PRUNE` | `true`. n8n otherwise keeps the full payload of every execution forever. |
| `EXECUTIONS_DATA_MAX_AGE` | Hours of execution history to keep — `336` (14 days). Long enough to debug what happened to an applicant, short enough that the disk never becomes a question. |
| `POSTGRES_PASSWORD` | Password for the `n8n` role in the bundled Postgres. Generate with `openssl rand -hex 24`. |
| `N8N_ENCRYPTION_KEY` | Encrypts every credential n8n stores. Generate with `openssl rand -hex 32`. **Losing it makes every stored credential unrecoverable** — see the dedicated section below. |

Both sets go into one `.env` file in this directory before bringing the stack
up.

## Two hostnames

Both point at this box; both get their own automatic certificate; one n8n
container serves both.

| Name | Who sees it | What it serves |
|---|---|---|
| `apply.opensourceeurope.org` | applicants | the OSE application form, at the bare URL |
| `automation.opensourceeurope.org` | you | the n8n editor, and the OC webhook endpoint |

The applicant's link is deliberately just `https://apply.opensourceeurope.org`
— no `/form/...` path. n8n serves forms at `/form/<path>` and keeps the editor
at `/`, so the bare-URL form is a Caddy rewrite of `/` only. Page-to-page posts
and assets keep their own paths and stay on the same hostname.

**Verify before trusting it:** the rewrite is transparent only if n8n's form
pages use relative URLs for their posts and assets. If any is absolute and
built from `N8N_HOST`, an applicant jumps from `apply.` to `automation.` on
submitting page one — it works, but it looks broken and leaks the admin
hostname. Check it with the first real form.

The admin name is deliberately not `n8n.…`: every hostname issued a
certificate is published in Certificate Transparency logs, so a
tool-named host permanently advertises what software runs here.

## Sending mail: not from this box

`opensourceeurope.org` publishes `v=spf1 include:_spf.protonmail.ch -all` — a
hard fail for any sender that is not Proton. This VPS is not an authorised
sender and has no reverse DNS, so mail sent directly from it as
`@opensourceeurope.org` will be rejected or filed as spam.

So `send-outbound`'s SMTP credential must be an authenticated relay through an
authorised sender. Do **not** solve this by adding the VPS to SPF: that
authorises a box running arbitrary workflows to send as the whole domain.

## Getting into the box

Only two facts here are directly verified; the rest of the first attempt at this
project cost three reinstalls and an IP block, so the verified ones are worth
reading before touching access on any host.

**Verified, and the first one was the actual cause of every failure:**

- **This image logs you in as `debian`, not `root`.** OVH's Debian 13 VPS image
  provisions a non-root `debian` user with passwordless sudo and puts the selected
  SSH key there. `root` gets no key, and Debian's default
  `PermitRootLogin prohibit-password` means no password works for root over SSH
  either — so every `ssh root@…` attempt fails no matter what is configured. The
  delivery email names the user; read it before debugging anything.

- **A passphrase-protected local key plus an empty `ssh-agent` fails exactly like
  a missing remote key.** `ssh -o BatchMode=yes` cannot prompt for a passphrase,
  so it offers the public key, cannot sign, and reports
  `Permission denied (publickey)` — indistinguishable from the server not having
  the key at all. Check the local side first: `ssh-add -l` should list the key,
  and `ssh-keygen -y -f ~/.ssh/<key>` proves the passphrase works. Every access
  conclusion drawn before that check is worthless.
- **Do not poll SSH in a loop.** Retrying every ten seconds while waiting for a
  host to come up is a brute-force pattern; this host's hardening blocked the
  source IP, after which connections are reset with
  `banner line 0: Not allowed at this time` *before* authentication — which looks
  nothing like a permissions problem and invalidates every test until the ban
  expires (typically 10-30 minutes). Wait, then try once.

**Observed on the OVH VPS 2027 range, single occurrences, not established as
general behaviour:**

- `ovhcloud vps set-password` → `403 "This function is not available on your VPS"`.
- `ovhcloud vps edit --keymap us` → reports success, while `GET /vps/<sn>` still
  returns `keymap=null`. A console keyboard may therefore not match yours: with an
  unset keymap it can be AZERTY, so `q` types `a` and `w` types `z`, and the
  password prompt does not echo. Diagnose by typing the password at the `login:`
  prompt, which does echo. The CLI hands you a `vnc_lite.html` console URL with no
  clipboard; swapping it for `vnc.html` gives a clipboard panel that bypasses the
  layout entirely.
- Whether `vps reinstall --public-ssh-key` / `--ssh-key <registered name>`
  pre-install a key is **unresolved** — every test of it ran under the traps
  above and against the wrong user, so the evidence proves nothing either way.
  What is confirmed: selecting the key in the Manager UI's reinstall dialog
  installs it, for the `debian` user, and OVH then sends no password at all —
  a delivery mail with a username and no password is the signal that the key
  went in.

**The rule that would have prevented all of it:** never remove one route into a
machine before the replacement is proven. Combining an unverified key flag with
`--do-not-send-password` left no key, no password, and a console login that could
not succeed.

## Bringing the stack up

Log in as `debian` (`ssh debian@<ip>`) and use `sudo` for anything privileged;
Docker commands work without sudo once `debian` is in the `docker` group.

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
