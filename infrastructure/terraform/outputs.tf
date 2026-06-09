output "aws_account_id" {
  value       = data.aws_caller_identity.current.account_id
  description = "The AWS Account ID where resources are deployed."
}

output "terraform_state_bucket_name" {
  value       = aws_s3_bucket.terraform_state.id
  description = "The name of the S3 bucket used for Terraform remote state storage."
}
