const { calculatePortfolioMetrics } = require("./utils/transactions");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

console.log("\n--- Executing Portfolio Math Calculation Unit Tests ---");

// Test 1: Empty Portfolio (Zero Balances)
(function testEmptyPortfolio() {
  console.log("Test 1: Empty portfolio (zero balances)...");
  const result = calculatePortfolioMetrics([]);
  assert(result.cashBalance === 0, "Cash balance should be 0");
  assert(Object.keys(result.holdings).length === 0, "Holdings should be empty");
  assert(result.totals.costBasis === 0, "Cost basis should be 0");
  assert(result.totals.currentValue === 0, "Current value should be 0");
  assert(result.totals.unrealizedGainLoss === 0, "Unrealized gain/loss should be 0");
  assert(result.totals.unrealizedGainLossPct === 0, "Unrealized gain/loss percentage should be 0");
  assert(result.totals.cashAllocationPct === 0, "Cash allocation should be 0");
  console.log("  PASS");
})();

// Test 2: Standard Deposits and Buy Transactions
(function testDepositsAndBuys() {
  console.log("Test 2: Standard deposits and buys...");
  const txns = [
    { type: "deposit", amount: 10000, timestamp: "2026-07-01T10:00:00Z" },
    { type: "buy", ticker: "AAPL", quantity: 10, price: 150, timestamp: "2026-07-01T10:05:00Z" }, // Cost: 1500
    { type: "buy", ticker: "AAPL", quantity: 10, price: 160, timestamp: "2026-07-01T10:10:00Z" }  // Cost: 1600
  ];
  // Total cost AAPL = 3100, qty = 20, avg cost = 155. Cash remaining = 10000 - 3100 = 6900
  const result = calculatePortfolioMetrics(txns, { AAPL: 170 });
  
  assert(result.cashBalance === 6900, "Cash should be 6900");
  const aapl = result.holdings.AAPL;
  assert(aapl !== undefined, "AAPL holding should exist");
  assert(aapl.quantity === 20, "AAPL qty should be 20");
  assert(aapl.costBasis === 3100, "AAPL cost basis should be 3100");
  assert(aapl.averageCost === 155, "AAPL average cost should be 155");
  assert(aapl.currentPrice === 170, "AAPL current price should be 170");
  assert(aapl.currentValue === 3400, "AAPL current value should be 3400"); // 20 * 170
  assert(aapl.unrealizedGainLoss === 300, "AAPL gain should be 300"); // 3400 - 3100
  assert(aapl.unrealizedGainLossPct === 9.68, `AAPL gain pct should be 9.68, got ${aapl.unrealizedGainLossPct}`); // (300/3100)*100
  
  // Totals
  // Portfolio Cost Basis = 3100 + 6900 = 10000
  // Portfolio Current Value = 3400 + 6900 = 10300
  assert(result.totals.costBasis === 10000, "Total cost basis should be 10000");
  assert(result.totals.currentValue === 10300, "Total current value should be 10300");
  assert(result.totals.unrealizedGainLoss === 300, "Total unrealized gain/loss should be 300");
  assert(result.totals.unrealizedGainLossPct === 9.68, "Total unrealized gain/loss pct should be 9.68");
  
  // Allocations
  // AAPL weight = 3400 / 10300 * 100 = 33.01%
  // Cash weight = 6900 / 10300 * 100 = 66.99%
  assert(aapl.allocationPct === 33.01, `AAPL allocation should be 33.01, got ${aapl.allocationPct}`);
  assert(result.totals.cashAllocationPct === 66.99, `Cash allocation should be 66.99, got ${result.totals.cashAllocationPct}`);
  console.log("  PASS");
})();

