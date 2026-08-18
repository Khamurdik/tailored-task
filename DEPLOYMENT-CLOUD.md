# Cloud deployment — AWS and Vercel

Everything about the hosted deployment: what exists, how it was built, and the
decisions taken while building it.

[`DEPLOYMENT.md`](DEPLOYMENT.md) is the sibling of this file and covers **running
the system locally** — prerequisites, configuration, the local stack, and user
provisioning. Nothing in this file is needed to run the project on a laptop.

_Written 2026-08-18, during the session that provisioned it. Where something is
verified, it says how._

---

## 1. The shape of it

| Piece    | Runs on            | Why                                                     |
| -------- | ------------------ | ------------------------------------------------------- |
| Web      | Vercel             | Static build, no server needed                          |
| API      | AWS App Runner     | A container, pinned to **one** instance — see §6         |
| Database | AWS RDS Postgres   | Chosen over Neon by the user — see §4.2                  |
| Blobs    | AWS S3             | Presigned direct-to-browser; the bucket is never public  |

The web app reaches the API through a **same-origin `/api` rewrite** in
`vercel.json`, which mirrors the dev proxy in `apps/web/vite.config.ts`. That is
why `connect-src 'self'` in the CSP covers API calls and why `VITE_API_URL` is
left unset in production.

---

## 2. What exists right now

AWS account **`920766868429`**, region **`us-east-2`**.

| Resource        | Identifier                                                              |
| --------------- | ----------------------------------------------------------------------- |
| Bucket          | `dataroom-prod-920766868429` — public access blocked, CORS + lifecycle   |
| Image           | `920766868429.dkr.ecr.us-east-2.amazonaws.com/dataroom-api:latest`       |
| Instance role   | `dataroom-api-instance` — S3 policy scoped to that bucket, **no keys**   |
| ECR access role | `dataroom-api-ecr-access`                                               |
| Autoscaling     | `dataroom-single` — min 1, max 1                                        |
| Database        | `dataroom-db` — RDS Postgres **18.4**, `db.t4g.micro`, encrypted        |
| Security group  | `dataroom-db` — port 5432 only                                          |
| Parameter group | `dataroom-pg18` — `rds.force_ssl=1`                                     |
| Migrations      | all five applied                                                        |
| Admin user      | `khamurdik@gmail.com`, `is_admin = t`                                   |
| App Runner      | `dataroom-api` — **RUNNING**, `https://8vuzutujwq.us-east-2.awsapprunner.com` |
| Vercel          | **not yet deployed** — see §5                                           |

### Verified against the live deployment, not locally

- a plaintext connection to the database is refused at `pg_hba`
  (`no encryption`); the same connection with `sslmode=require` returns
  `PostgreSQL 18.4`;
- `/health` is `{"status":"ok"}`, `/health/deep` reports `database: up` — so App
  Runner reaches RDS over the public endpoint;
- an unknown route returns the `{"code":"NOT_FOUND"}` envelope, and no response
  carries `Set-Cookie`;
- login works, which exercises the `@node-rs/argon2` native binding in the image;
- **the full upload path against real S3**: presigned PUT (200), `/complete`
  reading the magic bytes back out of the bucket, `content-url`, and a GET that
  returns `%PDF-1.4`. Rollups updated to 1 file / 69 bytes;
- a minted share link resolves anonymously by token and by 16-character short
  code; the shared folder reads 200 and the room above it 404; **visitor
  breadcrumbs name only the shared folder**, not the room;
- after revocation the same token returns a body byte-identical to a guessed one;
- `/jobs` lists six jobs with next run times, as the seeded admin.

**The `x-amz-checksum-crc32` question is answered.** §9 flagged it as the one
visible MinIO-vs-S3 difference — the presigned PUT carries the parameter and
MinIO ignores it. Real S3 accepts it too: the PUT returned 200 and `/complete`
read the correct bytes back. It was a real unknown and it turned out to be a
non-issue.

