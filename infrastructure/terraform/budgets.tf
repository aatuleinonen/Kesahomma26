# AWS Budget configuration to prevent unexpected costs.
# This budget triggers an alarm when actual or forecasted monthly costs exceed 80% of $10.00 USD.

resource "aws_budgets_budget" "monthly_cost" {
  name              = "monthly-cost-budget"
  budget_type       = "COST"
  limit_amount      = "10.0"
  limit_unit        = "USD"
  time_period_start = "2026-06-01_00:00"
  time_unit         = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = ["placeholder@example.com"]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = ["placeholder@example.com"]
  }
}
