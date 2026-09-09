process.env.PORT = "3004";
process.env.NODE_ENV = "development";
process.env.BYPASS_AUTH = "true";
process.env.MOCK_DYNAMODB = "true";

const app = require("./app");
const { clearMockDb, createDocImportJob, getDocImportJob, markPortfolioDeleting, putPortfolio, updateDocImportJob } = require("./utils/ddb");
const { clearMockDocuments, getMockDocumentCount, loadDocument, storeDocument } = require("./utils/documentStorage");
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

    // 5. Background Parser Worker Asynchronous Processing Test
    console.log("\nTest 5: Verify async background parser updates status to READY_FOR_REVIEW after delay...");
    const csvFixture = "ticker,description,quantity,costBasis\nAAPL,\"Apple, Inc.\",10,1500\nVOO,Fund,5,2000";
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

    const unreadableImport = await createDocImportJob("dev-user-12345-uuid-67890", portfolioId, {
      bucket: "mock-document-imports",
      key: "missing-document",
      originalName: "missing.csv",
      mimeType: "text/csv"
    });
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

    await markPortfolioDeleting("dev-user-12345-uuid-67890", portfolioId);
    let blockedCreateError;
    try {
      await createDocImportJob("dev-user-12345-uuid-67890", portfolioId, null, "blocked-import");
    } catch (error) {
      blockedCreateError = error;
    }
    if (blockedCreateError?.name !== "TransactionCanceledException") {
      throw new Error("Expected the deletion marker to reject new document import jobs");
    }
    const documentCountBeforeBlockedUpload = getMockDocumentCount();
    const blockedUpload = await uploadFile("blocked.csv", "ticker,quantity,costBasis\nAAPL,1,100", "text/csv");
    if (blockedUpload.status !== 409) {
      throw new Error(`Expected 409 while portfolio deletion is active, got ${blockedUpload.status}`);
    }
    if (getMockDocumentCount() !== documentCountBeforeBlockedUpload) {
      throw new Error("Expected the rejected upload to clean up its stored document");
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
