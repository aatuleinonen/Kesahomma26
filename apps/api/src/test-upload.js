process.env.PORT = "3004";
process.env.NODE_ENV = "development";
process.env.BYPASS_AUTH = "true";
process.env.MOCK_DYNAMODB = "true";

const app = require("./app");
const { clearMockDb, createDocImportJob, getDocImportJob, markPortfolioDeleting, putPortfolio, updateDocImportJob } = require("./utils/ddb");
const { clearMockDocuments, loadDocument, storeDocument } = require("./utils/documentStorage");
const { handler: documentWorkerHandler, processImportMessage } = require("./document-worker");

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
    const uploadFile = async (filename, content = "sample content", mimeType) => {
      const extension = filename.slice(filename.lastIndexOf(".")).toLowerCase();
      const uploadMimeType = mimeType || {
        ".pdf": "application/pdf",
        ".csv": "text/csv",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".xls": "application/vnd.ms-excel"
      }[extension] || "application/octet-stream";
      const formData = new FormData();
      const blob = new Blob([content], { type: uploadMimeType });
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

    const expectSourceDeleted = async importId => {
      const job = await getDocImportJob("dev-user-12345-uuid-67890", importId, portfolioId);
      let readError;
      try {
        await loadDocument(job.sourceDocument);
      } catch (error) {
        readError = error;
      }
      if (readError?.message !== "Uploaded document is not available") {
        throw new Error(`Expected source document for ${importId} to be deleted`);
      }
    };

    // 1. Valid CSV uploads with MIME types commonly emitted by clients.
    console.log("Test 1: Upload CSV files with supported MIME variants...");
    const validCsvUploads = [
      ["data.csv", "text/csv"],
      ["export.csv", "application/csv"],
      ["browser.csv", "application/octet-stream"]
    ];
    let createdImportId = null;
    const csvContent = "ticker,quantity,costBasis\nMSFT,2,500";

    for (const [filename, mimeType] of validCsvUploads) {
      const { status, data } = await uploadFile(filename, csvContent, mimeType);
      if (status !== 201) {
        throw new Error(`Expected 201 Created for ${filename}, got status ${status} and data: ${JSON.stringify(data)}`);
      }
      if (!data.job?.importId || data.status !== "success" || data.job.status !== "UPLOADED") {
        throw new Error(`Expected a success response with an UPLOADED job for ${filename}, got: ${JSON.stringify(data)}`);
      }
      console.log(`  PASS: ${filename} uploaded successfully with importId: ${data.job.importId}`);
      createdImportId ||= data.job.importId;
    }

    const failedUpload = await uploadFile("missing-cost.csv", "ticker,quantity,costBasis\nAAPL,1,", "text/csv");
    if (failedUpload.status !== 201) {
      throw new Error(`Expected malformed CSV to be accepted for asynchronous validation, got ${failedUpload.status}`);
    }
    const failedImportId = failedUpload.data.job.importId;

    // 2. Invalid and unsupported file uploads.
    console.log("\nTest 2: Upload invalid files returns 400 Bad Request...");
    const invalidExtensions = ["doc.pdf", "sheet.xlsx", "legacy.xls", "script.exe", "notes.txt", "archive.zip"];

    for (const filename of invalidExtensions) {
      const { status, data } = await uploadFile(filename);
      if (status !== 400 || data.status !== "error") {
        throw new Error(`Expected 400 Bad Request for ${filename}, got status ${status} and data: ${JSON.stringify(data)}`);
      }
      console.log(`  PASS: ${filename} rejected with 400 Bad Request as expected`);
    }

    const mismatchedMime = await uploadFile("not-a-pdf.pdf", "sample content", "text/csv");
    if (mismatchedMime.status !== 400 || mismatchedMime.data.status !== "error") {
      throw new Error(`Expected 400 for mismatched filename and MIME type, got ${mismatchedMime.status}: ${JSON.stringify(mismatchedMime.data)}`);
    }
    console.log("  PASS: Mismatched filename and MIME type rejected with 400 Bad Request");

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

    let failedJob;
    const failedStartTime = Date.now();
    while (Date.now() - failedStartTime < 2000) {
      const result = await getRequest(`/api/portfolios/${portfolioId}/upload/${failedImportId}`);
      failedJob = result.data?.job;
      if (result.status === 200 && failedJob?.status === "FAILED") break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (failedJob?.status !== "FAILED" || !failedJob.error) {
      throw new Error(`Expected failed parser status to include an actionable error, got: ${JSON.stringify(failedJob)}`);
    }
    await expectSourceDeleted(failedImportId);
    console.log("  PASS: Failed parser status includes its error");

    // 4. GET Non-existent Job Returns 404
    console.log("\nTest 4: GET non-existent import job returns 404...");
    const fakeImportId = "00000000-0000-0000-0000-000000000000";
    const { status: s4, data: d4 } = await getRequest(`/api/portfolios/${portfolioId}/upload/${fakeImportId}`);
    if (s4 !== 404 || d4.status !== "error") {
      throw new Error(`Expected 404 Not Found, got status ${s4} and data: ${JSON.stringify(d4)}`);
    }
    console.log("  PASS: GET non-existent import job returned 404 as expected");

    const unreadableImport = await createDocImportJob("dev-user-12345-uuid-67890", portfolioId, {
      bucket: "mock-document-imports",
      key: "missing-document",
      originalName: "missing.csv",
      mimeType: "text/csv"
    });
    let workerReadError;
    try {
      await processImportMessage({ userId: "dev-user-12345-uuid-67890", portfolioId, importId: unreadableImport.importId });
    } catch (error) {
      workerReadError = error;
    }
    const unreadableJob = await getDocImportJob("dev-user-12345-uuid-67890", unreadableImport.importId, portfolioId);
    if (!workerReadError || unreadableJob.status !== "RETRYING" || !unreadableJob.error?.includes("will be retried")) {
      throw new Error(`Expected an unreadable source to remain in RETRYING status, got: ${JSON.stringify(unreadableJob)}`);
    }
    console.log("  PASS: Unreadable source remains in an explicit retryable state");

    // 5. Background Parser Worker Asynchronous Processing Test
    console.log("\nTest 5: Verify async background parser updates status to READY_FOR_REVIEW after delay...");
    const csvFixture = "ticker,description,quantity,costBasis\nAAPL,\"Apple, Inc.\",4,600\nAAPL,\"Apple, Inc.\",6,900\nVOO,Fund,5,2000";
    const { status: s5Post, data: d5Post } = await uploadFile("portfolio_import.csv", csvFixture, "text/csv");
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
    await expectSourceDeleted(asyncImportId);
    console.log(`  PASS: Background worker updated status to READY_FOR_REVIEW with ${d5Get.job.extractedData.length} holdings`);

    const { status: wrongPortfolioStatus } = await getRequest(`/api/portfolios/wrong-portfolio/upload/${asyncImportId}`);
    if (wrongPortfolioStatus !== 404) {
      throw new Error(`Expected 404 for a mismatched portfolio, got ${wrongPortfolioStatus}`);
    }
    console.log("  PASS: Mismatched portfolio cannot read the import job");

    // 6. Confirm Document Import Test
    console.log("\nTest 6: Confirm document import job and prevent double-imports...");
    const resConfirm1 = await fetch(`http://localhost:${PORT}/api/portfolios/${portfolioId}/upload/${asyncImportId}/confirm`, {
      method: "POST",
      headers: {
        "Authorization": "Bearer dummy-token"
      }
    });
    const dConfirm1 = await resConfirm1.json();
    if (resConfirm1.status !== 200 || dConfirm1.status !== "success") {
      throw new Error(`Expected 200 OK for confirm, got status ${resConfirm1.status} and data: ${JSON.stringify(dConfirm1)}`);
    }
    if (dConfirm1.importedCount !== 2) {
      throw new Error(`Expected duplicate tickers to be aggregated into 2 transactions, got: ${JSON.stringify(dConfirm1)}`);
    }
    console.log("  PASS: Confirm endpoint returned 200 OK");

    const { status: holdingsStatus, data: holdingsData } = await getRequest(`/api/portfolios/${portfolioId}/holdings`);
    if (holdingsStatus !== 200 || holdingsData.holdings?.AAPL !== 10 || holdingsData.holdings?.VOO !== 5 || holdingsData.cashBalance !== 0) {
      throw new Error(`Expected confirmed imports to appear in portfolio holdings without changing cash, got: ${JSON.stringify(holdingsData)}`);
    }
    console.log("  PASS: Confirmed import is visible in canonical portfolio holdings");

    const { status: s6Get, data: d6Get } = await getRequest(`/api/portfolios/${portfolioId}/upload/${asyncImportId}`);
    if (s6Get !== 200 || d6Get?.job?.status !== "COMPLETED") {
      throw new Error(`Expected status to be COMPLETED after confirm, got status ${s6Get} and data: ${JSON.stringify(d6Get)}`);
    }
    console.log("  PASS: Job status verified as COMPLETED");

    const resConfirm2 = await fetch(`http://localhost:${PORT}/api/portfolios/${portfolioId}/upload/${asyncImportId}/confirm`, {
      method: "POST",
      headers: {
        "Authorization": "Bearer dummy-token"
      }
    });
    const dConfirm2 = await resConfirm2.json();
    if (resConfirm2.status !== 400 || dConfirm2.status !== "error") {
      throw new Error(`Expected 400 Bad Request on second confirm call, got status ${resConfirm2.status} and data: ${JSON.stringify(dConfirm2)}`);
    }
    const { data: holdingsAfterRetry } = await getRequest(`/api/portfolios/${portfolioId}/holdings`);
    if (holdingsAfterRetry.holdings?.AAPL !== 10 || holdingsAfterRetry.holdings?.VOO !== 5) {
      throw new Error(`Expected a second confirmation attempt not to alter holdings, got: ${JSON.stringify(holdingsAfterRetry)}`);
    }
    console.log("  PASS: Double-import attempt rejected with 400 Bad Request");

    const emptyImport = await createDocImportJob("dev-user-12345-uuid-67890", portfolioId);
    await updateDocImportJob("dev-user-12345-uuid-67890", portfolioId, emptyImport.importId, "PROCESSING", null, null);
    await updateDocImportJob("dev-user-12345-uuid-67890", portfolioId, emptyImport.importId, "READY_FOR_REVIEW", [], null);
    const emptyConfirm = await fetch(`http://localhost:${PORT}/api/portfolios/${portfolioId}/upload/${emptyImport.importId}/confirm`, {
      method: "POST",
      headers: { "Authorization": "Bearer dummy-token" }
    });
    if (emptyConfirm.status !== 400) {
      throw new Error(`Expected 400 when confirming an empty extraction, got ${emptyConfirm.status}`);
    }
    console.log("  PASS: Empty extraction cannot be confirmed");

    const invalidImport = await createDocImportJob("dev-user-12345-uuid-67890", portfolioId);
    await updateDocImportJob("dev-user-12345-uuid-67890", portfolioId, invalidImport.importId, "PROCESSING", null, null);
    await updateDocImportJob("dev-user-12345-uuid-67890", portfolioId, invalidImport.importId, "READY_FOR_REVIEW", [
      { ticker: "BROKEN", quantity: 2, costBasis: null }
    ], null);
    const invalidConfirm = await fetch(`http://localhost:${PORT}/api/portfolios/${portfolioId}/upload/${invalidImport.importId}/confirm`, {
      method: "POST",
      headers: { "Authorization": "Bearer dummy-token" }
    });
    if (invalidConfirm.status !== 400) {
      throw new Error(`Expected 400 for malformed extracted numeric values, got ${invalidConfirm.status}`);
    }
    console.log("  PASS: Malformed extracted numeric values cannot be confirmed");
    const finalAttemptResult = await documentWorkerHandler({ Records: [{
      messageId: "final-read-attempt",
      body: JSON.stringify({ userId: "dev-user-12345-uuid-67890", portfolioId, importId: unreadableImport.importId }),
      attributes: { ApproximateReceiveCount: "3" }
    }] });
    const finalAttemptJob = await getDocImportJob("dev-user-12345-uuid-67890", unreadableImport.importId, portfolioId);
    if (finalAttemptResult.batchItemFailures.length !== 0 || finalAttemptJob.status !== "FAILED") {
      throw new Error(`Expected the final read attempt to become terminal, got: ${JSON.stringify(finalAttemptJob)}`);
    }
    console.log("  PASS: Final SQS read failure becomes terminal instead of stalling in RETRYING");

    const resumedSource = await storeDocument("dev-user-12345-uuid-67890", portfolioId, "resumed-processing", {
      originalName: "resumed.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("ticker,quantity,costBasis\nMSFT,1,100")
    });
    const resumedImport = await createDocImportJob("dev-user-12345-uuid-67890", portfolioId, resumedSource, "resumed-processing");
    await updateDocImportJob("dev-user-12345-uuid-67890", portfolioId, resumedImport.importId, "PROCESSING", null, null);
    await processImportMessage({ userId: "dev-user-12345-uuid-67890", portfolioId, importId: resumedImport.importId });
    const resumedJob = await getDocImportJob("dev-user-12345-uuid-67890", resumedImport.importId, portfolioId);
    if (resumedJob.status !== "READY_FOR_REVIEW") {
      throw new Error(`Expected a redelivered PROCESSING job to resume, got ${resumedJob.status}`);
    }
    console.log("  PASS: A redelivered PROCESSING job resumes idempotently");

    const deletingImport = await createDocImportJob("dev-user-12345-uuid-67890", portfolioId);
    await updateDocImportJob("dev-user-12345-uuid-67890", portfolioId, deletingImport.importId, "PROCESSING", null, null);
    await updateDocImportJob("dev-user-12345-uuid-67890", portfolioId, deletingImport.importId, "READY_FOR_REVIEW", [
      { ticker: "RACE", quantity: 1, costBasis: 10 }
    ], null);
    await markPortfolioDeleting("dev-user-12345-uuid-67890", portfolioId);
    const deletingConfirm = await fetch(`http://localhost:${PORT}/api/portfolios/${portfolioId}/upload/${deletingImport.importId}/confirm`, {
      method: "POST",
      headers: { "Authorization": "Bearer dummy-token" }
    });
    const { data: holdingsAfterDeletingConfirm } = await getRequest(`/api/portfolios/${portfolioId}/holdings`);
    if (deletingConfirm.status !== 409 || holdingsAfterDeletingConfirm.holdings?.RACE) {
      throw new Error("Expected portfolio deletion to prevent a racing import confirmation");
    }
    console.log("  PASS: Portfolio deletion marker blocks import confirmation atomically");

    let blockedCreateError;
    try {
      await createDocImportJob("dev-user-12345-uuid-67890", portfolioId, null, "blocked-import");
    } catch (error) {
      blockedCreateError = error;
    }
    if (blockedCreateError?.name !== "TransactionCanceledException") {
      throw new Error("Expected the deletion marker to reject new document import jobs");
    }
    const blockedUpload = await uploadFile("blocked.csv", "ticker,quantity,costBasis\nAAPL,1,100", "text/csv");
    if (blockedUpload.status !== 409) {
      throw new Error(`Expected 409 while portfolio deletion is active, got ${blockedUpload.status}`);
    }
    console.log("  PASS: Portfolio deletion marker blocks new imports");

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
