const { CognitoJwtVerifier } = require("aws-jwt-verify");

// Configure the verifier if env variables are present.
// For local development, we allow the verifier to be undefined if bypassing auth.
let verifier;

if (process.env.COGNITO_USER_POOL_ID && process.env.COGNITO_CLIENT_ID) {
  verifier = CognitoJwtVerifier.create({
    userPoolId: process.env.COGNITO_USER_POOL_ID,
    tokenUse: "access",
    clientId: process.env.COGNITO_CLIENT_ID,
  });
}

/**
 * Express middleware to validate Cognito access JWT tokens.
 */
const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "Missing or malformed Authorization header. Expected: Bearer <token>"
    });
  }

  const token = authHeader.split(" ")[1];

  // Development-only bypass to test local route handlers without querying Cognito JWKS
  if (process.env.NODE_ENV === "development" && process.env.BYPASS_AUTH === "true") {
    req.user = {
      sub: "dev-user-12345-uuid-67890",
      email: "dev@kesahomma26.local",
      email_verified: true,
      auth_method: "bypassed"
    };
    return next();
  }

  if (!verifier) {
    console.error("Cognito JWT verifier not configured. Missing COGNITO_USER_POOL_ID or COGNITO_CLIENT_ID.");
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Authentication service configuration is incomplete."
    });
  }

  try {
    const payload = await verifier.verify(token);
    
    // Attach the validated claims to the request object
    req.user = {
      sub: payload.sub,
      email: payload.email || null,
      email_verified: payload.email_verified ?? null,
      claims: payload
    };
    
    next();
  } catch (err) {
    console.warn("JWT validation failed:", err);
    return res.status(401).json({
      error: "Unauthorized",
      message: "Token validation failed"
    });
  }
};

module.exports = { authMiddleware };
