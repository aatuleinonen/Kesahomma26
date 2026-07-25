process.env.PORT = "3002";
process.env.NODE_ENV = "development";
process.env.BYPASS_AUTH = "true";
process.env.MOCK_DYNAMODB = "true";

const app = require("./app");
const { clearMockDb, deletePortfolio, getPortfolios, putPortfolio } = require("./utils/ddb");

const PORT = Number(process.env.PORT || 3002);
const server = app.listen(PORT, async () => {
  console.log(`Portfolios & Edits Test Server running on port ${PORT}`);
  let passed = true;

  try {
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
      const data = res.status === 204 ? null : await res.json();
      return { status: res.status, data };
    };

    // Reset database
    clearMockDb();

    console.log("\n--- Executing Portfolio Management & Edit/Delete Validation Tests ---");

    // 1. Initial State Check (Portfolios Empty)
    console.log("Test 1: Portfolios initially empty...");
    const { status: s1, data: d1 } = await apiRequest("/api/portfolios");
    if (s1 !== 200 || !Array.isArray(d1.portfolios) || d1.portfolios.length !== 0) {
      throw new Error(`Expected empty portfolios, got status ${s1}: ${JSON.stringify(d1)}`);
    }
    console.log("  PASS: Portfolios initially empty");

    // 2. Create Portfolio
    console.log("Test 2: Create a new portfolio...");
    const { status: s2, data: d2 } = await apiRequest("/api/portfolios", "POST", {
      portfolioId: "my-tech-portfolio",
      name: "Tech Investments",
      description: "My personal tech sector portfolio",
      baseCurrency: "EUR"
    });
    if (s2 !== 201 || d2.status !== "success" || d2.portfolio.name !== "Tech Investments") {
      throw new Error(`Expected 201 portfolio creation, got status ${s2}: ${JSON.stringify(d2)}`);
    }
    console.log("  PASS: Portfolio created successfully");

    // 3. List Portfolios
    console.log("Test 3: List portfolios containing new portfolio...");
    const { status: s3, data: d3 } = await apiRequest("/api/portfolios");
    if (s3 !== 200 || d3.portfolios.length !== 1 || d3.portfolios[0].portfolioId !== "my-tech-portfolio") {
      throw new Error(`Expected portfolio in list, got status ${s3}: ${JSON.stringify(d3)}`);
    }
    console.log("  PASS: Portfolio present in list");

    // 4. Create Deposit Transaction
    console.log("Test 4: Create a deposit transaction...");
    const { status: s4, data: d4 } = await apiRequest("/api/portfolios/my-tech-portfolio/transactions", "POST", {
      type: "deposit",
      amount: 5000,
      timestamp: "2026-06-20T12:00:00.000Z"
    });
    if (s4 !== 201 || d4.transaction.amount !== 5000) {
      throw new Error(`Expected 201 deposit creation, got status ${s4}: ${JSON.stringify(d4)}`);
    }
    console.log("  PASS: Deposit transaction recorded");

    // 5. Create Buy Transaction
    console.log("Test 5: Create a buy transaction...");
    const { status: s5, data: d5 } = await apiRequest("/api/portfolios/my-tech-portfolio/transactions", "POST", {
      type: "buy",
      ticker: "MSFT",
      quantity: 10,
      price: 300,
      timestamp: "2026-06-21T12:00:00.000Z"
    });
    if (s5 !== 201 || d5.transaction.ticker !== "MSFT") {
      throw new Error(`Expected 201 buy creation, got status ${s5}: ${JSON.stringify(d5)}`);
    }
    console.log("  PASS: Buy transaction recorded");

    // 6. Verify Initial State
    console.log("Test 6: Verify holdings state (10 MSFT, €2000 cash)...");
    const { data: d6 } = await apiRequest("/api/portfolios/my-tech-portfolio/holdings");
    if (d6.cashBalance !== 2000 || d6.holdings.MSFT !== 10) {
      throw new Error(`Expected €2,000 cash and 10 MSFT, got: ${JSON.stringify(d6)}`);
    }
    console.log("  PASS: Holdings state correct");

    // 7. Reject Deletion that breaks sequence (deleting deposit makes cash negative)
    console.log("Test 7: Reject deposit deletion due to negative cash...");
    const { status: s7, data: d7 } = await apiRequest("/api/portfolios/my-tech-portfolio/transactions/2026-06-20T12:00:00.000Z", "DELETE");
    if (s7 !== 400 || !d7.message.includes("Insufficient cash")) {
      throw new Error(`Expected 400 error due to negative cash, got status ${s7}: ${JSON.stringify(d7)}`);
    }
    console.log("  PASS: Deletion rejected because cash would go negative");

    // 8. Reject Edit that breaks sequence (updating buy to 20 shares exceeds cash)
    console.log("Test 8: Reject trade editing that exceeds available cash...");
    const { status: s8, data: d8 } = await apiRequest("/api/portfolios/my-tech-portfolio/transactions/2026-06-21T12:00:00.000Z", "PUT", {
      type: "buy",
      ticker: "MSFT",
      quantity: 20, // 20 * 300 = €6000, which exceeds the €5000 deposit
      price: 300,
      timestamp: "2026-06-21T12:00:00.000Z"
    });
    if (s8 !== 400 || !d8.message.includes("Insufficient cash")) {
      throw new Error(`Expected 400 error due to insufficient cash, got status ${s8}: ${JSON.stringify(d8)}`);
    }
    console.log("  PASS: Edit rejected because cash would go negative");

    // 9. Accept Edit that updates quantity successfully (reducing buy from 10 to 5)
    console.log("Test 9: Edit trade quantity successfully...");
    const { status: s9, data: d9 } = await apiRequest("/api/portfolios/my-tech-portfolio/transactions/2026-06-21T12:00:00.000Z", "PUT", {
      type: "buy",
      ticker: "MSFT",
      quantity: 5, // 5 * 300 = €1500 cost
      price: 300,
      timestamp: "2026-06-21T12:00:00.000Z"
    });
    if (s9 !== 200 || d9.status !== "success" || d9.transaction.quantity !== 5) {
      throw new Error(`Expected 200 update success, got status ${s9}: ${JSON.stringify(d9)}`);
    }
    console.log("  PASS: Trade edited successfully");

    // 10. Verify state after Edit
    console.log("Test 10: Verify state after edit (5 MSFT, €3500 cash)...");
    const { data: d10 } = await apiRequest("/api/portfolios/my-tech-portfolio/holdings");
    if (d10.cashBalance !== 3500 || d10.holdings.MSFT !== 5) {
      throw new Error(`Expected €3,500 cash and 5 MSFT, got: ${JSON.stringify(d10)}`);
    }
    console.log("  PASS: Holdings state updated correctly after edit");

    // 11. Delete Buy Transaction successfully
    console.log("Test 11: Delete buy transaction successfully...");
    const { status: s11 } = await apiRequest("/api/portfolios/my-tech-portfolio/transactions/2026-06-21T12:00:00.000Z", "DELETE");
    if (s11 !== 200) {
      throw new Error(`Expected 200 transaction deletion, got status ${s11}`);
    }
    console.log("  PASS: Transaction deleted successfully");

    // 12. Verify state after Delete
    console.log("Test 12: Verify state after deletion (0 MSFT, €5000 cash)...");
    const { data: d12 } = await apiRequest("/api/portfolios/my-tech-portfolio/holdings");
    if (d12.cashBalance !== 5000 || d12.holdings.MSFT !== undefined) {
      throw new Error(`Expected €5,000 cash and no MSFT, got: ${JSON.stringify(d12)}`);
    }
    console.log("  PASS: Holdings state correct after deletion");

    // 13. Delete the portfolio and all of its remaining records
    console.log("Test 13: Delete portfolio and all related records...");
    const { status: s13 } = await apiRequest("/api/portfolios/my-tech-portfolio", "DELETE");
    if (s13 !== 204) {
      throw new Error(`Expected 204 portfolio deletion, got status ${s13}`);
    }
    const { data: d13Portfolios } = await apiRequest("/api/portfolios");
    const { data: d13Transactions } = await apiRequest("/api/portfolios/my-tech-portfolio/transactions");
    if (d13Portfolios.portfolios.length !== 0 || d13Transactions.transactions.length !== 0) {
      throw new Error("Expected portfolio metadata and transactions to be deleted");
    }
    console.log("  PASS: Portfolio and related records deleted");

    // 14. Return not found when deleting an absent portfolio
    console.log("Test 14: Reject deletion of an absent portfolio...");
    const { status: s14, data: d14 } = await apiRequest("/api/portfolios/my-tech-portfolio", "DELETE");
    if (s14 !== 404 || d14.message !== "Portfolio not found") {
      throw new Error(`Expected 404 for absent portfolio, got status ${s14}: ${JSON.stringify(d14)}`);
    }
    console.log("  PASS: Missing portfolio returned 404");

    // 15. Verify the storage operation cannot delete another user's matching portfolio ID
    console.log("Test 15: Preserve another user's matching portfolio ID...");
    await putPortfolio("other-user", { portfolioId: "shared-id", name: "Other User Portfolio" });
    const deletion = await deletePortfolio("dev-user-12345-uuid-67890", "shared-id");
    const otherUserPortfolios = await getPortfolios("other-user");
    if (deletion !== null || otherUserPortfolios.length !== 1) {
      throw new Error("Expected tenant-scoped deletion to preserve the other user's portfolio");
    }
    console.log("  PASS: Tenant isolation preserved");

    console.log("\n--- All Portfolios & Edits tests passed successfully! ---");
  } catch (err) {
    console.error("\nFAIL: Integration tests failed with error:", err);
    passed = false;
  } finally {
    server.close();
    setTimeout(() => {
      process.exit(passed ? 0 : 1);
    }, 200);
  }
});
