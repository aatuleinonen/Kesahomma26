output "aws_account_id" {
  value       = data.aws_caller_identity.current.account_id
  description = "The AWS Account ID where resources are deployed."
}

output "terraform_state_bucket_name" {
  value       = aws_s3_bucket.terraform_state.id
  description = "The name of the S3 bucket used for Terraform remote state storage."
}

output "cognito_user_pool_id" {
  value       = aws_cognito_user_pool.user_pool.id
  description = "The ID of the Cognito User Pool."
}

output "cognito_user_pool_client_id" {
  value       = aws_cognito_user_pool_client.user_pool_client.id
  description = "The ID of the Cognito User Pool Client."
}

output "cognito_user_pool_endpoint" {
  value       = aws_cognito_user_pool.user_pool.endpoint
  description = "The endpoint of the Cognito User Pool."
}

output "dynamodb_table_name" {
  value       = aws_dynamodb_table.single_table.name
  description = "The name of the DynamoDB Single-Table."
}

output "dynamodb_table_arn" {
  value       = aws_dynamodb_table.single_table.arn
  description = "The ARN of the DynamoDB Single-Table."
}
