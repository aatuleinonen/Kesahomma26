process.env.NODE_ENV = process.env.NODE_ENV || "development";
process.env.BYPASS_AUTH = process.env.BYPASS_AUTH || "true";

const app = require("./app");
  console.log(`Test server running on port ${PORT}`);
  
  let passed = true;

  try {
    // 1. Test public endpoint
    const resPublic = await fetch(`http://localhost:${PORT}/api/public`, {
      headers: { Connection: "close" }
    });
    const jsonPublic = await resPublic.json();
    console.log("Public Endpoint Response:", jsonPublic);
    if (resPublic.status !== 200 || jsonPublic.status !== "success") {
      console.error("FAIL: Public endpoint returned unexpected status or response");
      passed = false;
    }

    // 2. Test private endpoint without Authorization header
    const resPrivateNoAuth = await fetch(`http://localhost:${PORT}/api/private`, {
      headers: { Connection: "close" }
    });
    const jsonPrivateNoAuth = await resPrivateNoAuth.json();
    console.log("Private Endpoint (No Auth) Response:", jsonPrivateNoAuth);
    if (resPrivateNoAuth.status !== 401 || jsonPrivateNoAuth.error !== "Unauthorized") {
      console.error("FAIL: Private endpoint did not reject request with 401");
      passed = false;
    }

    // 3. Test private endpoint with invalid Authorization header format
    const resPrivateBadAuth = await fetch(`http://localhost:${PORT}/api/private`, {
      headers: {
        "Authorization": "BadTokenFormat",
        "Connection": "close"
      }
    });
    const jsonPrivateBadAuth = await resPrivateBadAuth.json();
    console.log("Private Endpoint (Bad Auth) Response:", jsonPrivateBadAuth);
    if (resPrivateBadAuth.status !== 401 || jsonPrivateBadAuth.error !== "Unauthorized") {
      console.error("FAIL: Private endpoint did not reject malformed auth header");
      passed = false;
    }

    // 4. Test private endpoint with valid Authorization header (bypassed in dev mode)
    const resPrivateSuccess = await fetch(`http://localhost:${PORT}/api/private`, {
      headers: {
        "Authorization": "Bearer dummy-token",
        "Connection": "close"
      }
    });
    const jsonPrivateSuccess = await resPrivateSuccess.json();
    console.log("Private Endpoint (Success) Response:", jsonPrivateSuccess);
    if (resPrivateSuccess.status !== 200 || jsonPrivateSuccess.user.email !== "dev@kesahomma26.local") {
      console.error("FAIL: Private endpoint did not accept mock token with bypass");
      passed = false;
    }

    // 5. Test private endpoint with data isolation checks
    const resUserData = await fetch(`http://localhost:${PORT}/api/user-data`, {
      headers: {
        "Authorization": "Bearer dummy-token",
        "Connection": "close"
      }
    });
    const jsonUserData = await resUserData.json();
    console.log("User Data Isolated Endpoint Response:", jsonUserData);
    if (resUserData.status !== 200 || jsonUserData.userId !== "dev-user-12345-uuid-67890" || jsonUserData.debugParams.ExpressionAttributeValues[":userId"] !== "dev-user-12345-uuid-67890") {
      console.error("FAIL: Isolated user data endpoint returned invalid user ID or db query params");
      passed = false;
    }

  } catch (err) {
    console.error("Test execution encountered an error:", err);
    passed = false;
  } finally {
    server.close();
    setTimeout(() => {
      process.exit(passed ? 0 : 1);
    }, 200);
  }
});
