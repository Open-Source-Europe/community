# Verified against the real systems

Answers to the plan's unknowns, each with the date tested and the evidence,
so a later surprise can be traced to a version bump instead of re-litigated.
Open items are listed at the bottom — they are the gate before `DRY_RUN` ever
goes false.

## Open Collective

**The activity webhook payload carries no application data.** Verified
2026-09-01 against `server/lib/webhooks.ts` in `opencollective/opencollective-api`
(`sanitizeActivityForWebhookPayload`): only `COLLECTIVE_TRANSACTION_CREATED`,
update/expense/member/ticket/order/subscription activities get a populated
`data` object. `COLLECTIVE_APPLY`, `COLLECTIVE_APPROVED` and
`COLLECTIVE_REJECTED` fall through to the common shape:

```json
{ "createdAt": "…", "id": 123, "type": "collective.apply", "CollectiveId": 456, "data": {} }
```

`CollectiveId` is a **v1 numeric id**, and GraphQL v2 has no lookup by it
(`account(id, slug, githubHandle)` only — introspected 2026-09-01). So the
workflows treat every webhook delivery as a *ping* and re-fetch from the
GraphQL API — the same queries the sweep runs. This also makes the webhook and
the sweep trivially convergent. Still worth doing: capture one real delivery
once the operator registers the webhooks, to confirm the shape end to end
(plan Task 2 Step 6).

**Activity type strings** (verified against `server/constants/activities.ts`,
2026-09-01): `collective.apply`, `collective.approved`, `collective.rejected`.

**For approved/rejected, `CollectiveId` is the collective, not the host** —
verified against `server/graphql/v2/mutation/HostApplicationMutations.ts`
(`CollectiveId: collective.id`, `HostCollectiveId: host.id`). Not load-bearing
given the ping design, but recorded because the old plan assumed it silently.

**Host slug** (queried on the public GraphQL API, 2026-09-01): on Open
Collective, `europe` is **Open Source Europe** (legacyId 9807) — not OCE,
despite the name. The automation watches only this host: OCE is out of scope
by decision (2026-09-01), and appears in exactly one place — the AI review's
`wrong_host` verdict, which may suggest a project fits Open Collective Europe
better. For the record, OCE's own hosts are `oce-foundation-eur` (729588) and
`oce-foundation-usd` (696998).

**Where the review inputs come from** (schema introspected 2026-09-01):
`Host.hostApplications(limit, offset, searchTerm, orderBy, status, …)` returns
`HostApplication { account, host, createdAt, status, message, customData }` —
admin-gated (verified earlier: `Unauthorized` without a host-admin token). The
collective's `description`, `longDescription` and `socialLinks {type url}`
ride along on `account`; there is no `repositoryUrl` field in v2, so the
repository is the first GitHub/GitLab social link and the website the first
`WEBSITE` one.

**Decision detection**: `Account.hostApplicationRequests(limit, offset,
orderBy, status)` lists an account's applications with per-request `status`
(`PENDING/APPROVED/REJECTED/EXPIRED`) and `host { slug }` — introspected
2026-09-01. The decision branch queries this per open row and matches on
`host_slug`, which needs no id conversion and is idempotent by stage guard.

## n8n (instance at automation.opensourceeurope.org, checked 2026-09-01)

**Data table date filters exist.** `applied_at gt <ISO date>` through the data
table API returned only the newer of two rows. The timer logic still fetches
by `stage` and compares timestamps in the workflow (Luxon in a Filter node) —
clearer, and immune to filter semantics changing.

**Round trip**: `ose_applications` created with every column from
`data-tables.md`; insert → filtered get → delete all behaved; every column
came back (nulls where unset).

**The n8n public API cannot activate workflows from this session** (blocked by
session policy) — all six workflows are deployed **inactive**. Activation is
an operator step, listed below.

## AI review

`response_format: {"type": "json_object"}` on Scaleway with
`mistral-small-3.2-24b-instruct-2506` works — the eval harness
(`automation/test/review-eval.mjs`) passed 4/4 against the live provider,
including the tone check (recorded in PR #21). The `review` workflow embeds
the same prompts and validates the same contract, and additionally strips
accidental markdown fences before parsing.

## Open items — the gate before going live

1. **Operator: OC host-admin token** as n8n credential `oc-host-admin`
   (Header Auth, header name `Personal-Token`), selected on the four HTTP
   nodes that query `hostApplications` / `hostApplicationRequests`. Verify
   with the curl checks in the plan against the `europe` host.
2. **Operator: register the webhook** `https://automation.opensourceeurope.org/webhook/oc-events`
   on the `europe` host account for the three activities, then capture one
   real delivery from the n8n execution log into this file.
3. **`applicant_email` availability is unconfirmed.** Intake takes
   `customData.email` / `customData.contactEmail` from the application, else
   the first admin `... on Individual { email }` visible to the host admin.
   Whether those are populated for *pending* applications needs the token to
   test. If all sources are empty the row is created with an empty
   `applicant_email` and the follow-up send fails loudly (visible in the
   executions list) rather than silently skipping the applicant.
4. **Operator: SMTP relay decision** (the domain's SPF forbids sending from
   the VPS), then an SMTP credential on `send-outbound`'s email node and
   `SMTP_FROM` in `.env`. Then run the Task 4 suppression test — with
   `DRY_RUN=true` a message must arrive at `DRY_RUN_RECIPIENT` only.
5. **Operator: Slack credential** on `send-outbound`'s Slack node and
   `SLACK_CHANNEL` in `.env`.
6. **`SWEEP_CRON` via `$env` in a Schedule Trigger** needs confirming at
   activation: check the trigger shows the next run matching the cron. If the
   expression is not evaluated there, hardcode the cron in the three
   scheduled workflows and note it here.
7. **Form behaviour on the bare URL** (`apply.opensourceeurope.org` rewrite)
   and **execution lifetime across a restart** (plan Task 3 Step 2/2a) still
   need a browser + VPS test. Related: n8n forms cannot jump to a page, so a
   returning applicant re-answers earlier pages; the per-page persistence
   means nothing they submitted is lost.
8. **Activate the workflows** (all deployed inactive): `send-outbound` needs
   no activation (sub-workflows run on call), `oc-events-intake` and
   `form-ose` must be activated for their URLs to serve, and `intake-sweep`,
   `review`, `followup` for the schedules to run. Before activating the
   scheduled three on production data: `ONLY_SLUGS` set, `DRY_RUN=true`.
