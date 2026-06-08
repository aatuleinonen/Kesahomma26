# This is the root main.tf file for the Terraform baseline.
# Account-level resources or baseline configuration will be defined here.

data "aws_caller_identity" "current" {}

module "aws_infra_pipeline" {
  source = "git::https://github.com/Nets-Platform-Enablement/tf-module-aws-infra-pipeline.git?ref=v2.2.6"

  environment          = "dev"
  branch_name          = "main"
  github_repository_id = "aatuleinonen/kesahomma26"
  variables_file       = "dev.tfvars"
  tfbackend_file       = "dev.s3.tfbackend"

  enable_checkov       = true
  require_checkov_pass = false
  logs_retention_time  = 7
  emails               = ["placeholder@example.com"]
}
