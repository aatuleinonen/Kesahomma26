require("dotenv").config();
const express = require("express");
const { authMiddleware } = require("./middleware/auth");
const { getUserId, buildIsolatedQueryParams } = require("./utils/db");
const { putTransaction, getTransactions, getPortfolios, putPortfolio, deleteTransaction, updateTransaction } = require("./utils/ddb");
const { validateNewTransaction, calculatePortfolioState, validateTransactionsState } = require("./utils/transactions");


const app = express();
app.use(express.json());

// Public Route (Accessible to all)
app.get("/api/public", (req, res) => {
  res.json({
    status: "success",
    message: "Hello! This is a public endpoint that does not require authentication."
  });
});

// Private Route (Requires Cognito Authorization token)
app.get("/api/private", authMiddleware, (req, res) => {
  res.json({
    status: "success",
    message: "Authorized! You have accessed a secure private endpoint.",
    user: {
      id: req.user.sub,
      email: req.user.email,
      email_verified: req.user.email_verified,
      auth_method: req.user.auth_method || "cognito"
    }
  });
});

// Private Route demonstrating user-level data isolation parameters
app.get("/api/user-data", authMiddleware, (req, res) => {
  try {
    const userId = getUserId(req);
    const isolatedParams = buildIsolatedQueryParams(req, "UserTasksTable", {
      ProjectionExpression: "taskId, title, taskStatus"
    });

    res.json({
      status: "success",
      userId,
      message: "Data isolation parameters generated successfully.",
      debugParams: isolatedParams
    });
  } catch (err) {
    const statusCode = typeof err?.message === "string" && err.message.startsWith("Unauthorized") ? 401 : 400;
    res.status(statusCode).json({
      status: "error",
      message: err.message
    });
  }
});

// Create a transaction for a specific portfolio
app.post("/api/portfolios/:portfolioId/transactions", authMiddleware, async (req, res) => {
  try {
    const userId = getUserId(req);
    const { portfolioId } = req.params;
    const { type, ticker, quantity, price, amount, timestamp } = req.body;

    const newTxn = {
      type,
      ticker,
      quantity: quantity !== undefined ? parseFloat(quantity) : undefined,
      price: price !== undefined ? parseFloat(price) : undefined,
      amount: amount !== undefined ? parseFloat(amount) : undefined,
      timestamp: timestamp || new Date().toISOString()
    };

    // Retrieve existing transactions to calculate balances and validate
    const existingTxns = await getTransactions(userId, portfolioId);
    
    // Validate the new transaction
    const validation = validateNewTransaction(newTxn, existingTxns);
    if (!validation.valid) {
      return res.status(400).json({
        status: "error",
        message: validation.error
      });
    }

    // Save to database
    const savedTxn = await putTransaction(userId, portfolioId, newTxn);

    res.status(201).json({
      status: "success",
      transaction: savedTxn
    });
  } catch (err) {
    const statusCode =
      typeof err?.message === "string" && err.message.startsWith("Unauthorized") ? 401 : 500;

    res.status(statusCode).json({
      status: "error",
      message: statusCode === 500 ? "Internal Server Error" : err.message
    });
  }
});

// List all transactions for a specific portfolio
app.get("/api/portfolios/:portfolioId/transactions", authMiddleware, async (req, res) => {
  try {
    const userId = getUserId(req);
    const { portfolioId } = req.params;

    const transactions = await getTransactions(userId, portfolioId);

    res.json({
      status: "success",
      transactions
    });
  } catch (err) {
    const statusCode =
      typeof err?.message === "string" && err.message.startsWith("Unauthorized") ? 401 : 500;

    res.status(statusCode).json({
      status: "error",
      message: statusCode === 500 ? "Internal Server Error" : err.message
    });
  }
});

// Derive holdings and cash balance for a specific portfolio
app.get("/api/portfolios/:portfolioId/holdings", authMiddleware, async (req, res) => {
  try {
    const userId = getUserId(req);
    const { portfolioId } = req.params;

    const transactions = await getTransactions(userId, portfolioId);
    const portfolioState = calculatePortfolioState(transactions);

    res.json({
      status: "success",
      portfolioId,
      cashBalance: portfolioState.cashBalance,
      holdings: portfolioState.holdings
    });
  } catch (err) {
    const statusCode =
      typeof err?.message === "string" && err.message.startsWith("Unauthorized") ? 401 : 500;

    res.status(statusCode).json({
      status: "error",
      message: statusCode === 500 ? "Internal Server Error" : err.message
    });
  }
});

// Get all portfolios for a user
app.get("/api/portfolios", authMiddleware, async (req, res) => {
  try {
    const userId = getUserId(req);
    const portfolios = await getPortfolios(userId);
    res.json({
      status: "success",
      portfolios
    });
  } catch (err) {
    const statusCode =
      typeof err?.message === "string" && err.message.startsWith("Unauthorized") ? 401 : 500;

    res.status(statusCode).json({
      status: "error",
      message: statusCode === 500 ? "Internal Server Error" : err.message
    });
  }
});

