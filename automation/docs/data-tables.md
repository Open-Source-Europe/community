# Data tables

## `ose_applications`

The n8n Data table that holds every application's state, from intake through
decision. Keyed on `slug` (the Open Collective collective slug) — one row per
application. n8n Data tables live inside the same Postgres as everything else
n8n stores, so the backup procedure in `automation/infra/README.md` covers
this table too.

Data tables support only `Boolean`, `Date`, `Number` and `String` columns, so
anything structured (the AI verdict fields, form answers) is stored as a JSON
string and parsed by whichever node reads it.

Column names are final — the workflows (`automation/n8n/*.json`) use them
verbatim. "Written by" below names the workflow that owns each column.

| Column | Type | Written by | Notes |
|---|---|---|---|
| `slug` | String | intake (`oc-events-intake`, `intake-sweep`) | Open Collective collective slug. Primary key. |
| `org` | String | intake | Which org the application came in on: `OSE` or `OCE`. Templates need a display name, not this code — see "Filling the email and prompt templates" below for how `org_name` is derived. |
| `host_slug` | String | intake | The OC host account the application targets: `europe` (OSE), or `oce-foundation-eur` / `oce-foundation-usd` (OCE runs two hosts, one per currency). The decision check queries the application's status against exactly this host. |
| `collective_name` | String | intake | Display name, from the host-admin API. |
| `collective_url` | String | intake | Public Open Collective page for the collective. |
| `description` | String | intake | The collective's public one-line description — input to the AI review. Public project material. |
| `long_description` | String | intake | The collective's public long description — input to the AI review. Public project material. |
| `repository_url` | String | intake | First GitHub/GitLab social link on the collective, if any — input to the AI review. |
| `website_url` | String | intake | First website social link on the collective, if any — input to the AI review. |
| `application_message` | String | intake | The message the applicant wrote when applying on OC — input to the AI review. |
| `applicant_email` | String | intake | Captured at intake from the host-admin API: the application's `customData` contact email when present, else the first collective-admin email visible to the host admin. The `collective.apply` webhook payload itself carries no application data at all (verified against the OC source — see `automation/docs/verified.md`). **Personal data.** |
| `stage` | String | every workflow, as the application progresses | One of the nine stage values below. |
| `applied_at` | Date | intake | The application's `createdAt` on Open Collective. |
| `ai_verdict` | String | AI review (`review`) | One of `fits`, `wrong_host`, `not_open_source`, `unclear` — see `automation/prompts/verdict.schema.json`. |
| `ai_confidence` | Number | AI review | 0–1, from the verdict object. |
| `ai_reasoning` | String | AI review | Reviewer-facing explanation from the model. Never shown to the applicant. |
| `ai_applicant_message` | String | AI review | Applicant-facing text from the model. Used in the `advised-wrong-host` / `advised-not-open-source` email templates; never presented as a decision. |
| `ai_model` | String | AI review | The model identifier used for this review (`AI_MODEL`), so old verdicts stay traceable after a model or prompt change. |
| `ai_reviewed_at` | Date | AI review | When the review ran. |
| `contact_email` | String | form workflows (`form-ose`, `form-oce`) | Given by the applicant on form page 1. Distinct from `applicant_email` — this is who the applicant says to contact, which may differ from the address the OC application came from. **Personal data.** |
| `form_invited_at` | Date | follow-up (`followup`) | When the invitation email was sent (the template varies by verdict; every reviewed application is invited). |
| `form_reminded_at` | Date | follow-up, driven by `REMINDER_AFTER_MINUTES` / `SWEEP_CRON` | When the `reminder` email was sent, after silence following the invite. |
| `form_page` | Number | form workflows | Which page of the multi-page form the applicant has reached; answers persist per page. |
| `answers` | String (JSON) | form workflows | Form responses so far. Shape below. |
| `form_submitted_at` | Date | form workflows | When the final form page was submitted. |
| `slack_notified_at` | Date | form workflows and follow-up | When Slack was last told about this row (ready for evaluation, or escalation). |
| `decision` | String | intake (decision branch of `oc-events-intake` / `intake-sweep`) | `approved` or `rejected`, from the human decision made on Open Collective. |
| `decided_at` | Date | intake (decision branch) | When that decision was recorded. |
| `dry_run` | Boolean | send-outbound | Set whenever an outbound message for this row was sent while `DRY_RUN=true`, so a row that advanced state during a test is visibly a test rather than indistinguishable from a real one. |
| `freshdesk_ticket_id` | String | — | Intentionally unused. Reserved for a possible future Freshdesk integration; no current workflow writes it. |

