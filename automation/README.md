# Automation

Software that automates OSE community operations — starting with the new
collective application process (see
[issue #13](https://github.com/opensourceeurope/community/issues/13)).

Everything under `automation/` is licensed under the [MIT License](LICENSE),
not the CC-BY-4.0 licence that covers the rest of this repository.

Nothing in here may contain credentials, or real applicant data used as test
fixtures — synthesise test data instead.

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
