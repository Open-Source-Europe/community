# Automation

Software that automates OSE community operations — starting with the new
collective application process (see
[issue #13](https://github.com/opensourceeurope/community/issues/13)).

Everything under `automation/` is licensed under the [MIT License](LICENSE),
not the CC-BY-4.0 licence that covers the rest of this repository.

Nothing in here may contain credentials, or real applicant data used as test
fixtures — synthesise test data instead.

## Configuration

[`.env.example`](.env.example) documents every variable, with its production
default and the value to use while testing. Copy it to `.env` and fill it in;
never commit a filled-in copy.

SMTP, Slack and Open Collective credentials are deliberately **not** in there.
They live in n8n's own credential store, referenced by name from the nodes, so
they are never in a file and never in git.

### Two things worth knowing before you test

**Outbound is gated by one switch in one place.** `DRY_RUN` is read once, inside
the `send-outbound` sub-workflow, which is the only thing in the system that
talks to email or Slack. No other workflow contains an email or Slack node —
they call `send-outbound` instead. So going live is one change in one place, and
proving suppression works is one test.

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
