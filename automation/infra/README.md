# Infra: n8n on Postgres behind Caddy

The VPS that runs the application automation. Three containers: `postgres`
(n8n's database, not the default SQLite), `n8n` itself, and `caddy` as a
reverse proxy that terminates TLS and gets certificates automatically.

## Quick facts

| | |
|---|---|
| Host | `vps-ba27c085.vps.ovh.net` — `92.222.85.114`, `2001:41d0:404:200::950d` |
| Log in as | `ssh debian@92.222.85.114` (key only; passwordless sudo). **Not root** |
| Checkout on the box | `~/community`, branch as deployed |
| Compose dir | `~/community/automation/infra` |
| Config | `~/community/automation/infra/.env` (mode 600, never committed) |
| Admin URL | https://automation.opensourceeurope.org |
| Applicant URL | https://apply.opensourceeurope.org |
| Backups | `~/backups/n8n-*.sql.gz`, daily, 14 days |

## What do you need to do?

| Task | Section |
|---|---|
| Install this from nothing | [First install](#first-install-from-a-fresh-vps) |
| Start, stop, look at logs | [Day to day](#day-to-day) |
| Take or verify a backup | [Backup](#backup) |
| Put a backup back | [Restore](#restore) |
| Upgrade n8n | [Upgrading n8n](#upgrading-n8n) |
| Something is broken | [Troubleshooting](#troubleshooting) |
| Get in when SSH refuses you | [Getting into the box](#getting-into-the-box) |

## The box

Provisioned 2026-08: OVHcloud **VPS-1 2027** — 2 vCore, 4096 MB, 40 GB NVMe,
**Strasbourg SBG6** (EU). Debian 13 (trixie).

That is roughly 4x what this stack needs. At rest n8n uses ~300-500 MB,
Postgres ~150 MB at this data volume, Caddy ~30 MB; the application load is a
few workflow executions a day. The constraint on a box this size is never
throughput — it is unbounded execution history, which is what
`EXECUTIONS_DATA_PRUNE` below is for.

## Where each secret lives

Three separate stores, and nothing crosses between them. Confusing them is easy
and has already caused a wrong turn.

| Store | Where | Holds | Not this |
|---|---|---|---|
| `~/.ovh.conf` | the operator's own laptop, mode 600, **never in this repo** | OVH API credentials only: `endpoint`, `application_key`, `application_secret`, `consumer_key` — used to manage the VPS itself | nothing about n8n, Postgres or inference. Never add application secrets here |
| `.env` | on the VPS, in `automation/infra/`, mode 600 | `POSTGRES_PASSWORD`, `N8N_ENCRYPTION_KEY`, `AI_API_KEY`, plus all non-secret config | not OVH credentials, not SMTP/Slack/OC credentials |
| n8n's credential store | inside the Postgres database, encrypted with `N8N_ENCRYPTION_KEY` | SMTP, Slack and Open Collective credentials, referenced by name from nodes | anything that has to exist before n8n starts |
| `~/.n8n-api-key` | on the box, mode 600, outside the repo | the n8n public-API key, used only to build and export workflows programmatically | **not `.env`** — that file is injected into the container and n8n has no use for its own API key. Revoke this key once the workflows are built |

The password vault holds a copy of what cannot be regenerated, as **separate
entries** in a vault shared with more than one admin — see
[the encryption key section](#n8n_encryption_key-back-it-up-off-this-box-before-anything-else).
Recovering this box means finding these three, so they are named here for
whoever is searching the vault later:

- `OSE automation — n8n encryption key` (unrecoverable if lost)
- `OSE automation — Postgres (n8n db)` (resettable)
- `OSE — OVHcloud API` (re-issuable with `ovhcloud login`)

## Variables this compose file needs

This compose file reads two sets of variables, documented in two different
places:

- **Three infra-only variables**, documented right here, in the table below.
  They belong to this directory, not to the n8n workflows.
- **Application variables** (`DRY_RUN`, `AI_API_KEY`, `FORM_URL_OSE`
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

## The n8n community licence is optional

n8n mails a free activation key (Settings → Usage and plan) that unlocks
conveniences — workflow history, folders, debug in editor. **Nothing in this
automation depends on it**, so a missing or unrequested key blocks nothing.

If one is activated it lives in the database (`settings`, key `license.cert`),
not in `.env`, so `pg_dump` already covers it and a restore brings it back. Keep
a copy in the vault anyway for a from-scratch rebuild with no dump to hand.

To check whether one is active:

```bash
docker compose exec -T postgres psql -U n8n -d n8n -tAc "select key from settings order by key"
```

As of 2026-09-01 no licence is activated on this instance and no
`N8N_LICENSE_*` variable is set.

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

### The `ovhcloud` CLI needs credentials, and they expire

Managing the VPS (console URLs, reinstall, state, keymap) goes through the
`ovhcloud` CLI, which reads API credentials from `~/.ovh.conf` — endpoint,
application key, application secret, consumer key.

- **Keep that file outside this repo.** It began life in the repo's working
  directory, untracked but not ignored, one `git add -A` away from publishing an
  application secret. `~/.ovh.conf` (mode 600) is where the CLI looks by default;
  `ovh.conf` is now gitignored as a backstop.
- **`INVALID_CREDENTIAL` (403) on every call means the consumer key is gone** —
  revoked, expired, or rotated. It is not a permissions problem with the VPS.
  Fix: `ovhcloud login`, which runs a browser consent flow and rewrites the file.
- Unlike `N8N_ENCRYPTION_KEY`, these are cheap to lose: revoke and re-issue at
  will. Vault them for convenience, not as insurance.

**The rule that would have prevented all of it:** never remove one route into a
machine before the replacement is proven. Combining an unverified key flag with
`--do-not-send-password` left no key, no password, and a console login that could
not succeed.

## First install, from a fresh VPS

Every command below was run in this order on 2026-08-31 and is idempotent —
re-running it on a working box changes nothing. Log in as `debian`; use `sudo`
for privileged steps.

```bash
# 1. packages
export DEBIAN_FRONTEND=noninteractive
sudo -E apt-get update -qq && sudo -E apt-get upgrade -y -qq
sudo -E apt-get install -y -qq git ufw unattended-upgrades ca-certificates curl

# 2. firewall — ALLOW BEFORE ENABLE, or you lock yourself out
sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
sudo ufw --force enable
# Postgres is never published to the host; it is reachable only on the compose network.

# 3. key-only SSH. Do this ONLY after key login is proven working.
sudo tee /etc/ssh/sshd_config.d/99-ose-hardening.conf >/dev/null <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
CONF
sudo sshd -t && sudo systemctl reload ssh     # validate, then reload
# now open a SECOND session to confirm you still have access before closing this one

# 4. docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker debian
# log out and back in so the group applies, then `docker ps` works without sudo

# 5. the repo
git clone https://github.com/opensourceeurope/community.git ~/community
cd ~/community && git checkout <branch-or-main>

# 6. config — generate secrets ON THE BOX so they never travel
cd ~/community/automation/infra
umask 077
cp ../.env.example .env
# add the infra-only variables from the table above:
#   N8N_HOST, APPLY_HOST, EXECUTIONS_DATA_PRUNE=true, EXECUTIONS_DATA_MAX_AGE=336
#   POSTGRES_PASSWORD=$(openssl rand -hex 24)
#   N8N_ENCRYPTION_KEY=$(openssl rand -hex 32)   <- save to the password manager NOW
chmod 600 .env
docker compose config >/dev/null   # must report no unset variables

# 7. up
docker compose up -d
```

### Verify the install, in this order

```bash
# (a) Postgres really is the backend. If this is empty, n8n fell back to SQLite —
#     stop and fix DB_TYPE before anything is stored.
docker compose exec -T postgres psql -U n8n -d n8n -c "\dt" | head
docker compose logs n8n | grep -ci sqlite      # expect 0

# (b) certificates and both hostnames, from OUTSIDE the box
curl -sS -o /dev/null -w '%{http_code}\n' https://automation.opensourceeurope.org/   # 200
curl -sS -o /dev/null -w '%{http_code}\n' https://apply.opensourceeurope.org/        # 404 until the form workflow exists — see below

# (c) resource headroom
docker stats --no-stream; free -m
```

**A 404 on `apply.` is correct until the form exists.** The Caddy rewrite sends
`/` to `/form/apply-ose`; n8n answers 404 because no workflow serves that path
yet. The tell that the rewrite works is that the 404 body is an n8n-rendered
page. Measured on first install: 1071 MB of 3826 MB used, n8n 379 MB, Postgres
48 MB, Caddy 17 MB.

Then create the n8n owner account at the admin URL.

**If you create it with the wrong email**, in rough order of preference:

1. **Settings → Personal** in n8n — change the email in place, no reset.
2. `UPDATE "user" SET email='…'` in Postgres — keeps the account and skips
   setup, useful if the UI field is gated behind SMTP.
3. `docker compose exec -T n8n n8n user-management:reset` — clears users and
   brings the setup screen back. It deletes the account, so check first that
   there is nothing to lose:

```bash
for t in workflow_entity credentials_entity; do
  printf "%-20s " "$t"
  docker compose exec -T postgres psql -U n8n -d n8n -tAc "select count(*) from $t"
done
```

Zero in both means a reset costs nothing but the account itself.

## Day to day

```bash
cd ~/community/automation/infra
docker compose ps                  # what is running
docker compose logs -f n8n         # follow n8n
docker compose logs --tail=50 caddy
docker compose restart n8n
docker compose down                # stop everything; named volumes survive
docker compose up -d               # back up
```

**After editing `.env`, `restart` is not enough.** `docker compose restart` reuses
the existing container with its existing environment; the file is only re-read
when the container is recreated:

```bash
docker compose up -d n8n           # recreates with the new .env values
```

## Setting the credentials that are not generated here

`AI_API_KEY` (Scaleway inference) is the one secret this box needs that it
cannot generate for itself.

**Use a key dedicated to this automation** — not the one already in use by
`ose-knowledge-mcp`. Separate keys rotate independently, limit the blast radius
of a leak, and make usage attributable to the right system.

**Two files carry these variable names; only one takes real values.**
`automation/infra/.env` on the box is the real config — edit this.
`automation/.env.example` is a committed template, and every value in it is
empty on purpose. Putting a real key there commits a secret to a public
repository, which is the worst version of this mistake. Both being empty looks
identical, so check the path, not the contents.

Set it by editing the file on the box, and watch what you type:

```bash
ssh -t debian@<ip> 'nano ~/community/automation/infra/.env'
# Ctrl+W, search AI_API_KEY, paste the secret key after the = (no spaces, no quotes)
# Ctrl+O, Enter to save, Ctrl+X to exit
ssh debian@<ip> 'cd ~/community/automation/infra && docker compose up -d n8n'
```

**Expect `Recreated`, not `Running`.** That word is the only evidence the value
actually changed: compose recreates the container when the resolved environment
differs, and reports `Running` when it does not.

Verify rather than assume. Print **lengths only** — and be careful how: an
earlier version of this snippet used `${V:+set}${V:-EMPTY}`, which expands to the
value itself whenever the variable is set, and leaked a live key into a
transcript. Use an explicit `if`:

```bash
ssh debian@<ip> 'cd ~/community/automation/infra
  awk -F= "/^AI_API_KEY=/{print \"env file:\", (length(\$2)?\"set\":\"EMPTY\")}" .env
  V=$(docker compose exec -T n8n printenv AI_API_KEY | tr -d "\r\n")
  if [ -n "$V" ]; then echo "container: set, ${#V} chars"; else echo "container: EMPTY"; fi'
```

If your terminal swallows nano's paste, this prompts **on the box** with a TTY, so
the paste lands where it is read, and it refuses to write an empty value:

```bash
ssh -t debian@<ip> 'printf "paste key then Enter: "; IFS= read -r K; \
  [ -n "$K" ] && sed -i "s|^AI_API_KEY=.*|AI_API_KEY=$K|" ~/community/automation/infra/.env \
    && echo "written, ${#K} chars" || echo "EMPTY — nothing written"'
```

A piped one-liner (`read -rs KEY` into `ssh … sed`) looks tidier and was tried
first here. **Avoid it.** If the read captures nothing — an interactive paste that
does not land, a shell difference — `sed` writes an empty value, compose sees no
change and prints `Running`, and every step reports success while the key is
still missing. Two attempts failed that way before anyone noticed.

**A GitHub Actions secret is not a place you can read a value back from.** They
are write-only: `gh secret list` returns names and timestamps, there is no `get`,
and no API exposes the value. If a credential exists *only* as a repo secret, it
is effectively lost — keep the copy of record in the shared password vault.

## N8N_ENCRYPTION_KEY: back it up, off this box, before anything else

`N8N_ENCRYPTION_KEY` encrypts every credential n8n stores — SMTP, Slack, Open
Collective, everything referenced by name from workflow nodes. **If this key
is lost, every one of those stored credentials is unrecoverable.** There is no
reset or recovery path: each credential has to be re-entered by hand, in every
workflow that references it. Generate it once, store it in the operator's
password manager the moment it's generated, and never regenerate it against
an existing database — a mismatched key does not decrypt what's already
there.

**Store it in a vault shared with at least one other admin, not a personal
one.** A key that exists only in one person's password manager makes OSE's
ability to recover this instance depend on that person's account being
reachable — which is a bus factor of one dressed up as a backup. The same goes
for `POSTGRES_PASSWORD` — but store it as its **own vault entry**, not a field
on the same item. Their lifecycles differ: the Postgres password is rotated by
resetting the role and updating `.env`, while the encryption key must never
change while a database exists. Keeping them separate means routine rotation
never involves editing the item that must not be touched, lets the two carry
their very different "what happens if I lose this" notes, and allows the
database password to be shared with someone doing database work without handing
over the key that decrypts every stored credential.

To read the values back off the box:

```bash
ssh debian@<ip> 'grep -E "N8N_ENCRYPTION_KEY|POSTGRES_PASSWORD" ~/community/automation/infra/.env'
```

Run that in a human's own terminal. Do not paste either value into a chat,
an issue, a commit, or an agent transcript — anything that records it becomes
another copy to protect.

## Backup

n8n's tables (workflows, credentials, execution history) **and** the
`ose_applications` Data table live in the same Postgres — Data tables are just
tables inside n8n's database. So one `pg_dump` of `n8n` is the entire backup,
covering applicant stage, AI verdicts, form answers and decisions.

[`backup.sh`](backup.sh) does it, and refuses to leave a plausible-looking
useless file behind: it fails if the dump is under 10 KiB, fails gzip
integrity, or contains no `CREATE TABLE`.

```bash
~/community/automation/infra/backup.sh          # writes ~/backups/n8n-<stamp>.sql.gz
```

Schedule it with the systemd units in [`systemd/`](systemd/) — 03:17 UTC daily.
Debian 13 minimal ships **no cron package**, and a timer is the better fit
anyway: `Persistent=true` runs a backup that was missed while the box was down,
which cron silently skips.

```bash
sudo cp ~/community/automation/infra/systemd/ose-backup.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ose-backup.timer

systemctl list-timers ose-backup.timer      # when it next fires
sudo systemctl start ose-backup.service     # run one now
tail ~/backups/backup.log
```

**A failed backup is invisible to the journal.** The service sets
`StandardOutput=append:` to `~/backups/backup.log`, which *replaces* journal
output — so `journalctl -u ose-backup.service` shows "No entries" even for runs
that happened, and would show nothing for a run that failed. Check
`tail ~/backups/backup.log`, not the journal, until the units are changed to let
the script append to the log while systemd keeps the journal.

**Dumps will contain applicant personal data.** Not yet — `ose_applications`
does not exist — but once it does, every dump carries applicant email addresses
and form answers. That makes where copies are stored a data-protection question
as well as a durability one: encrypt before uploading anywhere off this box.

Confirmed running unattended: the timer fired on its own at 03:22 UTC on
2026-09-01 and wrote a dump. Installed and actually-runs are different claims,
and this is the second — check `systemctl list-timers ose-backup.timer` and
`tail ~/backups/backup.log` to re-confirm at any time.

**Copy backups off this box.** A backup that only exists on the machine it
protects does not survive that machine. Nothing in this repo does that for you
— it needs a destination someone owns.

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

### What each secret means for a rebuild

The dump contains database objects, not roles — verified: zero `CREATE ROLE` /
`ALTER ROLE` statements in it. That gives the two secrets very different
recovery properties:

| Scenario | `POSTGRES_PASSWORD` | `N8N_ENCRYPTION_KEY` |
|---|---|---|
| Restart, reboot, `down` + `up -d`, n8n upgrade | unchanged — it is a file on disk and the volumes persist | unchanged |
| `docker compose down -v`, box rebuilt, new VPS | gone with the filesystem; **pick a new one freely** | gone; **must be the original or credentials are unreadable** |
| Deliberate rotation on a live box | see below | never rotate against an existing database |

**Rotating `POSTGRES_PASSWORD` takes two steps, not one.** The compose variable
only initialises an *empty* data directory; editing `.env` afterwards does not
change the role, and n8n simply stops being able to connect:

```bash
docker compose exec -T postgres psql -U n8n -d postgres -c "ALTER ROLE n8n PASSWORD 'newvalue';"
# then update .env to match, and recreate so it is re-read
docker compose up -d n8n
```

### Rehearse it without risking the live database

Restore into a scratch database instead of over the real one. An untested backup
is not a backup, and this costs a minute:

```bash
cd ~/community/automation/infra
LATEST=$(ls -t ~/backups/n8n-*.sql.gz | head -1)
docker compose exec -T postgres psql -U n8n -d postgres -qc "CREATE DATABASE restoretest OWNER n8n;"
gunzip -c "$LATEST" | docker compose exec -T postgres psql -U n8n -d restoretest -q 2>&1 | grep -iE '^ERROR' | sort -u
# compare table counts — they should match
for db in restoretest n8n; do
  echo -n "$db: "
  docker compose exec -T postgres psql -U n8n -d "$db" -tAc \
    "select count(*) from information_schema.tables where table_schema = current_schema()"
done
docker compose exec -T postgres psql -U n8n -d postgres -qc "DROP DATABASE restoretest;"
```

Last rehearsed 2026-08-31: 0 errors, 131 tables in both.

A restore only produces a working instance if `N8N_ENCRYPTION_KEY` in `.env`
on the restoring box is the *same* key that was in use when the dump was
taken — the dump's credential rows are encrypted with it. Restoring a dump
under a different key leaves the credentials in the database but unreadable.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `ssh root@…` refused, any credential | This image has no root key, and Debian sets `PermitRootLogin prohibit-password` | Log in as `debian` |
| `Permission denied (publickey)` with the right key | Key is passphrase-protected and `ssh-agent` is empty; `BatchMode` cannot prompt to sign | `ssh-add ~/.ssh/<key>`, confirm with `ssh-add -l` |
| `banner line 0: Not allowed at this time`, connection reset | Source IP blocked by brute-force protection, usually from polling SSH in a loop | Stop connecting; wait 10-30 min |
| `REMOTE HOST IDENTIFICATION HAS CHANGED` | The box was reinstalled | `ssh-keygen -R <ip>` — only when you know why it changed |
| Certificate not issued | DNS for the hostname does not resolve to this box, or 80/443 blocked | Check `dig`, `sudo ufw status`; `docker compose logs caddy` |
| Caddy 502 for a few seconds after start | n8n still booting; Caddy has no healthcheck to gate on | Wait; it clears itself |
| `apply.` returns 404 | No workflow serves `/form/apply-ose` yet | Expected until the form exists |
| n8n log mentions SQLite | The `DB_TYPE` block is not taking effect | Fix before storing anything — migrating out of SQLite later is painful |
| Disk filling | Execution history unpruned | Check `EXECUTIONS_DATA_PRUNE=true` and `EXECUTIONS_DATA_MAX_AGE` |
| Credentials all broken after a restore | `N8N_ENCRYPTION_KEY` differs from the one in use when the dump was taken | Restore the original key; there is no recovery without it |
| Every `ovhcloud` command returns `INVALID_CREDENTIAL` (403) | The consumer key in `~/.ovh.conf` was revoked, expired or rotated | `ovhcloud login` |
| Applicant emails rejected or spam-filed | Mail sent from this box; the domain's SPF is `-all` for Proton only | Use an authenticated relay — see "Sending mail" above |

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
