process.env.PORT = "3001";
process.env.NODE_ENV = "development";
process.env.BYPASS_AUTH = "true";
process.env.MOCK_DYNAMODB = "true";

const app = require("./app");
const { clearMockDb } = require("./utils/ddb");

const PORT = Number(process.env.PORT || 3001);
const server = app.listen(PORT, async () => {
  console.log(`Transaction Test Server running on port ${PORT}`);
  let passed = true;

  try {
    // Helper to send HTTP requests to test server
    const apiRequest = async (path, method = "GET", body = null) => {
      const options = {
        method,
        headers: {
          "Authorization": "Bearer dummy-token",
          "Connection": "close"
        }
      };
      if (body) {
        options.headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(body);
      }
      const res = await fetch(`http://localhost:${PORT}${path}`, options);
      const data = await res.json();
      return { status: res.status, data };
    };

    // Reset database for a clean start
    clearMockDb();

    console.log("\n--- Executing Transaction & Holdings Tests ---");

    // 1. Initial State Checks
    console.log("Test 1: Initial transactions empty...");
    const { status: s1, data: d1 } = await apiRequest("/api/portfolios/portfolio-1/transactions");
    if (s1 !== 200 || !Array.isArray(d1.transactions) || d1.transactions.length !== 0) {
      throw new Error(`Expected empty transaction list, got status ${s1} and data: ${JSON.stringify(d1)}`);
    }
    console.log("  PASS: Initial transactions empty");

    console.log("Test 2: Initial holdings empty...");
    const { status: s2, data: d2 } = await apiRequest("/api/portfolios/portfolio-1/holdings");
    if (s2 !== 200 || d2.cashBalance !== 0 || Object.keys(d2.holdings).length !== 0) {
      throw new Error(`Expected zero cash balance and empty holdings, got: ${JSON.stringify(d2)}`);
    }
    console.log("  PASS: Initial holdings empty");

    // 2. Validation Rejections (Insufficient Balance / Holdings)
    console.log("Test 3: Reject buy when cash is 0...");
    const { status: s3, data: d3 } = await apiRequest("/api/portfolios/portfolio-1/transactions", "POST", {
      type: "buy",
      ticker: "AAPL",
      quantity: 10,
      price: 150
    });
    if (s3 !== 400 || d3.status !== "error" || !d3.message.includes("Insufficient cash")) {
      throw new Error(`Expected 400 cash error, got status ${s3}: ${JSON.stringify(d3)}`);
    }
    console.log("  PASS: Buy rejected due to insufficient cash");

    console.log("Test 4: Reject sell when shares are 0...");
    const { status: s4, data: d4 } = await apiRequest("/api/portfolios/portfolio-1/transactions", "POST", {
      type: "sell",
      ticker: "AAPL",
      quantity: 5,
      price: 150
    });
    if (s4 !== 400 || d4.status !== "error" || !d4.message.includes("Insufficient shares")) {
      throw new Error(`Expected 400 shares error, got status ${s4}: ${JSON.stringify(d4)}`);
    }
    console.log("  PASS: Sell rejected due to insufficient shares");

    console.log("Test 5: Reject withdrawal when cash is 0...");
    const { status: s5, data: d5 } = await apiRequest("/api/portfolios/portfolio-1/transactions", "POST", {
      type: "withdrawal",
      amount: 1000
    });
    if (s5 !== 400 || d5.status !== "error" || !d5.message.includes("Insufficient cash")) {
      throw new Error(`Expected 400 cash error, got status ${s5}: ${JSON.stringify(d5)}`);
    }
    console.log("  PASS: Withdrawal rejected due to insufficient cash");

    // 3. Successful State Transitions
    console.log("Test 6: Create deposit...");
    const { status: s6, data: d6 } = await apiRequest("/api/portfolios/portfolio-1/transactions", "POST", {
      type: "deposit",
      amount: 10000,
      timestamp: "2026-06-20T10:00:00.000Z"
    });
    if (s6 !== 201 || d6.transaction.amount !== 10000) {
      throw new Error(`Expected 201 created, got status ${s6}: ${JSON.stringify(d6)}`);
    }
    console.log("  PASS: Deposit created");

    console.log("Test 7: Verify holdings cash updated after deposit...");
    const { data: d7 } = await apiRequest("/api/portfolios/portfolio-1/holdings");
    if (d7.cashBalance !== 10000 || Object.keys(d7.holdings).length !== 0) {
      throw new Error(`Expected €10,000 cash balance, got: ${JSON.stringify(d7)}`);
    }
    console.log("  PASS: Cash balance is €10,000");

    console.log("Test 8: Buy shares...");
    const { status: s8, data: d8 } = await apiRequest("/api/portfolios/portfolio-1/transactions", "POST", {
      type: "buy",
      ticker: "AAPL",
      quantity: 10,
      price: 150,
      timestamp: "2026-06-20T10:05:00.000Z"
    });
    if (s8 !== 201) {
      throw new Error(`Expected 201 buy creation, got status ${s8}: ${JSON.stringify(d8)}`);
    }
    console.log("  PASS: Buy successful");

    console.log("Test 9: Verify holdings state (10 AAPL, €8,500 cash)...");
    const { data: d9 } = await apiRequest("/api/portfolios/portfolio-1/holdings");
    if (d9.cashBalance !== 8500 || d9.holdings.AAPL !== 10) {
      throw new Error(`Expected cash: €8,500, AAPL: 10. Got: ${JSON.stringify(d9)}`);
    }
    console.log("  PASS: Holdings state updated correctly");

    console.log("Test 10: Buy more shares...");
    const { status: s10 } = await apiRequest("/api/portfolios/portfolio-1/transactions", "POST", {
      type: "buy",
      ticker: "AAPL",
      quantity: 5,
      price: 160,
      timestamp: "2026-06-20T10:10:00.000Z"
    });
    if (s10 !== 201) {
      throw new Error(`Expected 201 buy creation, got status ${s10}`);
    }
    console.log("  PASS: Second buy successful");

    console.log("Test 11: Verify state (15 AAPL, €7,700 cash)...");
    const { data: d11 } = await apiRequest("/api/portfolios/portfolio-1/holdings");
    if (d11.cashBalance !== 7700 || d11.holdings.AAPL !== 15) {
      throw new Error(`Expected cash: €7,700, AAPL: 15. Got: ${JSON.stringify(d11)}`);
    }
    console.log("  PASS: Holdings state updated correctly after second buy");

    console.log("Test 12: Reject sell when quantity exceeds holdings...");
    const { status: s12 } = await apiRequest("/api/portfolios/portfolio-1/transactions", "POST", {
      type: "sell",
      ticker: "AAPL",
      quantity: 20,
      price: 170
    });
    if (s12 !== 400) {
      throw new Error(`Expected sell of 20 AAPL to fail, got status ${s12}`);
    }
    console.log("  PASS: Oversell properly rejected");

    console.log("Test 13: Sell shares...");
    const { status: s13 } = await apiRequest("/api/portfolios/portfolio-1/transactions", "POST", {
      type: "sell",
      ticker: "AAPL",
      quantity: 5,
      price: 170,
      timestamp: "2026-06-20T10:15:00.000Z"
    });
    if (s13 !== 201) {
      throw new Error(`Expected 201 sell creation, got status ${s13}`);
    }
    console.log("  PASS: Sell successful");

    console.log("Test 14: Verify state (10 AAPL, €8,550 cash)...");
    const { data: d14 } = await apiRequest("/api/portfolios/portfolio-1/holdings");
    if (d14.cashBalance !== 8550 || d14.holdings.AAPL !== 10) {
      throw new Error(`Expected cash: €8,550, AAPL: 10. Got: ${JSON.stringify(d14)}`);
    }
    console.log("  PASS: Holdings state updated correctly after sell");

    console.log("Test 15: Create fee transaction...");
    const { status: s15 } = await apiRequest("/api/portfolios/portfolio-1/transactions", "POST", {
      type: "fee",
      amount: 50,
      timestamp: "2026-06-20T10:20:00.000Z"
    });
    if (s15 !== 201) {
      throw new Error(`Expected 201 fee creation, got status ${s15}`);
    }
    console.log("  PASS: Fee transaction created");

    console.log("Test 16: Create dividend transaction...");
    const { status: s16 } = await apiRequest("/api/portfolios/portfolio-1/transactions", "POST", {
      type: "dividend",
      amount: 100,
      timestamp: "2026-06-20T10:25:00.000Z"
    });
    if (s16 !== 201) {
      throw new Error(`Expected 201 dividend creation, got status ${s16}`);
    }
    console.log("  PASS: Dividend transaction created");

    console.log("Test 17: Create withdrawal transaction...");
    const { status: s17 } = await apiRequest("/api/portfolios/portfolio-1/transactions", "POST", {
      type: "withdrawal",
      amount: 8000,
      timestamp: "2026-06-20T10:30:00.000Z"
    });
    if (s17 !== 201) {
      throw new Error(`Expected 201 withdrawal creation, got status ${s17}`);
    }
    console.log("  PASS: Withdrawal successful");

    console.log("Test 18: Verify final holdings state (10 AAPL, €600 cash)...");
    const { data: d18 } = await apiRequest("/api/portfolios/portfolio-1/holdings");
    if (d18.cashBalance !== 600 || d18.holdings.AAPL !== 10) {
      throw new Error(`Expected cash: €600, AAPL: 10. Got: ${JSON.stringify(d18)}`);
    }
    console.log("  PASS: Final holdings state updated correctly");

    console.log("Test 19: List all transactions & check sorting...");
    const { data: d19 } = await apiRequest("/api/portfolios/portfolio-1/transactions");
    if (d19.transactions.length !== 7) {
      throw new Error(`Expected 7 transactions, got ${d19.transactions.length}`);
    }
    const timestamps = d19.transactions.map(t => t.timestamp);
    const sortedTimestamps = [...timestamps].sort();
    for (let i = 0; i < timestamps.length; i++) {
      if (timestamps[i] !== sortedTimestamps[i]) {
        throw new Error("Transactions are not sorted chronologically by timestamp!");
      }
    }
    console.log("  PASS: All transactions listed and properly sorted chronologically");

    console.log("Test 20: Reject backdated withdrawal causing negative historical balance...");
    const { status: s20, data: d20 } = await apiRequest("/api/portfolios/portfolio-1/transactions", "POST", {
      type: "withdrawal",
      amount: 1000,
      timestamp: "2026-06-20T10:29:00.000Z"
    });
    if (s20 !== 400 || !d20.message.includes("Insufficient cash")) {
      throw new Error(`Expected 400 validation error, got status ${s20}: ${JSON.stringify(d20)}`);
    }
    console.log("  PASS: Backdated withdrawal rejected");

    console.log("\n--- All Transaction tests passed! ---");
  } catch (err) {
    console.error("\nFAIL: Transaction integration tests failed with error:", err);
    passed = false;
  } finally {
    server.close();
    setTimeout(() => {
      process.exit(passed ? 0 : 1);
    }, 200);
  }
});
