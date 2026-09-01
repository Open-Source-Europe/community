# Automation

Software that automates OSE community operations — starting with the new
collective application process (see
[issue #13](https://github.com/opensourceeurope/community/issues/13)).

Everything under `automation/` is licensed under the [MIT License](LICENSE),
not the CC-BY-4.0 licence that covers the rest of this repository.

Nothing in here may contain credentials, or real applicant data used as test
fixtures — synthesise test data instead.

## Running it

The deployment lives on one VPS: n8n on Postgres behind Caddy.
[`infra/README.md`](infra/README.md) is the operator runbook — installing from a
fresh box, getting in when SSH refuses you, backups, restore (with a rehearsal
that risks nothing), upgrading n8n, and a troubleshooting table of failures
already hit in practice. Start there rather than reconstructing it.

## The workflows

`automation/n8n/` holds the export of every workflow, refreshed in the same PR
as any change. Seven workflows coordinate through one Data table
(`ose_applications`, keyed by collective slug) and never call each other —
except that everything outbound goes through `send-outbound`:

| Workflow | Trigger | Does |
|---|---|---|
| `send-outbound` | called by other workflows | The only sender. Renders a named template, reads `DRY_RUN` once, and delivers by email or Slack |
| `oc-events-intake` | `POST /webhook/oc-events` | OC webhooks carry no application data, so every event is a ping: apply → re-fetch pending applications and insert new rows; approved/rejected → re-check open rows and record the decision |
| `intake-sweep` | `SWEEP_CRON` | The same two syncs, as the backstop for missed webhooks |
| `review` | `SWEEP_CRON` | Advisory AI verdict for rows at `applied`, stored on the row |
| `followup` | `SWEEP_CRON` | Form invitation for every reviewed row (the verdict picks the email), then the reminder and the Slack escalation, derived from timestamps |
| `form-ose` / `form-oce` | `/form/apply-ose`, `/form/apply-oce` | The step-2 application forms: page-1 state lookup, answers persisted per page, Slack when ready for evaluation |

All of them are deployed **inactive** until the operator steps in
[`automation/docs/verified.md`](docs/verified.md) are done — credentials
(`oc-host-admin`, SMTP, Slack), webhook registration on the OC hosts, and the
suppression test. That file also records what was verified against the real
systems, with dates.

## Configuration

[`.env.example`](.env.example) documents every variable, with its production
default and the value to use while testing. Copy it to `.env` and fill it in;
never commit a filled-in copy.

SMTP, Slack and Open Collective credentials are deliberately **not** in there.
They live in n8n's own credential store, referenced by name from the nodes, so
they are never in a file and never in git.

### Providing the n8n API key to Claude Code

The repository enables the `n8n-skills` Claude Code plugin, and its n8n MCP
server reads `N8N_API_URL` and `N8N_API_KEY` from the session environment.
Set them once in `.claude/settings.local.json` at the repository root, your
personal, gitignored settings file:

```json
{
  "env": {
    "N8N_API_URL": "https://<your-n8n-host>/api/v1",
    "N8N_API_KEY": "<your key>"
  }
}
```

Create the file if it does not exist, fill in the values in an editor rather
than through a shell pipeline, and start a fresh Claude Code session. Without
these values the server still connects, but exposes only the read-only node
and documentation tools; the workflow-management tools need both.

### Two things worth knowing before you test

**Outbound is gated by one switch in one place.** `DRY_RUN` is read once, inside
the `send-outbound` sub-workflow, which is the only thing in the system that
talks to email or Slack. No other workflow contains an email or Slack node —
they call `send-outbound` instead. So going live is one change in one place, and
proving suppression works is one test.

That rule is the one thing here whose violation can mail a real applicant during
a test, and it is checkable rather than merely stated — run this after any change
to a workflow export:

```bash
grep -l '"type": "n8n-nodes-base.emailSend"\|"type": "n8n-nodes-base.slack"' automation/n8n/*.json \
  | grep -v 'send-outbound.json' \
  || echo "OK: no sender nodes outside send-outbound"
```

Any filename printed is a workflow that bypasses the gate. This is the first
thing worth turning into a CI check once `automation/n8n/` has exports.

**Shortening the reminder thresholds alone does nothing.** They are evaluated by
the sweep, so a 5-minute threshold on a daily sweep still takes a day to fire.
Shorten `SWEEP_CRON` with them, or click Execute on the sweep workflow in the
n8n UI for a single test.

And before shortening any timing, set `ONLY_SLUGS`. The automation runs against
production Open Collective data: a fast sweep with no slug restriction will
process every genuinely pending application, sending dry-run mail about real
applicants and advancing their real state rows.

## Email templates

Files in `automation/emails/` are plain-text email templates, one file per
message. The format is fixed:

- First line: `Subject: ` followed by the subject line.
- A blank line.
- The rest of the file is the plain-text body.

Both subject and body support `{{ placeholder }}` interpolation. The
placeholders currently available are `collective_name`, `org_name`,
`form_url` and `ai_applicant_message` — see
`automation/docs/data-tables.md` for where each value comes from (most are
columns on `ose_applications`; `org_name` and `form_url` are not — see
"Filling the email and prompt templates" in that document).

## Human decisions

The AI review is **advisory**. It never approves, rejects or closes an
application. Approve and reject happen on Open Collective, by a person, and the
automation only listens for the result — as required by the org
[AI policy](https://github.com/opensourceeurope/.github/blob/main/AI-POLICY.md),
which lists "casting governance votes or approvals" as human-only.

Only public project material is sent to the model: the collective's description,
the application message, and the linked repository and website. Never an
applicant's name or email address.