### The nine `stage` values

In order through a normal application, plus the escalation branch:

Every reviewed application is invited to the form — the AI verdict changes
only which email carries the invitation, never whether it is sent. An
`unclear` or adverse first read is a transparent hint in the email, not a
gate; the form is where a thin Open Collective description gets filled out.

1. `applied` — intake has created the row.
2. `reviewed` — the AI review has run.
3. `form_invited` — the step-2 form invite has been sent.
4. `form_started` — the applicant has submitted at least one form page.
5. `form_submitted` — the applicant has submitted the final form page.
6. `awaiting_decision` — Slack has been notified; a human needs to decide.
7. `approved` — the terminal decision, recorded from Open Collective.
8. `rejected` — the terminal decision, recorded from Open Collective.
9. `escalated` — no activity within `ESCALATE_AFTER_MINUTES` of the
    reminder; the sweep flags it for a human rather than leaving it silent. Non-terminal: an
    escalated row can still move on to `awaiting_decision` or further once a
    human acts.

### Shape of `answers`

```json
{
  "page": 3,
  "submitted_at": "2026-09-01T10:04:00Z",
  "responses": { "question_id": "answer" }
}
```

`page` is the last page these responses cover; `responses` accumulates across
pages as the applicant progresses, keyed by question ID.

The question IDs, in page order:

- **OSE** (`form-ose`, 4 pages): page 2 — `repository_url`, `licence`,
  `open_development`; page 3 — `operating_duration`, `fundraising_to_date`,
  `fundraising_goal`, `funding_sources`; page 4 — `activities`, `mission_fit`,
  `notes`.
- **OCE** (`form-oce`, 3 pages): page 2 — `operating_duration`,
  `fundraising_to_date`, `fundraising_goal`, `funding_sources`; page 3 —
  `activities`, `mission_alignment`, `notes`.

Page 1 of both forms asks only `contact_email` and the collective URL (stored
as columns, not in `answers`). The OCE questions are the documented OCE
application questions; the OSE variant replaces the mission question and adds
the open-source evidence the advisory emails point applicants at (repository,
licence, open development).

## Filling the email and prompt templates

Not every `{{ placeholder }}` used in `automation/emails/*.md` and
`automation/prompts/review.user.md` comes from a column on this table:

- `org_name` — the templates need a display name ("Open Source Europe",
  "Open Collective Europe"), but this table only stores the code (`org`:
  `OSE` or `OCE`). Mapping the code to the display name is `send-outbound`'s
  job, done at send time; `org_name` itself is never stored.
- `form_url` — the step-2 form link is per-org configuration, not
  per-application state: `FORM_URL_OSE` and `FORM_URL_OCE` in the n8n
  environment (see `automation/infra/docker-compose.yml` and
  `automation/infra/README.md`), selected by `org`. There is no `form_url`
  column and no token for it in this table.
- `collective_name`, `ai_applicant_message` and the rest of the template
  placeholders come straight from the columns above.

A form submission is matched back to its row without a token in the URL:
form page 1 asks the applicant for their Open Collective collective URL, and
the workflow derives the slug from it to look up the row keyed on `slug`.

## Personal data

`applicant_email` and `contact_email` are the only personal data in this
table. Neither is ever sent to the model: `automation/prompts/review.user.md`
sends only `org_name`, `collective_name`, `collective_slug`, `description`,
`long_description`, `repository_url`, `website_url` and
`application_message` — no name, no email address, for either the applicant
or the collective's contact.

`freshdesk_ticket_id` is intentionally unused — see the table above.
