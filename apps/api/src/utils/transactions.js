/**
 * Calculates current holdings and cash balance by aggregating the sum of all transaction records chronologically.
 * 
 * @param {Array} transactions - List of transactions
 * @returns {object} Calculated portfolio state: { holdings, cashBalance }
 */
function calculatePortfolioState(transactions) {
  let cash = 0;
  const holdings = {};

  // Ensure transactions are sorted chronologically by timestamp
  const sortedTxns = [...transactions].sort((a, b) => a.SK.localeCompare(b.SK));

  for (const txn of sortedTxns) {
    const type = (txn.type || "").toLowerCase();
    const ticker = txn.ticker;
    const quantity = parseFloat(txn.quantity) || 0;
    const price = parseFloat(txn.price) || 0;
    
    // Amount defaults to quantity * price for buy/sell if not explicitly defined
    let amount = parseFloat(txn.amount);
    if (isNaN(amount)) {
      amount = quantity * price;
    }

    switch (type) {
      case "deposit":
        cash += amount;
        break;
      case "withdrawal":
        cash -= amount;
        break;
      case "dividend":
        cash += amount;
        break;
      case "fee":
        cash -= amount;
        break;
      case "buy":
        if (ticker) {
          holdings[ticker] = (holdings[ticker] || 0) + quantity;
        }
        cash -= amount;
        break;
      case "sell":
        if (ticker) {
          holdings[ticker] = (holdings[ticker] || 0) - quantity;
        }
        cash += amount;
        break;
      default:
        // Ignore or log unknown transaction types
        break;
    }
  }

  // Clean up holdings map by removing tickers with zero or negative quantity (due to minor floating point precision errors)
  const activeHoldings = {};
  for (const [ticker, qty] of Object.entries(holdings)) {
    if (qty > 1e-9) {
      // Round to 8 decimal places to avoid standard JS float representation issues
      activeHoldings[ticker] = parseFloat(qty.toFixed(8));
    }
  }

  return {
    holdings: activeHoldings,
    cashBalance: parseFloat(cash.toFixed(2)) // Standard two decimal rounding for cash balances
  };
}

/**
 * Validates a new transaction against the current state calculated from existing transactions.
 * 
 * @param {object} newTxn - The new transaction to be added
 * @param {Array} existingTxns - The list of existing transactions
 * @returns {object} Validation result: { valid, error }
 */
function validateNewTransaction(newTxn, existingTxns) {
  const { holdings, cashBalance } = calculatePortfolioState(existingTxns);
  
  const type = (newTxn.type || "").toLowerCase();
  const ticker = newTxn.ticker;
  const quantity = parseFloat(newTxn.quantity) || 0;
  const price = parseFloat(newTxn.price) || 0;
  
  let amount = parseFloat(newTxn.amount);
  if (isNaN(amount)) {
    amount = quantity * price;
  }
  if (amount <= 0) {
    return {
      valid: false,
      error: "Amount must be greater than 0"
    };
  }

  // Validate generic types
  const validTypes = ["buy", "sell", "deposit", "withdrawal", "dividend", "fee"];
  if (!validTypes.includes(type)) {
    return {
      valid: false,
      error: `Invalid transaction type. Must be one of: ${validTypes.join(", ")}`
    };
  }

  // Check type-specific validations
  if (type === "buy" || type === "sell") {
    if (!ticker) {
      return {
        valid: false,
        error: `Ticker symbol is required for type '${type}'`
      };
    }
    if (quantity <= 0) {
      return {
        valid: false,
        error: "Quantity must be greater than 0"
      };
    }
    if (price <= 0) {
      return {
        valid: false,
        error: "Price must be greater than 0"
      };
    }
  } else {
    // deposit, withdrawal, dividend, fee
    if (amount <= 0) {
      return {
        valid: false,
        error: "Amount must be greater than 0"
      };
    }
  }

  // Acceptance Criteria 2: Strict Validation rules
  if (type === "sell") {
    const currentQty = holdings[ticker] || 0;
    if (currentQty < quantity) {
      return {
        valid: false,
        error: `Insufficient shares to sell ${ticker}. Owned: ${currentQty}, trying to sell: ${quantity}`
      };
    }
  }

  if (type === "buy") {
    if (cashBalance < amount) {
      return {
        valid: false,
        error: `Insufficient cash to buy ${ticker}. Available cash: €${cashBalance}, transaction cost: €${amount}`
      };
    }
  }

  if (type === "withdrawal") {
    if (cashBalance < amount) {
      return {
        valid: false,
        error: `Insufficient cash to withdraw. Available cash: €${cashBalance}, withdrawal amount: €${amount}`
      };
    }
  }

  return { valid: true };
}