The **production build** was then served with the `vercel.json` headers verbatim
and its `/api` proxied to the live service, and driven in Chromium: sign-in,
browse, **a PDF uploaded from the browser straight to S3**, and the preview
iframe loading from the bucket origin — with **zero CSP violations**. The one
`net::ERR_ABORTED` logged against the iframe URL is a Chromium artifact, not a
block: the same request also logs a `200 document`, because the response is
handed to the internal PDF viewer.

---

## 3. Identities

Three, each with one job. The running API is **not** one of them — it has no
credentials of its own.

| Identity                  | Kind                                          | For                                  |
| ------------------------- | --------------------------------------------- | ------------------------------------ |
| `dataroom-deploy`         | user, with an access key                      | what a human authenticates as        |
| `dataroom-api-instance`   | role, trusted by `tasks.apprunner.amazonaws.com` | the running API's S3 access       |
| `dataroom-api-ecr-access` | role, trusted by `build.apprunner.amazonaws.com` | letting App Runner pull the image |

**The API holds no long-lived AWS secret.** Leave `AWS_ACCESS_KEY_ID` and
`AWS_SECRET_ACCESS_KEY` unset on the service and the SDK falls back to the
instance role — which `s3-storage.adapter.ts` was written for from the start, its
explicit-keys branch existing for local MinIO. There is therefore no S3
credential to rotate, leak, or commit.

Policy documents, all in [`infra/aws/`](infra/aws/):

| File                                  | Attached to                                |
| ------------------------------------- | ------------------------------------------ |
| `iam-deployer-policy.json`            | `dataroom-deploy` — ECR, App Runner, S3, roles |
| `iam-deployer-rds-policy.json`        | `dataroom-deploy` — RDS and the security group |
| `s3-access-policy.json`               | `dataroom-api-instance`                    |
| `apprunner-instance-role-trust.json`  | trust policy for `dataroom-api-instance`   |
| `apprunner-ecr-access-role-trust.json`| trust policy for `dataroom-api-ecr-access` |
| `s3-cors.json`, `s3-lifecycle.json`   | the bucket                                 |
| `apprunner-service.json`              | template for `aws apprunner create-service` |

Every resource name starts with `dataroom-`, because the deployer's policy is
scoped to `dataroom-*` throughout. A bucket called `myapp-files` or a role called
`AppRunnerECRAccessRole` is denied — that is the scoping working, not a broken
policy.

**The deployer can escalate within its own namespace.** It creates roles, which
means it can write those roles' policies. Constraining that needs a permissions
boundary; for a single-service deployment that is more machinery than it is
worth, but it is a real limit and it is better written down than discovered.

---

## 4. Decisions

### 4.1 Region is `us-east-2`

Not `us-east-1`. It is what the `dataroom` profile was configured for, and it
keeps this deployment clear of unrelated Elastic Beanstalk leftovers that live in
`us-east-1` of the same account.

### 4.2 The database is RDS, not Neon — and it is publicly reachable

**Decided by the user, with the trade-off stated before the choice.**
[`DEPLOYMENT.md`](DEPLOYMENT.md) originally specified Neon; RDS was chosen to keep
everything inside AWS.

The cost is specific and worth naming rather than burying: App Runner has no
static egress addresses without a VPC connector, so an RDS instance it can reach
over the public internet must accept connections from `0.0.0.0/0`. The security
group opens **5432 only**, and three mitigations narrow the exposure without
removing it:

- **`rds.force_ssl=1`**, so a plaintext connection is *refused* rather than
  merely discouraged — verified by attempting one;
- a **32-character generated master password**, and a master username that is not
  `postgres`;
- storage encrypted at rest.

The shape without this problem is RDS in a private subnet behind an App Runner
VPC connector — which then needs a NAT gateway or an S3 VPC endpoint, because
routing egress through the VPC otherwise cuts the API off from its own bucket.
That is the upgrade path if this ever holds real diligence documents.

### 4.3 `iam:PassRole` carries no `iam:PassedToService` condition

It did, naming `tasks.apprunner.amazonaws.com` and
`build.apprunner.amazonaws.com`. App Runner's `CreateService` does not populate
that condition key, so the condition never matched and the statement **denied
instead of guarding** — `CreateService` failed with "no identity-based policy
allows the iam:PassRole action" against a resource the policy plainly listed.

