terraform {
  required_version = ">= 1.5.0"

  # backend "s3" {
  #   bucket       = "kesahomma26-405852846204-terraform-state"
  #   key          = "baseline/terraform.tfstate"
  #   region       = "eu-north-1"
  #   encrypt      = true
  #   use_lockfile = true
  # }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}
