# Resolves Terraform outputs and invokes the shared cross-platform POC deployer.
[CmdletBinding()]
param(
  [string]$TerraformDirectory = (Join-Path $PSScriptRoot "..\infrastructure\terraform")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Assert-LastCommand {
  param([string]$Description)
  if ($LASTEXITCODE -ne 0) {
    throw "$Description failed with exit code $LASTEXITCODE."
  }
}

function Get-TerraformOutput {
  param([string]$Name)
  $value = & terraform "-chdir=$script:TerraformRoot" output -raw $Name
  Assert-LastCommand "Reading Terraform output '$Name'"
  return $value.Trim()
}

$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$TerraformRoot = (Resolve-Path $TerraformDirectory).Path
$arguments = @(
  "scripts/deploy-poc.mjs",
  "--region", (Get-TerraformOutput "aws_region"),
  "--lambda-function", (Get-TerraformOutput "api_lambda_function_name"),
  "--frontend-bucket", (Get-TerraformOutput "frontend_bucket_name"),
  "--distribution-id", (Get-TerraformOutput "cloudfront_distribution_id"),
  "--user-pool-id", (Get-TerraformOutput "cognito_user_pool_id"),
  "--user-pool-client-id", (Get-TerraformOutput "cognito_user_pool_client_id"),
  "--poc-url", (Get-TerraformOutput "poc_url")
)

Push-Location $RepositoryRoot
try {
  & node @arguments
  Assert-LastCommand "Deploying POC application artifacts"
}
finally {
  Pop-Location
}