/**
 * Validates a list of transactions chronologically to ensure cash balance and holdings are never negative.
 * 
 * @param {Array} transactions - List of transactions
 * @returns {object} Validation result: { valid, error }
 */
function validateTransactionsState(transactions) {
  let cash = 0;
  const holdings = {};
  
  // Sort them chronologically by timestamp (SK or timestamp)
  const sortedTxns = [...transactions].sort((a, b) => {
    const timeA = a.timestamp || a.SK || "";
    const timeB = b.timestamp || b.SK || "";
    return timeA.localeCompare(timeB);
  });

  for (const txn of sortedTxns) {
    const type = (txn.type || "").toLowerCase();
    const ticker = txn.ticker;
    const quantity = parseFloat(txn.quantity) || 0;
    const price = parseFloat(txn.price) || 0;
    
    let amount = parseFloat(txn.amount);
    if (isNaN(amount)) {
      amount = quantity * price;
    }

    switch (type) {
      case "deposit":
        cash += amount;
        break;
      case "withdrawal":
        cash -= amount;
        break;
      case "dividend":
        cash += amount;
        break;
      case "fee":
        cash -= amount;
        break;
      case "buy":
        if (ticker) {
          holdings[ticker] = (holdings[ticker] || 0) + quantity;
        }
        cash -= amount;
        break;
      case "sell":
        if (ticker) {
          holdings[ticker] = (holdings[ticker] || 0) - quantity;
        }
        cash += amount;
        break;
    }

    // Check for negative cash or negative holdings with float tolerance
    if (cash < -1e-9) {
      return {
        valid: false,
        error: `Insufficient cash at transaction timestamp ${txn.timestamp || txn.SK || "unknown"}. Balance: ${cash.toFixed(2)}`
      };
    }

    if (ticker && holdings[ticker] < -1e-9) {
      return {
        valid: false,
        error: `Insufficient shares for ${ticker} at transaction timestamp ${txn.timestamp || txn.SK || "unknown"}. Owned: ${holdings[ticker].toFixed(8)}`
      };
    }
  }

  return { valid: true };
}

const DEFAULT_MOCK_PRICES = {
  AAPL: 180.00,
  MSFT: 420.00,
  TSLA: 220.00,
  GOOG: 175.00,
  NVDA: 130.00
};

/**
 * Calculates detailed portfolio metrics (cost basis, current value, unrealized gain/loss, allocation)
 * from the raw transaction ledger.
 * 
 * Math Assumptions & Algorithms:
 * 1. Cost basis uses the Average Cost algorithm.
 *    - Buy transactions increase quantity and total cost. Average price is calculated as (total cost / quantity).
 *    - Sell transactions decrease quantity. The total cost is reduced proportionally based on the average price,
 *      leaving the average cost per share unchanged.
 * 2. Fees are excluded from asset cost basis. Individual fee transactions or other fees are deducted from cash
 *    but do not affect the cost basis of specific stock assets.
 * 3. Unrealized gain/loss is calculated per asset as: Current Value - Cost Basis.
 * 4. Unrealized gain/loss percentage is: (Unrealized Gain/Loss / Cost Basis) * 100.
 *    - If Cost Basis is 0, the percentage gain/loss is 0% to prevent divide-by-zero.
 * 5. Portfolio allocation represents the percentage weight of each asset (and cash) relative to the total portfolio
 *    current value (assets value + cash balance).
 *    - If total portfolio value is 0, the allocation is 0% to prevent divide-by-zero.
 * 
 * @param {Array} transactions - List of transaction ledger entries.
 * @param {object} [currentPrices] - Optional map of ticker symbols to current market prices.
 * @returns {object} Calculated metrics object with holdings detail and portfolio totals.
 */
