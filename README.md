# Kesahomma26

This repository is configured to manage cloud account infrastructure using Terraform.

## Project Management
- **GitHub Project Board**: [Project Board](https://github.com/users/aatuleinonen/projects/1)

---

## Directory Layout

```
.
├── .editorconfig             # Editor hygiene rules
├── .gitattributes            # Line ending normalizations
├── .gitignore                # Git ignore patterns (ignores local state & secrets)
├── .pre-commit-config.yaml   # Pre-commit hook definitions
├── .terraformignore          # Terraform module packaging ignore list
├── .tflint.hcl               # TFLint rule configuration (AWS ruleset)
├── README.md                 # Project documentation
├── main.tf                   # Root baseline main module
├── outputs.tf                # Standard outputs
├── providers.tf              # Provider configuration (default AWS configuration)
├── variables.tf              # Base variable declarations
└── versions.tf               # Terraform and provider constraint definitions
```

As the project grows, it is designed to scale using:
- **`modules/`**: Reusable infrastructure components (e.g., custom VPC, IAM roles).
- **`environments/<cloud>/<environment>/`**: Specific cloud provider configurations mapped to different stages (e.g., `environments/aws/dev/`, `environments/aws/prod/`).

---

## Hygiene and Security Rules

> [!WARNING]
> **Strict Secret & State Rules:**
> - **Do not commit state files (`.tfstate`)** to the repository. They contain the details of your deployed infrastructure and potentially sensitive data.
> - **Do not commit secret variable files (`*.tfvars` or `*.tfvars.json`)**.
> - **Do not commit local provider credentials/tokens**. Use IAM roles, AWS profiles, or secure environment variables.

---

## Local Workflow

### 1. Prerequisites
Ensure you have the following installed:
- **Terraform** (>= 1.5.0)
- **AWS CLI** (configured with appropriate credentials)
- **TFLint** (optional, for linting)
- **pre-commit** (optional, for automatic formatting/checking hooks)

### 2. Initialization
Run `terraform init` to download required providers and initialize the local working directory:
```bash
terraform init
```

### 3. Verification
Validate the syntax and format of the configuration:
```bash
# Check formatting
terraform fmt -check

# Validate configuration logic
terraform validate
```

### 4. Planning & Applying
Generate a plan and review the resources to be added or changed:
```bash
terraform plan -out=tfplan
terraform apply tfplan
```
