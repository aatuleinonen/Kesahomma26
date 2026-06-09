terraform {
  backend "s3" {
    bucket = "aatuleinonen-tfstate"
    region = "eu-north-1"
    key    = "dev/terraform.tfstate"
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "kesahomma26"
      Environment = var.environment
    }
  }
}