function calculatePortfolioMetrics(transactions, currentPrices = {}) {
  let cash = 0;
  const holdings = {};

  // Ensure transactions are sorted chronologically by timestamp
  const sortedTxns = [...transactions].sort((a, b) => {
    const timeA = a.timestamp || a.SK || "";
    const timeB = b.timestamp || b.SK || "";
    return timeA.localeCompare(timeB);
  });

  for (const txn of sortedTxns) {
    const type = (txn.type || "").toLowerCase();
    const ticker = txn.ticker;
    const quantity = parseFloat(txn.quantity) || 0;
    const price = parseFloat(txn.price) || 0;
    
    let amount = parseFloat(txn.amount);
    if (isNaN(amount)) {
      amount = quantity * price;
    }

    switch (type) {
      case "deposit":
        cash += amount;
        break;
      case "withdrawal":
        cash -= amount;
        break;
      case "dividend":
        cash += amount;
        break;
      case "fee":
        cash -= amount;
        break;
      case "buy":
        if (ticker) {
          if (!holdings[ticker]) {
            holdings[ticker] = { quantity: 0, totalCost: 0, averageCost: 0 };
          }
          holdings[ticker].quantity += quantity;
          holdings[ticker].totalCost += amount;
          holdings[ticker].averageCost = holdings[ticker].quantity > 0 ? holdings[ticker].totalCost / holdings[ticker].quantity : 0;
        }
        cash -= amount;
        break;
      case "sell":
        if (ticker && holdings[ticker]) {
          holdings[ticker].quantity -= quantity;
          if (holdings[ticker].quantity <= 1e-9) {
            delete holdings[ticker];
          } else {
            // Under average cost basis, the average price of the remaining shares remains constant.
            // Adjust the cost basis (totalCost) proportionally to remaining shares.
            holdings[ticker].totalCost = holdings[ticker].quantity * holdings[ticker].averageCost;
          }
        }
        cash += amount;
        break;
    }
  }

  // Round cash balance to 2 decimals
  const finalCash = parseFloat(cash.toFixed(2));

  // Build the holdings metrics output
  const activeHoldings = {};
  let totalAssetCostBasis = 0;
  let totalAssetCurrentValue = 0;

  for (const [ticker, h] of Object.entries(holdings)) {
    const qty = parseFloat(h.quantity.toFixed(8));
    if (qty <= 1e-9) continue;

    const costBasis = parseFloat(h.totalCost.toFixed(2));
    const averageCost = parseFloat(h.averageCost.toFixed(4));

    // Get current price from custom mapping, fallback to default mock prices, fallback to average cost
    const currentPrice = currentPrices[ticker] !== undefined 
      ? parseFloat(currentPrices[ticker])
      : (DEFAULT_MOCK_PRICES[ticker] !== undefined ? DEFAULT_MOCK_PRICES[ticker] : averageCost);

    const currentValue = parseFloat((qty * currentPrice).toFixed(2));
    const unrealizedGainLoss = parseFloat((currentValue - costBasis).toFixed(2));
    const unrealizedGainLossPct = costBasis > 0 
      ? parseFloat(((unrealizedGainLoss / costBasis) * 100).toFixed(2))
      : 0;

    activeHoldings[ticker] = {
      quantity: qty,
      costBasis,
      averageCost,
      currentPrice,
      currentValue,
      unrealizedGainLoss,
      unrealizedGainLossPct
    };

    totalAssetCostBasis += costBasis;
    totalAssetCurrentValue += currentValue;
  }

  // Calculate totals
  const portfolioCostBasis = parseFloat((totalAssetCostBasis + finalCash).toFixed(2));
  const portfolioCurrentValue = parseFloat((totalAssetCurrentValue + finalCash).toFixed(2));
  const totalUnrealizedGainLoss = parseFloat((totalAssetCurrentValue - totalAssetCostBasis).toFixed(2));
  const totalUnrealizedGainLossPct = totalAssetCostBasis > 0
    ? parseFloat(((totalUnrealizedGainLoss / totalAssetCostBasis) * 100).toFixed(2))
    : 0;

  // Calculate allocations
  for (const ticker of Object.keys(activeHoldings)) {
    const asset = activeHoldings[ticker];
    asset.allocationPct = portfolioCurrentValue > 0
      ? parseFloat(((asset.currentValue / portfolioCurrentValue) * 100).toFixed(2))
      : 0;
  }

  const cashAllocationPct = portfolioCurrentValue > 0
    ? parseFloat(((finalCash / portfolioCurrentValue) * 100).toFixed(2))
    : 0;

  return {
    holdings: activeHoldings,
    cashBalance: finalCash,
    totals: {
      costBasis: portfolioCostBasis,
      currentValue: portfolioCurrentValue,
      unrealizedGainLoss: totalUnrealizedGainLoss,
      unrealizedGainLossPct: totalUnrealizedGainLossPct,
      cashAllocationPct
    }
  };
}

module.exports = {
  calculatePortfolioState,
  validateNewTransaction,
  validateTransactionsState,
  calculatePortfolioMetrics
};
