# AWS DynamoDB Single-Table Database Schema Design

This document describes the DynamoDB Single-Table schema design for Kesahomma26 (Issue #13). The design enforces **strict tenant isolation** at the database level by partition key design convention, models portfolio accounting entities in a single table, and supports multi-currency transactions, fees, cash movements, and holding-level transaction history.

## Design Principles

1. **Generic Key Names**: The table uses generic names for primary keys:
   - **`PK` (Partition Key)**: String
   - **`SK` (Sort Key)**: String
2. **Explicit Tenant Isolation**: To prevent cross-tenant data access, **every tenant-owned item** in the table uses the User ID (Cognito `sub`) as the prefix or value of the Partition Key (`PK`).
   - `PK` format: `USER#<userId>`
   - Tenant-owned GSI partition keys also start with `USER#<userId>`.
3. **Transactions Are the Source of Truth**: Holdings are current-state snapshots derived from transactions, cash ledger entries, tax lots, and corporate actions. If a holding total is questioned, the transaction history should be able to explain how it was built and managed.
4. **Hierarchical Sorting**: Sort Keys (`SK`) are structured hierarchically using `#` delimiters. This allows efficient range queries and prefix filtering.
5. **Explicit Portfolio Metadata Rows**: Portfolio metadata uses `PORTFOLIO#<portfolioId>#METADATA` instead of only `PORTFOLIO#<portfolioId>` so list/query access patterns do not accidentally mix portfolio metadata with holdings, transactions, and analysis records.
6. **Multi-Currency Accounting**: Transactions, fees, cash movements, and valuations store their original currency and the conversion information needed to report in the portfolio base currency.

---

## Entity Mapping Summary

| Entity Type | Partition Key (`PK`) | Sort Key (`SK`) | Key Attributes |
| :--- | :--- | :--- | :--- |
| **User** | `USER#<userId>` | `METADATA` | `email`, `role`, `createdAt`, `updatedAt` |
| **Portfolio** | `USER#<userId>` | `PORTFOLIO#<portfolioId>#METADATA` | `portfolioId`, `name`, `description`, `baseCurrency`, `costBasisMethod`, `createdAt`, `updatedAt` |
| **Holding** | `USER#<userId>` | `PORTFOLIO#<portfolioId>#HOLDING#<assetId>` | `assetId`, `symbol`, `exchange`, `assetCurrency`, `quantity`, `averageCost`, `totalCostBasisBaseCurrency`, `lastUpdated` |
| **Transaction** | `USER#<userId>` | `PORTFOLIO#<portfolioId>#TRANSACTION#<tradeTimestamp>#<transactionId>` | `assetId`, `symbol`, `type`, `quantity`, `price`, `assetCurrency`, `fees`, `fxRateToBaseCurrency`, `netAmountBaseCurrency` |
| **Tax Lot** | `USER#<userId>` | `PORTFOLIO#<portfolioId>#HOLDING#<assetId>#LOT#<lotId>` | `assetId`, `originalQuantity`, `remainingQuantity`, `acquisitionDate`, `costBasisBaseCurrency` |
| **Cash Balance** | `USER#<userId>` | `PORTFOLIO#<portfolioId>#CASH#<currency>` | `currency`, `balance`, `updatedAt` |
| **Cash Ledger Entry** | `USER#<userId>` | `PORTFOLIO#<portfolioId>#CASH_LEDGER#<timestamp>#<entryId>` | `currency`, `amount`, `type`, `relatedTransactionId`, `balanceAfter` |
| **FX Conversion** | `USER#<userId>` | `PORTFOLIO#<portfolioId>#FX#<timestamp>#<conversionId>` | `fromCurrency`, `toCurrency`, `fromAmount`, `toAmount`, `fxRate`, `fees` |
| **Analysis Job** | `USER#<userId>` | `PORTFOLIO#<portfolioId>#ANALYSIS_JOB#<jobId>` | `status`, `createdAt`, `completedAt`, `error` |
| **Analysis Result** | `USER#<userId>` | `PORTFOLIO#<portfolioId>#ANALYSIS_RESULT#<jobId>` | `metrics`, `recommendations`, `createdAt` |

---

## Global Secondary Indexes

### GSI1: Holding Transaction History

The base table key supports portfolio-wide chronological transaction history. To efficiently answer "how was this holding built and managed?", transactions also project to a holding-specific GSI.

| Index | Partition Key | Sort Key | Used For |
| :--- | :--- | :--- | :--- |
| **GSI1** | `GSI1PK = USER#<userId>#PORTFOLIO#<portfolioId>#HOLDING#<assetId>` | `GSI1SK = TRANSACTION#<tradeTimestamp>#<transactionId>` | Fetch all buy/sell/dividend/corporate-action records for one holding without scanning portfolio transactions |

Only entities that need holding-level lookup require these attributes. Most non-transaction items can omit `GSI1PK` and `GSI1SK`.

---

## Detailed Entity Schemas

### 1. User (`METADATA`)
Stores user-specific settings, account status, and roles.

* **PK**: `USER#<userId>`
* **SK**: `METADATA`
* **Attributes**:
  ```json
  {
    "email": "user@example.com",
    "role": "user",
    "createdAt": "2026-06-10T12:00:00Z",
    "updatedAt": "2026-06-10T12:00:00Z"
  }
  ```

### 2. Portfolio (`PORTFOLIO#<portfolioId>#METADATA`)
Represents a user's investment portfolio containing multiple holdings. `baseCurrency` is the reporting currency used for portfolio-level values and analysis.

* **PK**: `USER#<userId>`
* **SK**: `PORTFOLIO#<portfolioId>#METADATA`
* **Attributes**:
  ```json
  {
    "portfolioId": "portfolio-1",
    "name": "Tech Growth Portfolio",
    "description": "Long term tech stock investments",
    "baseCurrency": "EUR",
    "costBasisMethod": "FIFO",
    "createdAt": "2026-06-10T12:05:00Z",
    "updatedAt": "2026-06-10T12:05:00Z"
  }
  ```

### 3. Holding (`PORTFOLIO#<portfolioId>#HOLDING#<assetId>`)
Represents the current consolidated shares/units of a specific asset. This is a derived snapshot that should be updated from transaction, lot, cash, and corporate-action events.

* **PK**: `USER#<userId>`
* **SK**: `PORTFOLIO#<portfolioId>#HOLDING#<assetId>`
* **Attributes**:
  ```json
  {
    "assetId": "US0378331005",
    "symbol": "AAPL",
    "exchange": "NASDAQ",
    "assetType": "STOCK",
    "assetCurrency": "USD",
    "quantity": 15.5,
    "averageCost": 172.45,
    "averageCostCurrency": "USD",
    "totalCostBasisBaseCurrency": 2450.10,
    "realizedGainLossBaseCurrency": 120.75,
    "lastPrice": 184.55,
    "lastPriceCurrency": "USD",
    "lastFxRateToBaseCurrency": 0.92,
    "lastUpdated": "2026-06-10T12:10:00Z"
  }
  ```

### 4. Transaction (`PORTFOLIO#<portfolioId>#TRANSACTION#<tradeTimestamp>#<transactionId>`)
Historical accounting event. Transactions should include currency and fee details so cost basis, realized gain/loss, and cash balances can be reproduced later.

Supported transaction types include:

- `BUY`
- `SELL`
- `DIVIDEND`
- `TRANSFER_IN`
- `TRANSFER_OUT`
- `SPLIT`
- `MERGER`
- `SPIN_OFF`
- `FEE`
- `TAX`
- `ADJUSTMENT`

* **PK**: `USER#<userId>`
* **SK**: `PORTFOLIO#<portfolioId>#TRANSACTION#<tradeTimestamp>#<transactionId>`
* **GSI1PK**: `USER#<userId>#PORTFOLIO#<portfolioId>#HOLDING#<assetId>`
* **GSI1SK**: `TRANSACTION#<tradeTimestamp>#<transactionId>`
* **Attributes**:
  ```json
  {
    "transactionId": "txn-123",
    "portfolioId": "portfolio-1",
    "assetId": "US0378331005",
    "symbol": "AAPL",
    "exchange": "NASDAQ",
    "type": "BUY",
    "status": "SETTLED",
    "tradeTimestamp": "2026-06-10T12:10:00Z",
    "tradeDate": "2026-06-10",
    "settlementDate": "2026-06-12",
    "quantity": 10,
    "price": 170.50,
    "assetCurrency": "USD",
    "grossAmount": 1705.00,
    "fees": [
      {
        "type": "BROKERAGE",
        "amount": 5.00,
        "currency": "USD"
      },
      {
        "type": "FX_FEE",
        "amount": 2.50,
        "currency": "EUR"
      }
    ],
    "taxes": [],
    "netAmount": 1710.00,
    "netAmountCurrency": "USD",
    "baseCurrency": "EUR",
    "fxRateToBaseCurrency": 0.92,
    "fxRateTimestamp": "2026-06-10T12:10:00Z",
    "fxProvider": "MANUAL",
    "netAmountBaseCurrency": 1573.20,
    "source": "MANUAL",
    "brokerTransactionId": null,
    "notes": null,
    "createdAt": "2026-06-10T12:10:00Z",
    "updatedAt": "2026-06-10T12:10:00Z"
  }
  ```

### 5. Tax Lot (`PORTFOLIO#<portfolioId>#HOLDING#<assetId>#LOT#<lotId>`)
Represents an acquisition lot used to explain remaining quantity and cost basis after partial sells. The portfolio-level `costBasisMethod` controls how sell transactions consume lots.

* **PK**: `USER#<userId>`
* **SK**: `PORTFOLIO#<portfolioId>#HOLDING#<assetId>#LOT#<lotId>`
* **Attributes**:
  ```json
  {
    "lotId": "lot-123",
    "assetId": "US0378331005",
    "symbol": "AAPL",
    "originalQuantity": 10,
    "remainingQuantity": 6,
    "acquisitionDate": "2026-06-10",
    "price": 170.50,
    "assetCurrency": "USD",
    "feesAllocatedBaseCurrency": 4.60,
    "costBasisBaseCurrency": 1573.20,
    "createdFromTransactionId": "txn-123",
    "updatedAt": "2026-06-10T12:10:00Z"
  }
  ```

### 6. Cash Balance (`PORTFOLIO#<portfolioId>#CASH#<currency>`)
Represents the current cash balance for one currency. Cash balances are derived from the cash ledger.

* **PK**: `USER#<userId>`
* **SK**: `PORTFOLIO#<portfolioId>#CASH#<currency>`
* **Attributes**:
  ```json
  {
    "currency": "EUR",
    "balance": 1250.45,
    "updatedAt": "2026-06-10T12:20:00Z"
  }
  ```

### 7. Cash Ledger Entry (`PORTFOLIO#<portfolioId>#CASH_LEDGER#<timestamp>#<entryId>`)
Historical cash movement. This is needed to reconcile deposits, withdrawals, trades, fees, taxes, dividends, and FX conversions.

* **PK**: `USER#<userId>`
* **SK**: `PORTFOLIO#<portfolioId>#CASH_LEDGER#<timestamp>#<entryId>`
* **Attributes**:
  ```json
  {
    "entryId": "cash-123",
    "type": "BUY_SETTLEMENT",
    "currency": "EUR",
    "amount": -1573.20,
    "relatedTransactionId": "txn-123",
    "relatedConversionId": null,
    "balanceAfter": 1250.45,
    "timestamp": "2026-06-10T12:20:00Z"
  }
  ```

### 8. FX Conversion (`PORTFOLIO#<portfolioId>#FX#<timestamp>#<conversionId>`)
Represents a currency conversion and its fees. FX conversions should also create cash ledger entries for both currencies.

* **PK**: `USER#<userId>`
* **SK**: `PORTFOLIO#<portfolioId>#FX#<timestamp>#<conversionId>`
* **Attributes**:
  ```json
  {
    "conversionId": "fx-123",
    "fromCurrency": "EUR",
    "toCurrency": "USD",
    "fromAmount": 1000.00,
    "toAmount": 1085.00,
    "fxRate": 1.085,
    "fees": [
      {
        "type": "FX_FEE",
        "amount": 3.00,
        "currency": "EUR"
      }
    ],
    "timestamp": "2026-06-10T12:00:00Z",
    "source": "MANUAL"
  }
  ```

### 9. Analysis Job (`PORTFOLIO#<portfolioId>#ANALYSIS_JOB#<jobId>`)
Tracks the status of an asynchronous portfolio analysis job (e.g. Bedrock analysis queue).

* **PK**: `USER#<userId>`
* **SK**: `PORTFOLIO#<portfolioId>#ANALYSIS_JOB#<jobId>`
* **Attributes**:
  ```json
  {
    "status": "RUNNING",
    "createdAt": "2026-06-10T12:15:00Z",
    "completedAt": null,
    "error": null
  }
  ```

### 10. Analysis Result (`PORTFOLIO#<portfolioId>#ANALYSIS_RESULT#<jobId>`)
Stores the output generated by a completed analysis job.

* **PK**: `USER#<userId>`
* **SK**: `PORTFOLIO#<portfolioId>#ANALYSIS_RESULT#<jobId>`
* **Attributes**:
  ```json
  {
    "metrics": {
      "diversificationScore": 85,
      "riskLevel": "Medium"
    },
    "recommendations": [
      "Consider adding exposure to energy sector.",
      "Reduce concentration in technology stocks."
    ],
    "createdAt": "2026-06-10T12:16:30Z"
  }
  ```

---

## Access Patterns (AP)

Here are the specific query configurations mapped to API requests.

### AP1: Fetch User Profile
* **Operation**: `GetItem`
* **Key**:
  - `PK = USER#<userId>`
  - `SK = METADATA`

### AP2: Fetch All Portfolio Metadata Rows for a User
* **Operation**: `Query`
* **Key Condition**:
  - `PK = USER#<userId>`
  - `SK between PORTFOLIO# and PORTFOLIO$`
* **Filter Condition**:
  - `SK ends_with #METADATA`
* **Note**: DynamoDB does not support `ends_with` in key conditions. If `begins_with(SK, "PORTFOLIO#")` is used, it will also pull back child records like holdings and transactions because they share that prefix. Therefore, the backend will need to explicitly use a `FilterExpression` or client-side filtering to isolate the metadata-only rows. If this access pattern becomes hot or users can have many portfolio child rows, add a dedicated portfolio list item such as `SK = PORTFOLIO_LIST#<portfolioId>` or a GSI for portfolio metadata.

### AP3: Fetch a Single Portfolio Metadata
* **Operation**: `GetItem`
* **Key**:
  - `PK = USER#<userId>`
  - `SK = PORTFOLIO#<portfolioId>#METADATA`

### AP4: Fetch All Holdings in a Portfolio
* **Operation**: `Query`
* **Key Condition**:
  - `PK = USER#<userId>`
  - `SK begins_with PORTFOLIO#<portfolioId>#HOLDING#`
* **Filter Condition**:
  - Exclude `#LOT#` rows if only current holding snapshots are needed.

### AP5: Fetch a Specific Holding in a Portfolio
* **Operation**: `GetItem`
* **Key**:
  - `PK = USER#<userId>`
  - `SK = PORTFOLIO#<portfolioId>#HOLDING#<assetId>`

### AP6: Fetch All Transactions in a Portfolio (Sorted by Trade Timestamp)
* **Operation**: `Query`
* **Key Condition**:
  - `PK = USER#<userId>`
  - `SK begins_with PORTFOLIO#<portfolioId>#TRANSACTION#`
* **Note**: Results are naturally sorted chronologically by DynamoDB because the ISO-8601 timestamp is the first element after the `TRANSACTION` prefix in the Sort Key.

### AP7: Fetch All Transactions for a Specific Holding
* **Operation**: `Query` on `GSI1`
* **Key Condition**:
  - `GSI1PK = USER#<userId>#PORTFOLIO#<portfolioId>#HOLDING#<assetId>`
  - `GSI1SK begins_with TRANSACTION#`
* **Purpose**: Shows how the current holding was built and managed from all buy/sell/dividend/corporate-action events.

### AP8: Fetch Open Tax Lots for a Specific Holding
* **Operation**: `Query`
* **Key Condition**:
  - `PK = USER#<userId>`
  - `SK begins_with PORTFOLIO#<portfolioId>#HOLDING#<assetId>#LOT#`
* **Filter Condition**:
  - `remainingQuantity > 0`

### AP9: Fetch Cash Balance by Currency
* **Operation**: `GetItem`
* **Key**:
  - `PK = USER#<userId>`
  - `SK = PORTFOLIO#<portfolioId>#CASH#<currency>`

### AP10: Fetch Full Cash Ledger for a Portfolio
* **Operation**: `Query`
* **Key Condition**:
  - `PK = USER#<userId>`
  - `SK begins_with PORTFOLIO#<portfolioId>#CASH_LEDGER#`

### AP11: Fetch FX Conversion History for a Portfolio
* **Operation**: `Query`
* **Key Condition**:
  - `PK = USER#<userId>`
  - `SK begins_with PORTFOLIO#<portfolioId>#FX#`

### AP12: Fetch All Analysis Jobs for a Portfolio
* **Operation**: `Query`
* **Key Condition**:
  - `PK = USER#<userId>`
  - `SK begins_with PORTFOLIO#<portfolioId>#ANALYSIS_JOB#`

### AP13: Fetch Analysis Result for a Specific Job
* **Operation**: `GetItem`
* **Key**:
  - `PK = USER#<userId>`
  - `SK = PORTFOLIO#<portfolioId>#ANALYSIS_RESULT#<jobId>`

---

## Accounting Notes

1. **Fees and Taxes**: Store fees and taxes as arrays with `type`, `amount`, and `currency`. This keeps brokerage fees, exchange fees, taxes, and FX fees explicit and auditable.
2. **Asset Identity**: Prefer stable asset identifiers such as ISIN or another internal `assetId` over `symbol` alone. Symbols can be ambiguous across exchanges and may change over time.
3. **Cost Basis**: Store the portfolio-level cost basis method (`FIFO`, `LIFO`, `WEIGHTED_AVERAGE`, or `SPECIFIC_LOT`) and maintain tax lots when detailed realized gain/loss reporting is needed.
4. **Cash Reconciliation**: Every trade, dividend, fee, tax, transfer, and FX conversion should have corresponding cash ledger entries so cash balances can be reproduced.
5. **Valuation Snapshots**: Market values and unrealized gain/loss change over time. If historical reporting is required, store valuation snapshots separately instead of overwriting only the holding snapshot.
