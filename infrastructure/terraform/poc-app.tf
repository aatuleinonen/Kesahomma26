# Deploys the single-environment serverless application used by invited POC testers.

locals {
  resource_prefix = "kesahomma26-${var.environment}"
  application_source_files = sort(concat(
    [
      for file in fileset("${path.root}/../../apps", "**") :
      "${path.root}/../../apps/${file}"
      if !startswith(file, "frontend/dist/") && !startswith(basename(file), ".env")
    ],
    [
      "${path.root}/../../package-lock.json",
      "${path.root}/../../package.json",
      "${path.root}/../../scripts/deploy-poc.mjs"
    ]
  ))
  application_source_hash = sha256(join("", [
    for file in local.application_source_files : filesha256(file)
  ]))
}

data "archive_file" "api_placeholder" {
  type        = "zip"
  source_file = "${path.module}/lambda-placeholder.js"
  output_path = "${path.module}/.terraform/${local.resource_prefix}-api-placeholder.zip"
}

resource "aws_iam_role" "api_lambda" {
  name = "${local.resource_prefix}-api-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy" "api_lambda" {
  name = "${local.resource_prefix}-api-runtime"
  role = aws_iam_role.api_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "WriteFunctionLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "${aws_cloudwatch_log_group.api_lambda.arn}:*"
      },
      {
        Sid    = "AccessPortfolioTable"
        Effect = "Allow"
        Action = [
          "dynamodb:BatchWriteItem",
          "dynamodb:DeleteItem",
          "dynamodb:PutItem",
          "dynamodb:Query",
          "dynamodb:UpdateItem"
        ]
        Resource = [
          aws_dynamodb_table.single_table.arn,
          "${aws_dynamodb_table.single_table.arn}/index/*"
        ]
      },
      {
        Sid    = "WriteXRayTelemetry"
        Effect = "Allow"
        Action = [
          "xray:PutTelemetryRecords",
          "xray:PutTraceSegments"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_cloudwatch_log_group" "api_lambda" {
  name              = "/aws/lambda/${local.resource_prefix}-api"
  retention_in_days = 7
}

resource "aws_lambda_function" "api" {
  function_name                  = "${local.resource_prefix}-api"
  description                    = "Portfolio POC API"
  role                           = aws_iam_role.api_lambda.arn
  handler                        = "index.handler"
  runtime                        = "nodejs20.x"
  architectures                  = ["arm64"]
  memory_size                    = 256
  timeout                        = 15
  reserved_concurrent_executions = 5

  filename         = data.archive_file.api_placeholder.output_path
  source_code_hash = data.archive_file.api_placeholder.output_base64sha256

  environment {
    variables = {
      COGNITO_CLIENT_ID    = aws_cognito_user_pool_client.user_pool_client.id
      COGNITO_USER_POOL_ID = aws_cognito_user_pool.user_pool.id
      DYNAMODB_TABLE_NAME  = aws_dynamodb_table.single_table.name
      ENABLE_AI_ANALYSIS   = "false"
      NODE_ENV             = "production"
    }
  }

  tracing_config {
    mode = "Active"
  }

  lifecycle {
    ignore_changes = [
      filename,
      source_code_hash
    ]
  }

  depends_on = [
    aws_cloudwatch_log_group.api_lambda,
    aws_iam_role_policy.api_lambda
  ]
}

resource "aws_apigatewayv2_api" "poc" {
  name          = "${local.resource_prefix}-http-api"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "api_lambda" {
  api_id                 = aws_apigatewayv2_api.poc.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
  timeout_milliseconds   = 15000
}

resource "aws_apigatewayv2_route" "api_proxy" {
  api_id    = aws_apigatewayv2_api.poc.id
  route_key = "ANY /{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.api_lambda.id}"
}

resource "aws_cloudwatch_log_group" "api_gateway" {
  name              = "/aws/apigateway/${local.resource_prefix}-http-api"
  retention_in_days = 7
}

resource "aws_apigatewayv2_stage" "poc" {
  api_id      = aws_apigatewayv2_api.poc.id
  name        = "$default"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_gateway.arn
    format = jsonencode({
      requestId        = "$context.requestId"
      routeKey         = "$context.routeKey"
      status           = "$context.status"
      responseLength   = "$context.responseLength"
      integrationError = "$context.integrationErrorMessage"
    })
  }
}

resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowApiGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.poc.execution_arn}/*/*"
}

resource "aws_s3_bucket" "frontend" {
  bucket = "${local.resource_prefix}-frontend-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_ownership_controls" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${local.resource_prefix}-frontend"
  description                       = "Restricts the POC frontend bucket to CloudFront"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

data "aws_cloudfront_response_headers_policy" "security_headers" {
  name = "Managed-SecurityHeadersPolicy"
}

resource "aws_cloudfront_function" "spa_rewrite" {
  name    = "${local.resource_prefix}-spa-rewrite"
  runtime = "cloudfront-js-2.0"
  comment = "Route frontend navigation requests to index.html"
  publish = true
  code    = <<-JAVASCRIPT
    function handler(event) {
      var request = event.request;
      if (!request.uri.includes('.')) {
        request.uri = '/index.html';
      }
      return request;
    }
  JAVASCRIPT
}

resource "aws_cloudfront_distribution" "poc" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  price_class         = "PriceClass_100"
  comment             = "Kesahomma26 invited-user POC"

  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = "frontend-s3"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  origin {
    domain_name = replace(aws_apigatewayv2_api.poc.api_endpoint, "https://", "")
    origin_id   = "portfolio-api"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id           = "frontend-s3"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD", "OPTIONS"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security_headers.id
    compress                   = true

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_rewrite.arn
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/api/*"
    target_origin_id           = "portfolio-api"
    viewer_protocol_policy     = "https-only"
    allowed_methods            = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods             = ["GET", "HEAD", "OPTIONS"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security_headers.id
    compress                   = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowCloudFrontRead"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.frontend.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.poc.arn
          }
        }
      },
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.frontend.arn,
          "${aws_s3_bucket.frontend.arn}/*"
        ]
        Condition = {
          Bool = {
            "aws:SecureTransport" = "false"
          }
        }
      }
    ]
  })
}

# The pipeline module only applies Terraform, so this resource deploys application
# artifacts after infrastructure succeeds and whenever tracked application inputs change.
resource "terraform_data" "application_deployment" {
  triggers_replace = [
    local.application_source_hash,
    aws_lambda_function.api.arn,
    aws_s3_bucket.frontend.id,
    aws_cloudfront_distribution.poc.id
  ]

  provisioner "local-exec" {
    working_dir = "${path.root}/../.."
    command = join(" ", [
      "npm ci && npx --no-install node scripts/deploy-poc.mjs",
      "--region ${var.aws_region}",
      "--lambda-function ${aws_lambda_function.api.function_name}",
      "--frontend-bucket ${aws_s3_bucket.frontend.id}",
      "--distribution-id ${aws_cloudfront_distribution.poc.id}",
      "--user-pool-id ${aws_cognito_user_pool.user_pool.id}",
      "--user-pool-client-id ${aws_cognito_user_pool_client.user_pool_client.id}",
      "--poc-url https://${aws_cloudfront_distribution.poc.domain_name}"
    ])
  }

  depends_on = [
    aws_lambda_permission.api_gateway,
    aws_s3_bucket_policy.frontend
  ]
}