// Test 3: Partial Sells and Average Cost basis maintenance
(function testPartialSells() {
  console.log("Test 3: Partial sells and average cost maintenance...");
  const txns = [
    { type: "deposit", amount: 5000, timestamp: "2026-07-01T10:00:00Z" },
    { type: "buy", ticker: "MSFT", quantity: 10, price: 300, timestamp: "2026-07-01T10:05:00Z" }, // Cost: 3000, avg: 300
    { type: "sell", ticker: "MSFT", quantity: 4, price: 350, timestamp: "2026-07-01T10:10:00Z" }  // Sell 4 at 350. Remaining qty: 6. Avg cost remains 300. Remaining cost basis: 1800. Cash: 2000 + 1400 = 3400
  ];
  const result = calculatePortfolioMetrics(txns, { MSFT: 400 });
  
  assert(result.cashBalance === 3400, "Cash should be 3400");
  const msft = result.holdings.MSFT;
  assert(msft.quantity === 6, "MSFT qty should be 6");
  assert(msft.averageCost === 300, "MSFT avg cost should remain 300");
  assert(msft.costBasis === 1800, "MSFT cost basis should be 1800");
  assert(msft.currentValue === 2400, "MSFT current value should be 2400"); // 6 * 400
  assert(msft.unrealizedGainLoss === 600, "MSFT unrealized gain should be 600"); // 2400 - 1800
  assert(msft.unrealizedGainLossPct === 33.33, "MSFT unrealized gain pct should be 33.33");
  
  // Totals
  // Portfolio Cost Basis = 1800 + 3400 = 5200
  // Portfolio Current Value = 2400 + 3400 = 5800
  assert(result.totals.costBasis === 5200, "Total cost basis should be 5200");
  assert(result.totals.currentValue === 5800, "Total current value should be 5800");
  console.log("  PASS");
})();

// Test 4: Exclude Fees from Asset Cost Basis
(function testFeeExclusion() {
  console.log("Test 4: Exclude fees from asset cost basis...");
  const txns = [
    { type: "deposit", amount: 1000, timestamp: "2026-07-01T10:00:00Z" },
    { type: "buy", ticker: "TSLA", quantity: 2, price: 200, timestamp: "2026-07-01T10:05:00Z" }, // Cost: 400
    { type: "fee", amount: 15, timestamp: "2026-07-01T10:10:00Z" } // Fee reduces cash but not asset cost basis
  ];
  const result = calculatePortfolioMetrics(txns, { TSLA: 250 });
  
  assert(result.cashBalance === 585, "Cash should be 585 (1000 - 400 - 15)");
  const tsla = result.holdings.TSLA;
  assert(tsla.costBasis === 400, "TSLA cost basis should exclude fees and remain 400");
  assert(tsla.averageCost === 200, "TSLA average cost should remain 200");
  console.log("  PASS");
})();

// Test 5: Divide-by-Zero and Edge Cases
(function testDivideByZero() {
  console.log("Test 5: Divide by zero prevention (e.g. current value is 0 or cost basis is 0)...");
  // 1. Portfolio has no holdings, only cash
  const txnsOnlyCash = [{ type: "deposit", amount: 500, timestamp: "2026-07-01T10:00:00Z" }];
  const res1 = calculatePortfolioMetrics(txnsOnlyCash);
  assert(res1.totals.costBasis === 500, "Cost basis should be 500");
  assert(res1.totals.currentValue === 500, "Current value should be 500");
  assert(res1.totals.unrealizedGainLoss === 0, "Gain loss should be 0");
  assert(res1.totals.unrealizedGainLossPct === 0, "Gain loss pct should be 0");
  assert(res1.totals.cashAllocationPct === 100, "Cash allocation should be 100%");

  // 2. Portfolio value is exactly 0 (empty, no cash, no assets)
  const res2 = calculatePortfolioMetrics([]);
  assert(res2.totals.costBasis === 0, "Cost basis should be 0");
  assert(res2.totals.currentValue === 0, "Current value should be 0");
  assert(res2.totals.cashAllocationPct === 0, "Cash allocation should be 0%");
  
  console.log("  PASS");
})();

console.log("\n--- All Portfolio Math Calculation Unit Tests Passed! ---");
