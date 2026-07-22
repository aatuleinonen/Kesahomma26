# @kesahomma26/agents

This workspace contains background workers and logic for executing AI/LLM-powered tasks.

## Security & Operational Model

All services in this workspace must adhere to the **AI Agent Operating Model**. Below is a summary of the three key security constraints:

1. **Read-Only Operations (No Mutations)**
   * Agents operate in a strictly read-only capacity.
   * Agents are prohibited from executing trades, modifying portfolio data, or mutating database state.
   * Enforced via IAM policies restricting database write permissions.

2. **Strict Multi-Tenant Data Isolation**
   * Access to user-owned data must be scoped strictly to the requesting user's `userId`.
   * Cross-tenant querying is blocked at the database client level.

3. **Traceability & Auditing**
   * Every LLM interaction is fully logged (inputs, system prompts, outputs, safety configurations).
   * Logs are stored in Amazon CloudWatch with cost-bound retention rules (7 days) for auditability.

For the complete architectural details and enforcement specifications, refer to [AI Agent Operating Model](../../docs/ai-agent-operating-model.md).
