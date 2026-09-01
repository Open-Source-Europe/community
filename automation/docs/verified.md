# Verified on the real system

What has actually been tested against the running box and the live provider, and
what has not. Assumptions get recorded here only once something proved them.

## Confirmed

**Scaleway honours `response_format: {"type": "json_object"}`** — 2026-09-01,
model `mistral-small-3.2-24b-instruct-2506` via `https://api.scaleway.ai`. All
four fixtures returned valid JSON matching `verdict.schema.json` with no retry.
The parse-and-retry fallback the plan held in reserve is not needed.

**First live run of the review harness** — 2026-09-01, 4/4 fixtures passed:

| Fixture | Expected | Got | Confidence |
|---|---|---|---|
| `ambiguous` | `unclear` | `unclear` | 0.3 |
| `fit-clear` | `fits` | `fits` | 0.9 |
| `not-open-source` | `not_open_source` | `not_open_source` | 0.9 |
| `wrong-host` | `wrong_host` | `wrong_host` | 0.9 |

The confidence spread is the useful signal: the deliberately thin fixture came
back at 0.3 while the clear ones sat at 0.9, so "prefer unclear over a guess" is
working rather than merely instructed.

**Resource headroom** — 2026-08-31, whole stack running: 1071 MB of 3826 MB
used; n8n 379 MB, Postgres 48 MB, Caddy 17 MB. VPS-1 (2 vCore / 4 GB) is ample;
the constraint on this box is execution history, not memory.

**Postgres is the backend, not SQLite** — n8n's 131 tables present in the `n8n`
database, zero SQLite mentions in the container logs.

**Backups run unattended and restore cleanly** — timer fired by itself 03:22 UTC
2026-09-01; restore rehearsed into a scratch database with 0 errors and 131
tables, matching live.

**The box logs you in as `debian`, not `root`** — see the access section of
[`../infra/README.md`](../infra/README.md).

## Not yet tested

- **Data table filters and date comparison.** Needed by the reminder and
  escalation timers. If equality-only, the sweep fetches all rows and filters in
  the workflow — fine at this volume, but the design should say which.
- **Form execution lifetime across a restart.** Sets the ceiling on how long an
  applicant may take, and decides how much per-page persistence really buys.
- **The bare-URL form rewrite, end to end.** Partially proven: `apply.` returns a
  404 rendered *by n8n*, so Caddy does reach `/form/apply-ose`. Whether n8n's
  form pages use relative URLs — and so stay on `apply.` through a multi-page
  submit — needs a real form.

## Known gaps found by testing

**~~Nothing asserts the register of `applicant_message`~~ — closed 2026-09-02.**
The harness now fails any `applicant_message` containing an exclamation mark or
an enthusiasm word, and the prompt states the constraint as a hard rule. The
check proved itself immediately: with the first (softer) prompt wording the
model still wrote "a great example of a community project" and the eval failed
3/4 on tone with verdicts intact; after hardening the wording, 4/4. The prompt
was tuned, the check was not weakened.

**A failed backup is invisible to `journalctl`** — see the backup section of
[`../infra/README.md`](../infra/README.md).
