require("dotenv").config();
const express = require("express");
const { authMiddleware } = require("./middleware/auth");
const { getUserId, buildIsolatedQueryParams } = require("./utils/db");


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

const PORT = process.env.PORT || 3000;
// Only start listening if run directly (useful if we want to run unit tests on app later)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`API Server running in ${process.env.NODE_ENV || "production"} mode on port ${PORT}`);
  });
}

module.exports = app;
