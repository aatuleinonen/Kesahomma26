# ADR 0001: MVP Tech Stack and Architecture

## Status
Accepted

## Context
We need to define the foundational technology stack and architecture for the Kesahomma26 MVP. The goals are to build a cost-effective, scalable, and fully automated serverless application while minimizing operational overhead and maintaining high security.

## Decision
We will use the following technologies for the MVP:

*   **Infrastructure as Code (IaC):** [Terraform](https://www.terraform.io/) to manage all cloud resources in a repeatable and version-controlled manner.
*   **Frontend Hosting:** AWS S3 for hosting static frontend assets, combined with **Amazon CloudFront** as the Content Delivery Network (CDN) for fast, secure HTTPS delivery.
*   **Authentication & User Management:** **Amazon Cognito** to handle user sign-up, sign-in, and access control securely without managing user databases.
*   **API Layer:** **Amazon API Gateway** to route HTTP requests to backend services.
*   **Compute:** **AWS Lambda** for running serverless, event-driven backend business logic.
*   **Database:** **Amazon DynamoDB** for a fully managed, low-cost NoSQL database that scales seamlessly.
*   **Message Queue:** **Amazon SQS** (Simple Queue Service) to manage the background Agent task queue asynchronously.
*   **Scheduled Jobs:** **Amazon EventBridge** to trigger scheduled tasks and cron-like jobs.
*   **Artificial Intelligence (AI):** **Amazon Bedrock** to access foundation AI models securely.
*   **Secrets & Configuration Management:** **AWS Systems Manager (SSM) Parameter Store** to store secrets and configurations (using SecureString where applicable) to avoid the higher cost of AWS Secrets Manager.
*   **Monitoring & Logging:** **Amazon CloudWatch** for metrics and logs. Log retention periods will be kept short (e.g., 7 to 14 days) to prevent unexpected storage costs.

---

## Out of Scope
To keep implementation complexity and monthly costs low for the MVP, the following are explicitly excluded from the current scope:
*   **Multi-region deployments:** The application will be deployed in a single region (`eu-north-1`). High availability will be achieved using multi-AZ deployments within this single region.
*   **Amazon RDS:** Relational databases are out of scope. We will rely purely on DynamoDB for structured data storage to avoid the baseline hourly compute costs of RDS instances.
*   **AWS Secrets Manager:** We will use SSM Parameter Store instead of AWS Secrets Manager, as the latter incurs a flat monthly fee per secret, which can accumulate quickly.

---

## Consequences
*   **Cost Efficiency:** Using a serverless architecture (Lambda, API Gateway, DynamoDB, S3/CloudFront) ensures we only pay for what we use, keeping baseline costs close to zero.
*   **SSM Parameter Store Limitations:** SSM Parameter Store does not support automatic secret rotation out of the box like AWS Secrets Manager does. We will manage rotation manually or via custom scripts if required.
*   **NoSQL Modeling:** Relying purely on DynamoDB means we must design our data access patterns carefully up front (single-table design or clean multi-table configurations), as relational joins are not natively supported.
