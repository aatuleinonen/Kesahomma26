process.env.PORT = "3003";
process.env.NODE_ENV = "development";
process.env.BYPASS_AUTH = "true";
process.env.MOCK_DYNAMODB = "true";

const app = require("./app");
const { clearMockDb } = require("./utils/ddb");

const PORT = Number(process.env.PORT || 3003);
const server = app.listen(PORT, async () => {
  console.log(`Analysis Test Server running on port ${PORT}`);
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

    console.log("\n--- Executing Asynchronous AI Analysis Job API Tests ---");

    // 1. Submit analysis job
    console.log("Test 1: Create analysis job...");
    const { status: s1, data: d1 } = await apiRequest("/api/portfolios/portfolio-123/analysis", "POST");
    if (s1 !== 202) {
      throw new Error(`Expected 202 Accepted, got status ${s1} and data: ${JSON.stringify(d1)}`);
    }
    if (!d1.jobId || d1.status !== "PENDING") {
      throw new Error(`Expected response to contain jobId and status PENDING, got: ${JSON.stringify(d1)}`);
    }
    console.log(`  PASS: Job created successfully with jobId: ${d1.jobId}`);

    const createdJobId = d1.jobId;

    // 2. Fetch the created job
    console.log("Test 2: Retrieve the created job status...");
    const { status: s2, data: d2 } = await apiRequest(`/api/analysis/jobs/${createdJobId}`);
    if (s2 !== 200 || d2.status !== "success") {
      throw new Error(`Expected 200 OK and success status, got status ${s2} and data: ${JSON.stringify(d2)}`);
    }
    if (!d2.job || d2.job.jobId !== createdJobId || d2.job.status !== "PENDING" || d2.job.portfolioId !== "portfolio-123") {
      throw new Error(`Expected retrieved job to match created job details, got: ${JSON.stringify(d2)}`);
    }
    console.log("  PASS: Job retrieved successfully with status PENDING and correct details");

    // 3. Fetch a non-existent job to verify 404
    console.log("Test 3: Fetch non-existent job returns 404...");
    const nonExistentJobId = "00000000-0000-0000-0000-000000000000";
    const { status: s3, data: d3 } = await apiRequest(`/api/analysis/jobs/${nonExistentJobId}`);
    if (s3 !== 404 || d3.status !== "error" || d3.message !== "Job not found") {
      throw new Error(`Expected 404 Job not found, got status ${s3} and data: ${JSON.stringify(d3)}`);
    }
    console.log("  PASS: Non-existent job returned 404 correctly");

    // 4. Verify background worker asynchronous flow (delay)
    console.log("Test 4: Verify async background worker updates status to COMPLETED after delay...");
    const { status: s4, data: d4 } = await apiRequest("/api/portfolios/portfolio-abc/analysis", "POST");
    if (s4 !== 202) {
      throw new Error(`Expected 202 Accepted, got status ${s4}`);
    }
    const asyncJobId = d4.jobId;
    console.log(`  Created async job with jobId: ${asyncJobId}. Waiting 2.5 seconds...`);

    // Verify it is initially PENDING
    const { data: checkPending } = await apiRequest(`/api/analysis/jobs/${asyncJobId}`);
    if (checkPending.job.status !== "PENDING") {
      throw new Error(`Expected job to be PENDING initially, got: ${checkPending.job.status}`);
    }

    // Wait for the background worker to finish (delay is 2000ms, we wait 2500ms)
    await new Promise(resolve => setTimeout(resolve, 2500));

    // Retrieve again and verify it is COMPLETED
    const { status: s4Get, data: d4Get } = await apiRequest(`/api/analysis/jobs/${asyncJobId}`);
    if (s4Get !== 200 || d4Get.status !== "success") {
      throw new Error(`Expected 200 OK, got status ${s4Get} and data: ${JSON.stringify(d4Get)}`);
    }
    if (d4Get.job.status !== "COMPLETED") {
      throw new Error(`Expected job status to be COMPLETED after 2.5 seconds, got: ${d4Get.job.status}`);
    }
    if (!d4Get.job.result || d4Get.job.result.riskLevel !== "Moderate" || d4Get.job.result.diversificationScore !== 85) {
      throw new Error(`Expected valid result object, got: ${JSON.stringify(d4Get.job.result)}`);
    }
    console.log("  PASS: Asynchronous background worker transitioned job to COMPLETED with correct results");

    console.log("\n--- All Analysis API tests passed! ---");
  } catch (err) {
    console.error("\nFAIL: Analysis API integration tests failed with error:", err);
    passed = false;
  } finally {
    server.close();
    setTimeout(() => {
      process.exit(passed ? 0 : 1);
    }, 200);
  }
});
