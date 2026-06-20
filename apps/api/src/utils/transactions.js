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

module.exports = {
  calculatePortfolioState,
  validateNewTransaction
};