Removed. The statement is still scoped to `role/dataroom-*`; it just no longer
depends on a key that is not there. This is the third setting in this repository
that looked protective and did nothing — see `engineStrict` and
`onlyBuiltDependencies` in [`HANDOFF.md`](HANDOFF.md) §4.

---

## 5. Vercel

`vercel.json` at the repository root carries the build, the `/api` rewrite and
the security headers.

### Project settings

| Field                       | Value                                                           |
| --------------------------- | --------------------------------------------------------------- |
| Root Directory              | **`./`** — the repository root, not `apps/web`                   |
| Framework Preset            | Vite                                                            |
| Build / Install / Output    | leave empty — `vercel.json` supplies all three                   |
| Node.js Version             | `24.x`                                                          |
| Production Branch           | `main`                                                          |

Environment variables:

- `VITE_API_URL` — **leave unset.** Blank means the app uses `/api` and the
  rewrite. Setting it bypasses the rewrite, goes cross-origin, and the CSP blocks
  it.
- `VITE_GOOGLE_CLIENT_ID` — only if Google sign-in is wanted.
- `VITE_API_MODE` — do not set; a production build forces `live` regardless.
- `ALLOW_PLACEHOLDER_DEPLOY=1` — only to publish the UI before the API exists.

### One project, never two

The API does not belong on Vercel. Its scheduler is only correct on a single
long-lived instance (§6) and Vercel Functions are ephemeral and horizontally
scaled; there is also no `server.{js,ts}` entrypoint for Vercel to capture, since
the app's entry is `src/main.ts` calling `app.listen()`.

Importing the repository a second time with a Root Directory of `apps/api` does
not produce an API. It re-runs the root `vercel.json`, which builds the **web**
app, and publishes a second copy of the front end on a second origin — an origin
that is not in `CORS_ORIGINS` and is not where share links point. That happened
on 2026-08-18 and is why the guard below exists.

### The build guard

`buildCommand` starts with `node scripts/check-vercel-config.mjs`, which refuses
the build when:

- **a placeholder remains in `vercel.json`.** `REPLACE-WITH-APP-RUNNER-HOST`
  fails loudly at runtime, but `REPLACE-WITH-BUCKET-HOST` fails *quietly* — the
  page renders and the tree loads, and only the upload PUT and the PDF frame are
  blocked, by a CSP error in a console nobody is watching. The bucket host appears
  **twice** on the CSP line (`connect-src` and `frame-src`), so a find-and-replace
  that stops at the first match leaves one behind. The check counts them.
- **the Root Directory is not the repository root**, because Vercel resolves
  `buildCommand` against it and the script is then simply not found.

`ALLOW_PLACEHOLDER_DEPLOY=1` downgrades the first case to a warning. The second
has no escape hatch, because there is no version of it that is correct.

### Filling the placeholders

```bash
sed -i 's/REPLACE-WITH-APP-RUNNER-HOST/<host>.us-east-2.awsapprunner.com/g' vercel.json
sed -i 's/REPLACE-WITH-BUCKET-HOST/dataroom-prod-920766868429.s3.us-east-2.amazonaws.com/g' vercel.json
node scripts/check-vercel-config.mjs   # must print "no placeholders left — ok"
```

Note the `/g`. Host only — no scheme, no trailing slash.

---

## 6. Constraints

### The API runs on exactly one instance

`minSize: 1`, `maxSize: 1`, which is why `dataroom-single` exists. This is a
correctness choice, not a cost one: on boot every `running` job row is marked
`interrupted`, which is sound only because a booting instance can assume such a
row is its own corpse. With two instances it would corrupt the other's live runs.

An advisory lock does not fix this on this stack — `pg_try_advisory_lock` is
session-scoped, Prisma pools connections, and a pooled Postgres endpoint in
transaction mode does not hold session-level locks at all. Read
[`jobs/TODO.md`](apps/api/src/jobs/TODO.md) §5 before scaling past one instance.

### Health checks

`/health` returns `{"status":"ok"}` and **must never touch the database.** App
Runner polls it roughly every 10 seconds. The database check lives on
`/health/deep`, which nothing polls.

