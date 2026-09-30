# Agent handoff: Karunodaya MIS

Read this file before changing the project. It is a short navigation and safety guide; [README.md](README.md) has operator instructions, and [docs/access-patterns-and-plan.md](docs/access-patterns-and-plan.md) has the access-pattern matrix, DynamoDB keys, examples, and workbook ambiguities. Check the code and current AWS state before treating a status note as current.

## Project and code map

- Four programs: Udyam Digital Literacy (`udyam`), Sambodhi (`sambodhi`), Literacy and Library (`llp`), and Sapno ki Udaan / Adolescent Girls (`sapno`).
- React, TypeScript, and Vite frontend: `src/`; shared schemas and report calculations: `shared/`.
- Foundation branding: `karunodaya_mis.jpeg` is imported by the shared logo in `src/App.tsx`; `src/style.css` styles login and shared controls, and `src/dashboard.css` styles the responsive workspace.
- Fastify/TypeScript API: `api/src/`, divided into program activities, students, reporting, tasks, files, and identity. Authentication and authorization belong in the API, not only in frontend controls.
- DynamoDB Local seed and workbook inventory: `scripts/seed.ts` and `scripts/migrate-workbooks.ts`. AWS infrastructure and deployment: `template.yml`, `scripts/deploy.sh`, `scripts/store-google-secret.sh`, and `scripts/validate-template.sh`.
- The four real Excel workbooks were absent when the current implementation was written. The seed contains synthetic records. Do not treat generated records or calculated spreadsheet sheets as source data; review workbook field meanings and reconciliation output before enabling migration.

## Local run and checks

From the repository root:

```bash
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 api web
```

Open `http://localhost:5173/`; API health is `http://localhost:3000/healthz`. Compose uses in-memory DynamoDB Local on port `8000`, runs the synthetic seed, and enables development-only mock identity `dev_admin`. The mock is rejected when `NODE_ENV=production`. Local file upload needs an S3 bucket and is not configured by Compose. Run `npm test`, `npm run build`, and `docker compose config --quiet` after relevant changes. Use `bash scripts/validate-template.sh` to validate CloudFormation through AWS; it does not deploy.

## Data and access rules

- Keep source events and student status history; derive dashboard counts and exports from those records. Attendance totals, unique student IDs, current enrollment, and completed activities are distinct measures. Edits, backdated entries, and soft deletion must not double-count reports.
- Keep stable generated IDs for students, staff, locations, and events. Names and workbook row numbers are not primary identities.
- Pending approvals resolve requester email/name from Cognito by stable subject through the Admin-only API; the API task role has `cognito-idp:ListUsers` only for its user pool. Login and Sign up both use Google, with new users pending Admin approval.
- Enforce each user's approved role, assigned programs, and record scope on every protected API operation and export. New Google identities have no app permissions until Admin approval. General reports must not disclose individual student information.
- Keep uploads private in S3 and only metadata in DynamoDB. Avoid logging student data or credentials. Audit role changes and restores.
- Preserve the distinction between student `Status` and `Drop-Out Status` during workbook review. Verify the Digital workbook's LLP dashboard labels before mapping fields or program ownership. See the ambiguity table in `docs/access-patterns-and-plan.md`.

## AWS handoff

On 2026-09-30, the Foundation logo and simplified navy/gold frontend were published to the existing `karunodaya-mis-v2` frontend bucket using profile `mis` in `ap-south-1`, account `376015725430`. Stack status was verified `UPDATE_COMPLETE`; the API image and infrastructure were not updated. CloudFront invalidation `IED2M5IQKSMRS0UCZT93ZO774G` completed. Live HTML, JavaScript, CSS, and logo returned HTTP 200 and matched the built assets; unauthenticated `/api/me` returned HTTP 401.

On 2026-09-29, `karunodaya-mis-v2` was deployed with profile `mis` in `ap-south-1`, account `376015725430`, and verified `UPDATE_COMPLETE`. App: https://d3s751o9n6klig.cloudfront.net/. Google secret `karunodaya/mis/google-oauth` is populated. Frontend HTTP 200, API unauthenticated HTTP 401, and Cognito-to-Google redirect were verified; the first Google user subsequently signed in and was approved as Admin for all four programs on 2026-09-29, with an atomic audit record and verified access profile. Deployment, secret-storage, and validation scripts now default to `ap-south-1`.

On 2026-09-29, the old `karunodaya-mis` stack was verified `DELETE_COMPLETE` in account `376015725430`, Region `us-east-1`, with no active stacks remaining in that Region. The stack's ECR repository and images were removed. Cognito pool `us-east-1_PeMqdyEK0` remains under the old template's retention policy; its app client, domain, and groups were deleted. Independently managed secrets were not changed.

Check AWS before making a new deployment claim. `scripts/deploy.sh` uses profile `mis`, Region `ap-south-1`, and expected account `376015725430` by default; verify those inputs and follow the user's existing deployment authorization and preferences before changing AWS resources. The deploy order and required variables are in the README.

The Google OAuth **client ID** is a public deployment input. The **client secret** must be entered privately into AWS Secrets Manager; `scripts/store-google-secret.sh` prompts without echoing it and prints an ARN. Supply that ARN to CloudFormation, never the secret value. Do not paste a secret into chat, commits, `.env`, frontend variables, Docker images, or template parameters. `.gitignore` and `.dockerignore` cover common local credential filenames, but inspect `git status` before committing. A Cognito callback URL and Google's `/oauth2/idpresponse` redirect URI are different; the README lists both.

## Change discipline

Work in small, reviewable changes. Read `git status` first because the workspace may contain user or previous-agent changes. Do not reset, delete, or overwrite them. Update README and this handoff if commands, architecture, deployment state, or unresolved workbook questions change. Report what was changed, tested, and still needs external inputs.
