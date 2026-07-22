variable "aws_region" {
  type        = string
  description = "The AWS region to deploy resources in."
  default     = "eu-north-1" # Finland region
}

variable "environment" {
  type        = string
  description = "The environment name (e.g. dev, staging, prod, baseline)."
  default     = "baseline"

  validation {
    condition = (
      length(var.environment) >= 2 &&
      length(var.environment) <= 24 &&
      can(regex("^[a-z0-9][a-z0-9-]*[a-z0-9]$", var.environment))
    )
    error_message = "Environment must be 2-24 lowercase letters, digits, or hyphens and cannot start or end with a hyphen."
  }
}
