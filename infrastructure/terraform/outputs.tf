output "aws_account_id" {
  value       = data.aws_caller_identity.current.account_id
  description = "The AWS Account ID where resources are deployed."
}

output "terraform_state_bucket_name" {
  value       = aws_s3_bucket.terraform_state.id
  description = "The name of the S3 bucket used for Terraform remote state storage."
}

output "dynamodb_table_name" {
  value       = aws_dynamodb_table.single_table.name
  description = "The name of the DynamoDB Single-Table."
}

output "dynamodb_table_arn" {
  value       = aws_dynamodb_table.single_table.arn
  description = "The ARN of the DynamoDB Single-Table."
}

output "kesahomma26_data_table_name" {
  value       = aws_dynamodb_table.kesahomma26_data.name
  description = "The name of the kesahomma26-data DynamoDB table."
}

output "kesahomma26_data_table_arn" {
  value       = aws_dynamodb_table.kesahomma26_data.arn
  description = "The ARN of the kesahomma26-data DynamoDB table."
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

output "aws_region" {
  value       = var.aws_region
  description = "The AWS region hosting the POC application."
}

output "poc_url" {
  value       = "https://${aws_cloudfront_distribution.poc.domain_name}"
  description = "The HTTPS URL for invited POC testers."
}

output "api_lambda_function_name" {
  value       = aws_lambda_function.api.function_name
  description = "The Lambda function updated by the POC deployment script."
}

output "frontend_bucket_name" {
  value       = aws_s3_bucket.frontend.id
  description = "The private S3 bucket containing built frontend assets."
}

output "cloudfront_distribution_id" {
  value       = aws_cloudfront_distribution.poc.id
  description = "The CloudFront distribution invalidated after frontend deployments."
}

output "api_gateway_endpoint" {
  value       = aws_apigatewayv2_api.poc.api_endpoint
  description = "The direct API Gateway endpoint used as the CloudFront API origin."
}
