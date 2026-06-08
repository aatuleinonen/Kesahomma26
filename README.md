# Kesahomma26

This repository is configured as a monorepo containing our application packages and cloud infrastructure definitions.

## Project Management
- **GitHub Project Board**: [Project Board](https://github.com/users/aatuleinonen/projects/1)

---

## Directory Layout

```
.
├── apps/                     # Application source code (workspaces)
│   ├── agents/               # Agent background workers
│   ├── api/                  # API server application
│   └── frontend/             # Frontend web application
├── infrastructure/
│   └── terraform/            # Terraform Infrastructure as Code
│       ├── backend-resources.tf # Resources for remote state
│       ├── main.tf           # Root baseline main module
│       ├── outputs.tf        # Outputs
│       ├── providers.tf      # AWS provider configurations
│       ├── variables.tf      # Configuration variables
│       ├── versions.tf       # Terraform version constraints
│       ├── .terraformignore  # Files to ignore during packaging
│       └── .tflint.hcl       # TFLint configuration
├── docs/                     # Documentation & Architecture Decision Records (ADRs)
├── .editorconfig             # Editor hygiene rules
├── .gitattributes            # Line ending normalizations
├── .gitignore                # Git ignore patterns
├── .pre-commit-config.yaml   # Pre-commit hook definitions
└── package.json              # Monorepo workspace configuration
```

---

## Hygiene and Security Rules

> [!WARNING]
> **Strict Secret & State Rules:**
> - **Do not commit state files (`.tfstate`)** to the repository. They contain the details of your deployed infrastructure and potentially sensitive data.
> - **Do not commit secret variable files (`*.tfvars` or `*.tfvars.json`)**.
> - **Do not commit local provider credentials/tokens**. Use IAM roles, AWS profiles, or secure environment variables.

---

## Local Development Workflow

### 1. Prerequisites
Ensure you have the following installed locally:
- **Node.js** (>= 18) and **npm**
- **Terraform** (>= 1.5.0)
- **AWS CLI** (configured with appropriate credentials)
- **TFLint** (optional, for Terraform linting)
- **pre-commit** (optional, for git hooks)

---

### 2. Application Development (Monorepo Workspaces)

The codebase is structured as an npm workspaces monorepo.

#### **A. Installation**
From the root of the project, run the following command to bootstrap and link all workspace packages:
```bash
npm install
```

#### **B. Global Script Commands**
You can run build, test, and lint commands across all packages simultaneously using the npm workspace runner scripts defined at the root:

*   **Build all applications:**
    ```bash
    npm run build
    ```
*   **Test all applications:**
    ```bash
    npm run test
    ```
*   **Lint all applications:**
    ```bash
    npm run lint
    ```

---

### 3. Infrastructure Management (Terraform)

All infrastructure actions must be run inside the `infrastructure/terraform/` directory:

#### **A. Re-Initialize Directory**
Navigate to the Terraform folder and initialize providers and module dependencies:
```bash
cd infrastructure/terraform
terraform init
```

#### **B. Verification**
Validate the formatting and syntax logic of your configurations:
```bash
# Verify file formatting
terraform fmt -check

# Validate configuration logic
terraform validate
```

#### **C. Planning & Deploying**
Generate an execution plan and apply the plan to provision resources:
```bash
# Generate plan output
terraform plan -out=tfplan

# Apply the plan
terraform apply tfplan
```
