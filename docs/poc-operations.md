# Portfolio POC operations

This runbook covers the single AWS environment used by invited testers. It is
not a production promotion process.

## Architecture and boundaries

The browser connects to one CloudFront HTTPS hostname. CloudFront serves static
assets from a private S3 bucket and forwards `/api/*` to an API Gateway HTTP
API. API Gateway invokes the Express Lambda, which validates Cognito access
tokens and accesses only the PITR-enabled DynamoDB single table.

The POC includes authentication, portfolios, transactions, holdings, cost-basis
calculations, and user-initiated portfolio deletion. AI analysis, scheduling,
notifications, broker access, automatic trading, market prices, and public
signup are disabled.

## Provision and deploy

From a clean checkout, install Node.js 20, Terraform, AWS CLI, and TFLint. Sign
in to the intended AWS account by setting `AWS_PROFILE` or explicit AWS
credential environment variables. The bootstrap intentionally refuses to use
an unselected default profile. Then run:

```powershell
npm install
terraform -chdir=infrastructure/terraform init -backend-config=dev.s3.tfbackend
terraform -chdir=infrastructure/terraform plan -var-file=dev.tfvars -out=poc.tfplan
terraform -chdir=infrastructure/terraform apply poc.tfplan
```

Review the saved plan before applying it. Terraform invokes the shared
deployment runner after the infrastructure succeeds. It bundles and uploads
the API, builds and syncs the frontend, and invalidates CloudFront.

After the first deployment and CodeStar connection activation, the
`aws_infra_pipeline` applies infrastructure and application artifacts from
`main`. Its manual approval remains the release gate. To retry only the
application upload from a prepared local checkout, run:

```powershell
.\scripts\deploy-poc.ps1
```

The final command prints the tester URL. The same URL is available with:

```powershell
terraform -chdir=infrastructure/terraform output -raw poc_url
```

## Invite and remove testers

Public signup is disabled. Create each tester in Cognito:

```powershell
$userPoolId = terraform -chdir=infrastructure/terraform output -raw cognito_user_pool_id
aws cognito-idp admin-create-user --user-pool-id $userPoolId --username tester@example.com --user-attributes Name=email,Value=tester@example.com Name=email_verified,Value=true
```

The tester receives a temporary password and must set a permanent password at
first sign-in. Disable access without deleting portfolio data by disabling the
Cognito user:

```powershell
aws cognito-idp admin-disable-user --user-pool-id $userPoolId --username tester@example.com
```

Users delete individual portfolios from the application. This removes the
portfolio and its transactions from the live table. It does not delete their
Cognito account or immediately remove data from point-in-time recovery.

## Tester notice

Provide this notice before accepting real portfolio data:

- This is an invited test system, not investment advice.
- Values are derived from manually entered transactions and cost basis. They
  are not current market values.
- The system cannot connect to a broker or execute trades.
- Portfolio deletion removes live records. AWS point-in-time recovery may keep
  recoverable copies for up to 35 days.
- Testers should report access, calculation, or deletion problems through the
  repository's issue tracker without including financial data or credentials.

## Smoke test

Record the release commit, URL, tester identity, UTC test time, and result.

1. Invite two test users and complete first sign-in over HTTPS.
2. User A creates a portfolio, deposits cash, records buys and sells, refreshes
   the page, and confirms holdings and cash survive sign-out/sign-in.
3. User B signs in and confirms User A's portfolio is not visible.
4. Submit an invalid transaction and confirm the UI shows a safe error.
5. Delete User A's portfolio and confirm the UI returns to the empty state.
6. Confirm the analysis endpoint returns `FEATURE_DISABLED`.
7. Check Lambda and API Gateway logs contain request IDs and status metadata,
   but no tokens, email addresses, holdings, amounts, or request bodies.

Do not invite additional users until all steps pass and a maintainer owns
support and rollback for the pilot window.

## Restore drill

The application table is the `dynamodb_table_name` Terraform output. Restore
it to a temporary table without changing the live table:

```powershell
$sourceTable = terraform -chdir=infrastructure/terraform output -raw dynamodb_table_name
$restoreTable = "$sourceTable-restore-$(Get-Date -Format yyyyMMddHHmmss)"
aws dynamodb restore-table-to-point-in-time --source-table-name $sourceTable --target-table-name $restoreTable --use-latest-restorable-time
aws dynamodb wait table-exists --table-name $restoreTable
aws dynamodb scan --table-name $restoreTable --select COUNT
```

Record the restored table name, item count, start/end times, and result. After
verification, delete only the named temporary restore table:

```powershell
aws dynamodb delete-table --table-name $restoreTable
```

## Rollback and diagnostics

Application rollback is a rebuild of a known-good commit:

```powershell
git switch --detach <known-good-commit>
.\scripts\deploy-poc.ps1
```

Return to the normal branch after the rollback. Infrastructure changes require
a reviewed Terraform plan; do not use `terraform destroy` for rollback.

Use the `x-request-id` response header to correlate reports with the
`/aws/lambda/kesahomma26-<environment>-api` and
`/aws/apigateway/kesahomma26-<environment>-http-api` log groups. Never ask a
tester to send a JWT, password, or financial payload.
