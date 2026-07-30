terraform {
  backend "s3" {
    bucket = "aatuleinonen-tfstate"
    region = "eu-north-1"
    key    = "dev/terraform.tfstate"
  }
}

provider "aws" {
  region              = var.aws_region
  allowed_account_ids = ["405852846204"]

  default_tags {
    tags = {
      Project     = "kesahomma26"
      Environment = var.environment
    }
  }
}