// Create a new portfolio
app.post("/api/portfolios", authMiddleware, async (req, res) => {
  try {
    const userId = getUserId(req);
    const { portfolioId, name, description, baseCurrency, costBasisMethod } = req.body;

    if (!portfolioId || !name) {
      return res.status(400).json({
        status: "error",
        message: "portfolioId and name are required fields"
      });
    }

    const portfolio = {
      portfolioId,
      name,
      description: description || "",
      baseCurrency: baseCurrency || "EUR",
      costBasisMethod: costBasisMethod || "FIFO"
    };

    const savedPortfolio = await putPortfolio(userId, portfolio);
    res.status(201).json({
      status: "success",
      portfolio: savedPortfolio
    });
  } catch (err) {
    const statusCode =
      typeof err?.message === "string" && err.message.startsWith("Unauthorized") ? 401 : 500;

    res.status(statusCode).json({
      status: "error",
      message: statusCode === 500 ? "Internal Server Error" : err.message
    });
  }
});

// Update a transaction
app.put("/api/portfolios/:portfolioId/transactions/:timestamp", authMiddleware, async (req, res) => {
  try {
    const userId = getUserId(req);
    const { portfolioId, timestamp: oldTimestamp } = req.params;
    const { type, ticker, quantity, price, amount, timestamp: newTimestamp } = req.body;

    const updatedTxn = {
      type,
      ticker,
      quantity: quantity !== undefined ? parseFloat(quantity) : undefined,
      price: price !== undefined ? parseFloat(price) : undefined,
      amount: amount !== undefined ? parseFloat(amount) : undefined,
      timestamp: newTimestamp || oldTimestamp
    };

    // Retrieve all existing transactions for this portfolio
    const existingTxns = await getTransactions(userId, portfolioId);
    
    // Filter out the old transaction to simulate state after update
    const filteredTxns = existingTxns.filter(t => t.timestamp !== oldTimestamp);
    
    // Validate updated transaction locally (like validation on add)
    const validation = validateNewTransaction(updatedTxn, filteredTxns);
    if (!validation.valid) {
      return res.status(400).json({
        status: "error",
        message: validation.error
      });
    }

    // Check chronologically if updated state is valid
    const combinedTxns = [...filteredTxns, updatedTxn];
    const ledgerValidation = validateTransactionsState(combinedTxns);
    if (!ledgerValidation.valid) {
      return res.status(400).json({
        status: "error",
        message: ledgerValidation.error
      });
    }

    // Update in database
    const savedTxn = await updateTransaction(userId, portfolioId, oldTimestamp, updatedTxn);

    res.json({
      status: "success",
      transaction: savedTxn
    });
  } catch (err) {
    const statusCode =
      typeof err?.message === "string" && err.message.startsWith("Unauthorized") ? 401 : 500;

    res.status(statusCode).json({
      status: "error",
      message: statusCode === 500 ? "Internal Server Error" : err.message
    });
  }
});

// Delete a transaction
app.delete("/api/portfolios/:portfolioId/transactions/:timestamp", authMiddleware, async (req, res) => {
  try {
    const userId = getUserId(req);
    const { portfolioId, timestamp } = req.params;

    // Retrieve existing transactions
    const existingTxns = await getTransactions(userId, portfolioId);

    // Check if transaction exists
    const exists = existingTxns.some(t => t.timestamp === timestamp);
    if (!exists) {
      return res.status(404).json({
        status: "error",
        message: "Transaction not found"
      });
    }

    // Filter out this transaction
    const remainingTxns = existingTxns.filter(t => t.timestamp !== timestamp);

    // Validate remaining sequence chronologically
    const ledgerValidation = validateTransactionsState(remainingTxns);
    if (!ledgerValidation.valid) {
      return res.status(400).json({
        status: "error",
        message: `Cannot delete transaction. ${ledgerValidation.error}`
      });
    }

    // Delete from database
    await deleteTransaction(userId, portfolioId, timestamp);

    res.json({
      status: "success",
      message: "Transaction deleted successfully"
    });
  } catch (err) {
    const statusCode =
      typeof err?.message === "string" && err.message.startsWith("Unauthorized") ? 401 : 500;

    res.status(statusCode).json({
      status: "error",
      message: statusCode === 500 ? "Internal Server Error" : err.message
    });
  }
});

const PORT = process.env.PORT || 3000;
// Only start listening if run directly (useful if we want to run unit tests on app later)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`API Server running in ${process.env.NODE_ENV || "production"} mode on port ${PORT}`);
  });
}

module.exports = app;
