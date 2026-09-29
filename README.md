# Karunodaya MIS

React/TypeScript frontend and Fastify/TypeScript API for Udyam Digital Literacy, Sambodhi, Literacy and Library (LLP), and Sapno ki Udaan. The architecture, access-pattern matrix, keys, example items, and unresolved workbook meanings are in [docs/access-patterns-and-plan.md](docs/access-patterns-and-plan.md). Future coding agents should start with [AGENTS.md](AGENTS.md).

## Current scope

The app has program dashboards, source activity entry, school/centre/staff directory, student registry and dated status history, task board, period filters, monthly charts, aggregate CSV/PDF exports, Admin approval and event restore, audit writes, Cognito JWT verification, and private S3 upload metadata and signed URLs. General exports contain aggregate numbers only. Attendance, unique participants, current enrollment, and completed activities have separate definitions in `shared/report.ts`.

**Workbook migration is awaiting the four workbooks.** They were not present in the workspace when this version was built. No source fields, formula behavior, crosswalk, or totals have been verified against them. Run the dry-run inventory below once supplied; the script deliberately prevents import until its classifications and identity crosswalk are reviewed. Do not use the synthetic seed as program data.

## Run locally

### Quick start with Docker Compose

Install Docker with Compose support. From the repository root, run:

```bash
docker compose up --build -d
```

Open **http://localhost:5173/**. The API is at `http://localhost:3000/healthz`; DynamoDB Local listens on port `8000`. Compose waits for DynamoDB Local, seeds synthetic records for all four programs, then starts the API and frontend. The frontend's development mock signs in as `dev_admin`. Google credentials and an AWS account are **not required** for this mode. The default local identity is Admin, so you can open dashboards, records, students, tasks, reports, and the Admin screen.

Useful commands:

```bash
docker compose ps                 # Check the services and completed seed job
docker compose logs -f api web    # Watch API and frontend logs
docker compose exec -T api npm run seed  # Recreate synthetic records
docker compose down               # Stop local services
```

DynamoDB Local runs in memory. Restarting its container clears the records; run the seed again. Source changes in `src/`, `api/`, and `shared/` reload automatically. Rebuild with `docker compose up --build -d` after changing dependencies or a Dockerfile. The web container forwards `/api` to `http://api:3000` inside Compose; the host-facing API remains on port `3000`. If ports `5173`, `3000`, or `8000` are occupied, free them or change their mappings in `docker-compose.yml`. If Docker runs on a remote machine, forward port `5173` to your computer or open the remote machine's address instead of your computer's `localhost`.

The Compose configuration deliberately uses development-only mock authentication (`dev_admin`). It cannot be enabled in the production API. The private S3 file-upload endpoint is unavailable in this local stack because it has no uploads bucket; the dashboard and other local features use DynamoDB Local.

### Run Node processes outside Docker

Install Node 22 and use Docker only for DynamoDB Local. If the full Compose stack is running, stop it with `docker compose down` first to free ports `3000` and `5173`:

```bash
npm ci
docker compose up -d dynamodb
npm run seed
```

Then start the API and frontend in separate terminals:

```bash
# Terminal 1
DEV_MOCK_AUTH=true DYNAMODB_ENDPOINT=http://localhost:8000 npm run dev:api

# Terminal 2
VITE_DEV_MOCK_AUTH=true VITE_DEV_USER_SUB=dev_admin npm run dev
```

Open `http://localhost:5173/`. The Vite development server proxies `/api` to the API on port `3000`. Run `npm test` for authorization and report-calculation tests, and `npm run build` for the production TypeScript/frontend build.

### Test real Cognito/Google login on localhost