### CORS and credentials

The API sets no cookies and the client sends none, so CORS is uncredentialed and
`CORS_ORIGINS` is an exact-match list. The `SameSite=None` problem a
Vercel-plus-App-Runner split would normally create does not arise.

### A presigned GET cannot be revoked

The 60-second TTL is the entire mitigation. Revoking a share does not kill a URL
already handed out.

### S3 bucket requirements

- **Block Public Access ON.** Every read is presigned; nothing is public.
- CORS allowing `PUT, GET, HEAD` from the web origin and `http://localhost:5173`,
  exposing `ETag`.
- IAM scoped to `s3:PutObject, GetObject, DeleteObject` on `arn:…:bucket/*`.
  There is **no `s3:HeadObject` action** — S3 authorizes a HEAD with
  `s3:GetObject`, so a policy naming `HeadObject` grants nothing and a list
  trimmed to "what `/complete` needs" would drop the one that works.
- Lifecycle rule aborting incomplete multipart uploads after 1 day — the owner of
  one of the four upload failure states.

---

## 7. Runbook

Everything below was run on 2026-08-18 except §7.5, which is blocked on the
`iam:PassRole` fix in §4.3 reaching the deployer's policy.

### 7.1 Credentials

```bash
aws configure --profile dataroom      # keys go in ~/.aws/credentials, never config
export AWS_PROFILE=dataroom AWS_REGION=us-east-2
aws sts get-caller-identity
```

### 7.2 Bucket

```bash
BUCKET=dataroom-prod-920766868429
aws s3api create-bucket --bucket "$BUCKET" --region us-east-2 \
  --create-bucket-configuration LocationConstraint=us-east-2
aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration file://infra/aws/s3-cors.json
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" \
  --lifecycle-configuration file://infra/aws/s3-lifecycle.json
```

### 7.3 Roles

```bash
sed -i "s/REPLACE-WITH-BUCKET-NAME/$BUCKET/" infra/aws/s3-access-policy.json

aws iam create-role --role-name dataroom-api-instance \
  --assume-role-policy-document file://infra/aws/apprunner-instance-role-trust.json
aws iam put-role-policy --role-name dataroom-api-instance \
  --policy-name dataroom-s3 --policy-document file://infra/aws/s3-access-policy.json

aws iam create-role --role-name dataroom-api-ecr-access \
  --assume-role-policy-document file://infra/aws/apprunner-ecr-access-role-trust.json
aws iam attach-role-policy --role-name dataroom-api-ecr-access \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess
```

### 7.4 Image

```bash
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REPO=$ACCOUNT.dkr.ecr.us-east-2.amazonaws.com/dataroom-api
aws ecr create-repository --repository-name dataroom-api
aws ecr get-login-password | docker login --username AWS --password-stdin "$ACCOUNT.dkr.ecr.us-east-2.amazonaws.com"
docker build -f apps/api/Dockerfile -t dataroom-api:local .
docker tag dataroom-api:local "$REPO:latest"
docker push "$REPO:latest"
```

### 7.5 Database

```bash
aws ec2 create-security-group --group-name dataroom-db \
  --description "dataroom Postgres 5432" --vpc-id <default-vpc>
aws ec2 authorize-security-group-ingress --group-id <sg> --protocol tcp --port 5432 --cidr 0.0.0.0/0

aws rds create-db-parameter-group --db-parameter-group-name dataroom-pg18 \
  --db-parameter-group-family postgres18 --description "dataroom: require TLS"
aws rds modify-db-parameter-group --db-parameter-group-name dataroom-pg18 \
  --parameters "ParameterName=rds.force_ssl,ParameterValue=1,ApplyMethod=pending-reboot"

aws rds create-db-instance --db-instance-identifier dataroom-db --db-name dataroom \
  --engine postgres --engine-version 18.4 --db-instance-class db.t4g.micro \
  --allocated-storage 20 --storage-type gp3 --storage-encrypted \
  --master-username dataroom_admin --master-user-password "<generated>" \
  --vpc-security-group-ids <sg> --db-parameter-group-name dataroom-pg18 \
  --publicly-accessible --no-multi-az --backup-retention-period 1
```

