resource "aws_cognito_user_pool" "user_pool" {
  name = "kesahomma26-user-pool-${var.environment}"

  # Allow user sign-in/sign-up via email
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length    = 8
    require_lowercase = true
    require_numbers   = true
    require_symbols   = true
    require_uppercase = true
  }

  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
  }

  schema {
    attribute_data_type      = "String"
    developer_only_attribute = false
    mutable                  = true
    name                     = "email"
    required                 = true

    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }
}

resource "aws_cognito_user_pool_client" "user_pool_client" {
  name         = "kesahomma26-user-pool-client-${var.environment}"
  user_pool_id = aws_cognito_user_pool.user_pool.id

  generate_secret     = false
  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_SRP_AUTH"
  ]
}

resource "aws_ssm_parameter" "cognito_user_pool_id" {
  name  = "/kesahomma26/${var.environment}/cognito_user_pool_id"
  type  = "String"
  value = aws_cognito_user_pool.user_pool.id
}

resource "aws_ssm_parameter" "cognito_user_pool_client_id" {
  name  = "/kesahomma26/${var.environment}/cognito_user_pool_client_id"
  type  = "String"
  value = aws_cognito_user_pool_client.user_pool_client.id
}