Create a Cognito app client configured for authorization code with PKCE. Add **`http://localhost:5173/`** as an exact Cognito callback and sign-out URL. In Google Cloud, set the authorized redirect URI to **`https://<your-cognito-domain>/oauth2/idpresponse`**; localhost is a Cognito callback, not a Google redirect URI. Set `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID`, `VITE_COGNITO_DOMAIN`, and `VITE_APP_URL=http://localhost:5173/` for Vite. Set `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, and `AWS_REGION` for the API, and run both without the mock flags. Use an authorized DynamoDB environment for user access profiles; first-time Google users remain pending until an Admin approves them. The supplied Compose file always enables mock authentication, so use a separate local configuration when testing real login.

Read-only infrastructure syntax validation: `bash scripts/validate-template.sh` (uses the AWS profile and Region above). This checks CloudFormation syntax and parameter structure, not whether your chosen domain, certificate, secret, or quotas exist.

## Workbook inventory and migration review

```bash
npm run migrate:dry-run -- path/to/udyam.xlsx path/to/sambodhi.xlsx path/to/llp.xlsx path/to/sapno.xlsx --out=migration-review
```

`migration-review/reconciliation.json` inventories sheet names, tentative source/calculated classification, headers, formula counts, distinct `Status` and `Drop-Out Status` values, and Digital workbook LLP labels. The command is read-only. `--apply` is intentionally disabled until the actual schema and student/location/staff crosswalk are agreed. Calculated sheets must be reconciled, never imported as source events or used to copy formulas silently.

## AWS infrastructure and deployment

`template.yml` creates private frontend and upload buckets, CloudFront OAC, a CloudFront API behavior with caching disabled and `Authorization` forwarded, a private ALB exposed only as a CloudFront VPC origin, ECS Fargate API, ECR, four on-demand PITR DynamoDB tables, Cognito Google federation, Secrets Manager dynamic reference, IAM, logs, alarms, and outputs. Viewers use HTTPS to CloudFront; CloudFront reaches the ALB over HTTP inside the private VPC origin connection. The ALB has no public endpoint and accepts only CloudFront origin-facing traffic; tasks accept traffic only from the ALB. Tasks use public subnets and public IPs for outbound ECR, CloudWatch, DynamoDB, S3, and Cognito JWKS access. This avoids NAT gateways and many VPC endpoints; task security groups do not permit internet inbound access.

**No deployment has been performed for this refactor.** The script defaults to AWS profile `mis`, Region `us-east-1`, account `376015725430`, and a new stack name `karunodaya-mis-v2`, leaving the earlier stack separate. The immediate deployment needs a Google OAuth Web client ID, a pre-existing Secrets Manager ARN containing the Google client secret as its plain SecretString, and an available Cognito domain prefix. A custom domain is optional later. If you add a frontend custom domain, supply its name and an issued **us-east-1** ACM certificate, then point that domain at CloudFront.

1. In Google Cloud, use an OAuth **Web application** client and configure the consent screen. For the recommended Cognito prefix `karunodaya-mis-v2-376015725430`, add this exact Google **Authorized redirect URI**: `https://karunodaya-mis-v2-376015725430.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`. Add the Cognito domain as an Authorized JavaScript origin if Google requests one. If the consent screen is in Testing, add the intended sign-in accounts as test users. The CloudFront URL and `http://localhost:5173/` are Cognito app-client callback URLs, not Google redirect URIs.
2. Store the Google OAuth client secret in AWS Secrets Manager in **us-east-1**. From this repository, run `bash scripts/store-google-secret.sh` in an interactive terminal; it prompts for the secret without echoing it, creates or updates `karunodaya/mis/google-oauth` under AWS profile `mis`, and prints its ARN. Alternatively, in the Secrets Manager console choose **Store a new secret → Other type of secret → Plaintext**, paste only the client secret value, use the same name, and copy its ARN. Do not send the secret value in chat or put it in Git, CloudFormation parameters, shell history, Docker images, or frontend variables.
3. Export deployment inputs and bootstrap the stack. This creates the repository and empty frontend origin first; the API service is conditional until its image exists.

   ```bash
   export DEPLOY_AWS_PROFILE=mis DEPLOY_AWS_REGION=us-east-1 DEPLOY_EXPECTED_ACCOUNT=376015725430
   export GOOGLE_CLIENT_ID=YOUR_GOOGLE_WEB_CLIENT_ID GOOGLE_CLIENT_SECRET_ARN=YOUR_SECRET_ARN
   export COGNITO_DOMAIN_PREFIX=karunodaya-mis-v2-376015725430
   ./scripts/deploy.sh bootstrap
   ```

4. Confirm the stack's `GoogleRedirectUri` output matches the Google OAuth client setting. The Cognito app client's callback URLs include the CloudFront URL (or configured frontend domain) and `http://localhost:5173/`. Publish the API and frontend:

   ```bash
   ./scripts/deploy.sh publish
   ```

5. Sign in once as the initial Admin candidate, copy that user's Cognito `sub` from the user pool, and bootstrap a single Admin access profile. Use the `IdentityAccessTableName` and `AuditLogTableName` stack outputs as `ACCESS_TABLE` and `AUDIT_TABLE`. Run `npx tsx scripts/bootstrap-admin.ts` first to review, then `AWS_PROFILE=mis npx tsx scripts/bootstrap-admin.ts --apply`. Subsequent approvals and role/program changes happen in the Admin UI and are audited. Only an AWS operator with direct table write permission can perform the initial bootstrap.

`./scripts/deploy.sh publish` builds a versioned API image, pushes to ECR, updates the Fargate service, builds the frontend with public Cognito identifiers, syncs assets to the private S3 bucket, and invalidates CloudFront. It never receives the Google secret value. The Google secret ARN is a required existing input; no Route 53 zone or ACM certificate is required for the initial CloudFront URL.

## Operations and limits

- Monitor Fargate, ALB, CloudFront traffic, DynamoDB read/write units and PITR, S3 storage/requests, Secrets Manager, and CloudWatch logs. Public-IP tasks avoid NAT charges; an ALB and always-on Fargate service still incur fixed cost.
- DynamoDB PITR and S3 versioning are enabled. Restore to new tables/buckets, validate counts and permissions, then switch application configuration; do not overwrite live records blindly. The Admin screen restores soft-deleted activity events with an audit entry.
- Reports query source events and current enrollment. No summary counters are maintained, so corrections and soft deletion cannot double-count them. Broad date ranges have a 10,000-event safety limit. Backdated student status history is retained; the current enrollment state follows the latest effective date.
- The file API signs private S3 POST/GET requests and stores metadata. S3 enforces a 10 MB upload policy; download checks that the stored size and type match the declaration. File records are pending until the object exists. Add malware scanning and retention policy before accepting untrusted files at scale.
- Dashboard worksheet labels, `Status` versus `Drop-Out Status`, attendance detail versus aggregate totals, and duplicate student/location identities require workbook review. Unique-student counts include only events with stable student IDs; they are not inferred from attendance totals.