Then, **from a workstation** — the image deliberately does neither, and nothing
on the wire creates a user:

```bash
export DATABASE_URL="postgresql://dataroom_admin:<pw>@<endpoint>:5432/dataroom?schema=public&sslmode=require"
pnpm --filter @dataroom/api exec prisma migrate deploy
SEED_USERS='[{"email":"you@corp.com","password":"…","name":"You","admin":true}]' \
  pnpm --filter @dataroom/api db:seed
```

### 7.6 Autoscaling and service

```bash
aws apprunner create-auto-scaling-configuration \
  --auto-scaling-configuration-name dataroom-single --min-size 1 --max-size 1 --max-concurrency 100

aws apprunner create-service --cli-input-json file://<filled-in apprunner-service.json>
```

### 7.7 Preview deployments

Every Vercel preview gets its own origin, so the bucket's CORS carries
`https://tailored-task-*.vercel.app` alongside the production domain. S3 allows
exactly **one** `*` per origin string, and scoping it to this project's prefix is
deliberate — `https://*.vercel.app` would let a page on anybody's Vercel app make
browser requests to the bucket. Small risk, since every operation still needs a
valid presigned signature, but it costs nothing to keep it narrow.

**`CORS_ORIGINS` on the API needs no equivalent, and cannot have one.** It is an
exact-match list, and it does not matter: the browser never calls the API
cross-origin. It calls `/api/...` on the Vercel origin and Vercel rewrites that to
App Runner **server-side**, so there is no preflight and no CORS check at all.
`CORS_ORIGINS` only governs a client calling the API host directly — local
development with `VITE_API_URL` set, or a non-browser client. That is why
previews reach the API without being listed anywhere.

### 7.8 Closing the loop

Both ends need the other's origin, so this comes last:

1. put the App Runner host and the bucket host into `vercel.json` (§5), push;
2. set `CORS_ORIGINS` on the App Runner service to the Vercel domain;
3. add the Vercel domain to the bucket's CORS `AllowedOrigins`.

---

## 8. Secrets

Nothing secret is in the repository. The generated values live only on the
deploying workstation and in App Runner's configuration:

| Value                | Where                                             |
| -------------------- | ------------------------------------------------- |
| RDS master password  | scratchpad `rds-password.txt`, mode `0600`        |
| Production `DATABASE_URL` | scratchpad `prod-database-url.txt`           |
| JWT access + refresh secrets | scratchpad `jwt-secrets.txt`              |
| App admin password   | scratchpad `app-admin-password.txt`               |

`.gitignore` already excludes `.env` and `.env.*`; `infra/aws/*.json` contains
only resource names and ARNs.

---

## 9. Not done yet

- **The App Runner service is not created** — blocked on §4.3.
- **Vercel is not deployed**, and `vercel.json` still holds both placeholders.
- **`CORS_ORIGINS` is unset** on the API and the bucket's CORS allows only
  `http://localhost:5173`. Both need the Vercel domain (§7.7).
- **The S3 adapter has still never talked to real S3** in this deployment — the
  local runs were against MinIO. One difference is already visible: the presigned
  PUT carries an `x-amz-checksum-crc32` parameter that MinIO ignores and S3 may
  not. The first real upload is the test.

---

## 10. Teardown

In this order — App Runner holds the roles, and the bucket must be empty:

```bash
aws apprunner delete-service --service-arn <arn>
aws rds delete-db-instance --db-instance-identifier dataroom-db --skip-final-snapshot
aws s3 rm s3://dataroom-prod-920766868429 --recursive
aws s3api delete-bucket --bucket dataroom-prod-920766868429
aws ecr delete-repository --repository-name dataroom-api --force
aws iam delete-role-policy --role-name dataroom-api-instance --policy-name dataroom-s3
aws iam delete-role --role-name dataroom-api-instance
aws iam detach-role-policy --role-name dataroom-api-ecr-access \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess
aws iam delete-role --role-name dataroom-api-ecr-access
aws ec2 delete-security-group --group-id <sg>
aws rds delete-db-parameter-group --db-parameter-group-name dataroom-pg18
```
