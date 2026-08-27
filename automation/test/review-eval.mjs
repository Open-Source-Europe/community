// automation/test/review-eval.mjs
// Runs each fixture through the review prompt and checks the verdict against the schema
// and the fixture's expectation.
//   MISTRAL_API_KEY=... node automation/test/review-eval.mjs
import { readFile, readdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const BASE = process.env.MISTRAL_BASE_URL ?? 'https://api.scaleway.ai'
const MODEL = process.env.MISTRAL_MODEL ?? 'mistral-small-3.2-24b-instruct-2506'
const KEY = process.env.MISTRAL_API_KEY
if (!KEY) { console.error('MISTRAL_API_KEY is not set'); process.exit(2) }

const schema = JSON.parse(await readFile(join(root, 'prompts/verdict.schema.json'), 'utf8'))
const system = await readFile(join(root, 'prompts/review.system.md'), 'utf8')
const template = await readFile(join(root, 'prompts/review.user.md'), 'utf8')

const render = (tpl, vars) =>
  tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '(not provided)')

// Minimal validator: enough for this one flat schema, no dependency needed.
function validate(obj) {
  const errors = []
  for (const key of schema.required) if (!(key in obj)) errors.push(`missing ${key}`)
  for (const [key, value] of Object.entries(obj)) {
    const rule = schema.properties[key]
    if (!rule) { errors.push(`unexpected ${key}`); continue }
    const actual = typeof value
    const wanted = rule.type === 'number' ? 'number' : rule.type === 'boolean' ? 'boolean' : 'string'
    if (actual !== wanted) { errors.push(`${key}: expected ${wanted}, got ${actual}`); continue }
    if (rule.enum && !rule.enum.includes(value)) errors.push(`${key}: "${value}" not in enum`)
    if (rule.minimum !== undefined && value < rule.minimum) errors.push(`${key}: below minimum`)
    if (rule.maximum !== undefined && value > rule.maximum) errors.push(`${key}: above maximum`)
    if (rule.minLength && value.length < rule.minLength) errors.push(`${key}: shorter than ${rule.minLength}`)
    if (rule.maxLength && value.length > rule.maxLength) errors.push(`${key}: longer than ${rule.maxLength}`)
  }
  return errors
}

async function review(input) {
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: render(template, input) },
      ],
    }),
  })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  const body = await res.json()
  return JSON.parse(body.choices[0].message.content)
}

const dir = join(root, 'test/fixtures')
const files = (await readdir(dir)).filter((f) => f.endsWith('.json'))
let failed = 0

for (const file of files.sort()) {
  const fixture = JSON.parse(await readFile(join(dir, file), 'utf8'))
  try {
    const verdict = await review(fixture.input)
    const errors = validate(verdict)
    const matched = verdict.verdict === fixture.expect_verdict
    if (errors.length || !matched) failed++
    console.log(`\n${matched && !errors.length ? 'PASS' : 'FAIL'}  ${fixture.name}`)
    console.log(`  expected: ${fixture.expect_verdict}   got: ${verdict.verdict} (confidence ${verdict.confidence})`)
    if (errors.length) console.log(`  schema errors: ${errors.join('; ')}`)
    console.log(`  reasoning: ${verdict.reasoning}`)
    console.log(`  to applicant: ${verdict.applicant_message}`)
  } catch (error) {
    failed++
    console.log(`\nERROR ${fixture.name}: ${error.message}`)
  }
}

console.log(`\n${files.length - failed}/${files.length} fixtures passed`)
process.exit(failed ? 1 : 0)
