variable "aws_region" {
  type        = string
  description = "The AWS region to deploy resources in."
  default     = "eu-north-1" # Finland region
}

variable "environment" {
  type        = string
  description = "The environment name (e.g. dev, staging, prod, baseline)."
  default     = "baseline"
}
