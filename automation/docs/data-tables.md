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

Column names are final — Tasks 7–11 (not yet built as of this document) use
them verbatim. "Written by" below names the workflow *role* each task plan
assigns, per the Task 4/5 briefs; treat these as the planned owner of each
column, not a confirmed n8n workflow title, since Tasks 7–11 haven't been
authored yet.

| Column | Type | Written by | Notes |
|---|---|---|---|
| `slug` | String | intake (Task 7) | Open Collective collective slug. Primary key. |
| `org` | String | intake (Task 7) | Which host the application came in on: `OSE` or `OCE`. Templates need a display name, not this code — see "Filling the email and prompt templates" below for how `org_name` is derived. |
| `collective_name` | String | intake (Task 7) | Display name, from the OC webhook payload. |
| `collective_url` | String | intake (Task 7) | Public Open Collective page for the collective. |
| `applicant_email` | String | intake (Task 7) | Captured at intake — the address the OC application came from, falling back to the host-admin API if the webhook payload omits it. **Personal data.** |
| `stage` | String | every workflow, as the application progresses | One of the ten stage values below. |
| `applied_at` | Date | intake (Task 7) | When the OC application webhook fired. |
| `ai_verdict` | String | AI review (Task 8) | One of `fits`, `wrong_host`, `not_open_source`, `unclear` — see `automation/prompts/verdict.schema.json`. |
| `ai_confidence` | Number | AI review (Task 8) | 0–1, from the verdict object. |
| `ai_reasoning` | String | AI review (Task 8) | Reviewer-facing explanation from the model. Never shown to the applicant. |
| `ai_applicant_message` | String | AI review (Task 8) | Applicant-facing text from the model. Used in the `advised-wrong-host` / `advised-not-open-source` email templates; never presented as a decision. |
| `ai_model` | String | AI review (Task 8) | The model identifier used for this review (`INFERENCE_MODEL`), so old verdicts stay traceable after a model or prompt change. |
| `ai_reviewed_at` | Date | AI review (Task 8) | When the review ran. |
| `contact_email` | String | form workflow (Task 10) | Given by the applicant on form page 1. Distinct from `applicant_email` — this is who the applicant says to contact, which may differ from the address the OC application came from. **Personal data.** |
| `form_invited_at` | Date | follow-up / invite workflow (Task 9) | When the `step2-invite` email was sent. |
| `form_reminded_at` | Date | reminder/escalate sweep (Task 9), driven by `REMINDER_AFTER_MINUTES` / `SWEEP_CRON` | When the `reminder` email was sent, after silence following the invite. |
| `form_page` | Number | form workflow (Task 10) | Which page of the multi-page form the applicant has reached, for resuming and for the `awaiting_decision` gate. |
| `answers` | String (JSON) | form workflow (Task 10) | Form responses so far. Shape below. |
| `form_submitted_at` | Date | form workflow (Task 10) | When the final form page was submitted. |
| `slack_notified_at` | Date | notify workflow (Task 10/11) | When Slack was told a human decision is needed. |
| `decision` | String | decision-listener workflow (Task 11) | `approved` or `rejected`, from the human decision made on Open Collective. |
| `decided_at` | Date | decision-listener workflow (Task 11) | When that decision was recorded. |
| `dry_run` | Boolean | send-outbound (Task 4) | Set whenever an outbound message for this row was sent while `DRY_RUN=true`, so a row that advanced state during a test is visibly a test rather than indistinguishable from a real one. |
| `freshdesk_ticket_id` | String | — | Intentionally unused. Reserved for a possible future Freshdesk integration; no current workflow writes it. |

### The ten `stage` values

In order through a normal application, plus the escalation branch:

1. `applied` — intake has created the row.
2. `reviewed` — the AI review has run.
3. `form_invited` — the step-2 form invite has been sent.
4. `advised` — the AI review came back `wrong_host`, `not_open_source` or
   `unclear`; the applicant has been sent the advisory message, but a human
   still makes the final call. An `unclear` verdict takes the same advisory
   path as `not_open_source` — it is not treated as a pass — and the
   escalation timer below puts the row in front of a human either way.
5. `form_started` — the applicant has submitted at least one form page.
6. `form_submitted` — the applicant has submitted the final form page.
7. `awaiting_decision` — Slack has been notified; a human needs to decide.
8. `approved` — the terminal decision, recorded from Open Collective.
9. `rejected` — the terminal decision, recorded from Open Collective.
10. `escalated` — no activity within `ESCALATE_AFTER_MINUTES` of the last
    step, whether that step was the reminder or an `advised` message; the
    sweep flags it for a human rather than leaving it silent. Non-terminal: an
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
