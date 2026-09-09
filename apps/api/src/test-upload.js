process.env.PORT = "3004";
process.env.NODE_ENV = "development";
process.env.BYPASS_AUTH = "true";
process.env.MOCK_DYNAMODB = "true";

const app = require("./app");
const { clearMockDb, putPortfolio } = require("./utils/ddb");
const { clearMockDocuments } = require("./utils/documentStorage");

const PORT = Number(process.env.PORT || 3004);
const server = app.listen(PORT, async () => {
  console.log(`Upload Test Server running on port ${PORT}`);
  let passed = true;

  try {
    clearMockDb();
    clearMockDocuments();

    console.log("\n--- Executing Document Upload API Integration Tests ---");

    const portfolioId = "portfolio-upload-123";
    await putPortfolio("dev-user-12345-uuid-67890", { portfolioId, name: "Upload test" });

    // Helper to perform multipart upload
    const uploadFile = async (filename, content = "sample content", mimeType = "text/plain") => {
      const formData = new FormData();
      const blob = new Blob([content], { type: mimeType });
      formData.append("file", blob, filename);

      const res = await fetch(`http://localhost:${PORT}/api/portfolios/${portfolioId}/upload`, {
        method: "POST",
        headers: {
          "Authorization": "Bearer dummy-token"
        },
        body: formData
      });
      const data = await res.json();
      return { status: res.status, data };
    };

    // Helper for GET requests
    const getRequest = async (path) => {
      const res = await fetch(`http://localhost:${PORT}${path}`, {
        method: "GET",
        headers: {
          "Authorization": "Bearer dummy-token",
          "Connection": "close"
        }
      });
      const data = await res.json();
      return { status: res.status, data };
    };

    // 1. Valid File Upload Tests (.pdf, .csv, .xlsx, .xls)
    console.log("Test 1: Upload valid files (.pdf, .csv, .xlsx, .xls)...");
    const validExtensions = ["doc.pdf", "data.csv", "sheet.xlsx", "legacy.xls"];
    let createdImportId = null;

    for (const filename of validExtensions) {
      const { status, data } = await uploadFile(filename);
      if (status !== 201) {
        throw new Error(`Expected 201 Created for ${filename}, got status ${status} and data: ${JSON.stringify(data)}`);
      }
      if (!data.job?.importId || data.status !== "success" || data.job.status !== "UPLOADED") {
        throw new Error(`Expected a success response with an UPLOADED job for ${filename}, got: ${JSON.stringify(data)}`);
      }
      console.log(`  PASS: ${filename} uploaded successfully with importId: ${data.job.importId}`);
      createdImportId = data.job.importId;
    }

    // 2. Invalid File Upload Tests (.txt, .exe, no file)
    console.log("\nTest 2: Upload invalid files returns 400 Bad Request...");
    const invalidExtensions = ["script.exe", "notes.txt", "archive.zip"];

    for (const filename of invalidExtensions) {
      const { status, data } = await uploadFile(filename);
      if (status !== 400 || data.status !== "error") {
        throw new Error(`Expected 400 Bad Request for ${filename}, got status ${status} and data: ${JSON.stringify(data)}`);
      }
      console.log(`  PASS: ${filename} rejected with 400 Bad Request as expected`);
    }

    // Test upload with no file
    const resNoFile = await fetch(`http://localhost:${PORT}/api/portfolios/${portfolioId}/upload`, {
      method: "POST",
      headers: {
        "Authorization": "Bearer dummy-token"
      }
    });
    if (resNoFile.status !== 400) {
      throw new Error(`Expected 400 Bad Request for upload with no file, got status ${resNoFile.status}`);
    }
    console.log("  PASS: Upload with no file rejected with 400 Bad Request");

    // 3. GET Status Tests
    console.log("\nTest 3: Checking status via GET route...");
    const { status: s3, data: d3 } = await getRequest(`/api/portfolios/${portfolioId}/upload/${createdImportId}`);
    if (s3 !== 200 || d3.status !== "success") {
      throw new Error(`Expected 200 OK and status success, got status ${s3} and data: ${JSON.stringify(d3)}`);
    }
    if (!d3.job || d3.job.importId !== createdImportId || !["UPLOADED", "PROCESSING", "READY_FOR_REVIEW"].includes(d3.job.status) || d3.job.type !== "document_import") {
      throw new Error(`Expected job details to match uploaded job, got: ${JSON.stringify(d3)}`);
    }
    console.log(`  PASS: GET status verified cleanly for importId ${createdImportId}`);

    // 4. GET Non-existent Job Returns 404
    console.log("\nTest 4: GET non-existent import job returns 404...");
    const fakeImportId = "00000000-0000-0000-0000-000000000000";
    const { status: s4, data: d4 } = await getRequest(`/api/portfolios/${portfolioId}/upload/${fakeImportId}`);
    if (s4 !== 404 || d4.status !== "error") {
      throw new Error(`Expected 404 Not Found, got status ${s4} and data: ${JSON.stringify(d4)}`);
    }
    console.log("  PASS: GET non-existent import job returned 404 as expected");

    // 5. Background Parser Worker Asynchronous Processing Test
    console.log("\nTest 5: Verify async background parser updates status to READY_FOR_REVIEW after delay...");
    const { status: s5Post, data: d5Post } = await uploadFile("portfolio_import.pdf");
    if (s5Post !== 201 || d5Post.status !== "success" || d5Post.job?.status !== "UPLOADED") {
      throw new Error(`Expected 201 with an UPLOADED job for test 5, got status ${s5Post} and data: ${JSON.stringify(d5Post)}`);
    }
    const asyncImportId = d5Post.job.importId;
    console.log(`  Created async import job ${asyncImportId}. Waiting for background worker...`);

    const startTime = Date.now();
    let s5Get = 0;
    let d5Get = null;
    while (Date.now() - startTime < 7000) {
      ({ status: s5Get, data: d5Get } = await getRequest(`/api/portfolios/${portfolioId}/upload/${asyncImportId}`));
      if (s5Get === 200 && d5Get?.job?.status === "READY_FOR_REVIEW") break;
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    if (s5Get !== 200 || d5Get.status !== "success") {
      throw new Error(`Expected 200 OK for status get, got ${s5Get} and data: ${JSON.stringify(d5Get)}`);
    }
    if (!d5Get.job || d5Get.job.status !== "READY_FOR_REVIEW") {
      throw new Error(`Expected job status to transition to READY_FOR_REVIEW within 7s, got: ${d5Get?.job?.status}`);
    }
    if (!Array.isArray(d5Get.job.extractedData) || d5Get.job.extractedData.length === 0) {
      throw new Error(`Expected extractedData array with holdings, got: ${JSON.stringify(d5Get?.job?.extractedData)}`);
    }
    console.log(`  PASS: Background worker updated status to READY_FOR_REVIEW with ${d5Get.job.extractedData.length} holdings`);

    console.log("\n--- All Document Upload API integration tests passed! ---");

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
