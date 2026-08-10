# PowerShell script to authenticate with AWS MFA and export session credentials to environment variables.
# Usage:
#   . .\scripts\aws-mfa.ps1
#   . .\scripts\aws-mfa.ps1 -MfaCode 123456
# Note: You MUST prefix with dot-space (". ") to export variables into your current PowerShell session.

[CmdletBinding()]
param(
    [string]$MfaCode,
    [string]$Profile = "default",
    [int]$DurationSeconds = 43200 # 12 hours
)

$ErrorActionPreference = "Stop"

# Clear existing session token env vars to ensure clean profile lookup
Remove-Item Env:\AWS_ACCESS_KEY_ID -ErrorAction SilentlyContinue
Remove-Item Env:\AWS_SECRET_ACCESS_KEY -ErrorAction SilentlyContinue
Remove-Item Env:\AWS_SESSION_TOKEN -ErrorAction SilentlyContinue

Write-Host "Detecting MFA device for profile '$Profile'..." -ForegroundColor Cyan

try {
    $mfaJson = aws iam list-mfa-devices --profile $Profile --output json | ConvertFrom-Json
} catch {
    throw "Failed to list MFA devices. Make sure AWS CLI is installed and profile '$Profile' exists."
}

$totpDevice = $mfaJson.MFADevices | Where-Object { $_.SerialNumber -like "*:mfa/*" } | Select-Object -First 1

if (-not $totpDevice) {
    throw "No virtual MFA device (TOTP) found for profile '$Profile'."
}

$mfaSerial = $totpDevice.SerialNumber
Write-Host "Found MFA device: $mfaSerial" -ForegroundColor Gray

if (-not $MfaCode) {
    $MfaCode = Read-Host "Enter 6-digit MFA code"
}

if ([string]::IsNullOrWhiteSpace($MfaCode)) {
    throw "MFA code cannot be empty."
}

Write-Host "Requesting AWS session token..." -ForegroundColor Cyan

$tokenJson = aws sts get-session-token --profile $Profile --serial-number $mfaSerial --token-code $MfaCode --duration-seconds $DurationSeconds --output json

if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($tokenJson)) {
    throw "Failed to authenticate with AWS STS. Check your MFA code."
}

$creds = ($tokenJson | ConvertFrom-Json).Credentials

$env:AWS_ACCESS_KEY_ID = $creds.AccessKeyId
$env:AWS_SECRET_ACCESS_KEY = $creds.SecretAccessKey
$env:AWS_SESSION_TOKEN = $creds.SessionToken

Write-Host "`nSuccessfully authenticated!" -ForegroundColor Green
Write-Host "Session credentials exported to environment variables." -ForegroundColor Green
Write-Host "Expires at: $($creds.Expiration)" -ForegroundColor Yellow
