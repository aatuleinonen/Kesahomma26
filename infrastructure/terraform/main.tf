# This is the root main.tf file for the Terraform baseline.
# Account-level resources or baseline configuration will be defined here.

data "aws_caller_identity" "current" {}

# Bounding logs_retention_time to 7 days fulfills the MVP log retention requirement (Issue #11)
module "aws_infra_pipeline" {
source = "git::https://github.com/Nets-Platform-Enablement/tf-module-aws-infra-pipeline.git?ref=c97f3f5d455ebd30edea9c37116f5c1f370e5f2c"

environment          = "dev"
branch_name          = "main"
github_repository_id = "aatuleinonen/kesahomma26"
variables_file       = "dev.tfvars"
tfbackend_file       = "dev.s3.tfbackend"

enable_checkov       = true
require_checkov_pass = false
logs_retention_time  = 7
emails               = ["aatu.leinonen@gmail.com", "juha.leinonen@gmail.com"]
}
