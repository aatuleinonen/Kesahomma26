process.env.PORT = "3004";
process.env.NODE_ENV = "development";
process.env.BYPASS_AUTH = "true";
process.env.MOCK_DYNAMODB = "true";
process.env.DOCUMENT_UPLOAD_MAX_BYTES = "1024";

const app = require("./app");
const { claimDocImportDispatch, clearMockDb, createDocImportJob, getDocImportJob, getPortfolioDocumentSources, getStaleUploadedDocImports, markPortfolioDeleting, putPortfolio, updateDocImportJob } = require("./utils/ddb");
const { clearMockDocuments, getMockDocumentCount, loadDocument, setMockStoreDocumentHook, storeDocument } = require("./utils/documentStorage");
const { finalizeImportFailure, handler: documentWorkerHandler, processImportMessage, requeueStaleDocumentImports } = require("./document-worker");
const zlib = require("zlib");

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const [filename, value] of Object.entries(files)) {
    const name = Buffer.from(filename);
    const content = Buffer.from(value);
    const compressed = zlib.deflateRawSync(content);
    const checksum = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034B50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014B50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    localParts.push(local, name, compressed);
    centralParts.push(central, name);
    localOffset += local.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054B50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, directory, eocd]);
}

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
    const validContents = {
      ".csv": "ticker,quantity,costBasis\nAAPL,1,100\n",
      ".pdf": Buffer.from("%PDF-1.4\n%%EOF"),
      ".xls": Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, 0, 0]),
      ".xlsx": createZip({
        "[Content_Types].xml": "<Types/>",
        "_rels/.rels": "<Relationships/>",
        "xl/workbook.xml": "<workbook/>"
      })
    };
    const uploadFile = async (filename, content = validContents[filename.slice(filename.lastIndexOf(".")).toLowerCase()] || "sample content", mimeType) => {
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

    const reviewUpload = await uploadFile("missing-cost.csv", "ticker,quantity,costBasis\nAAPL,1,", "text/csv");
    if (reviewUpload.status !== 201) {
      throw new Error(`Expected CSV with a missing optional cost basis to be accepted, got ${reviewUpload.status}`);
    }
    const reviewImportId = reviewUpload.data.job.importId;

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

    for (const filename of ["invalid.csv"]) {
      const { status, data } = await uploadFile(filename, "sample content");
      if (status !== 400 || data.status !== "error") {
        throw new Error(`Expected invalid ${filename} content to return 400, got ${status}: ${JSON.stringify(data)}`);
      }
    }
    const emptyUpload = await uploadFile("empty.csv", "", "text/csv");
    if (emptyUpload.status !== 400) throw new Error(`Expected empty upload to return 400, got ${emptyUpload.status}`);

    const jobsBeforeBoundaryTests = (await getPortfolioDocumentSources("dev-user-12345-uuid-67890", portfolioId)).length;
    const csvPrefix = "ticker,quantity,costBasis\nAAPL,1,100\n";
    const atLimitContent = csvPrefix + " ".repeat(1024 - Buffer.byteLength(csvPrefix));
    const atLimitUpload = await uploadFile("at-limit.csv", atLimitContent, "text/csv");
    if (atLimitUpload.status !== 201) throw new Error(`Expected upload at size limit to return 201, got ${atLimitUpload.status}`);

    const documentsBeforeOversize = getMockDocumentCount();
    const jobsBeforeOversize = (await getPortfolioDocumentSources("dev-user-12345-uuid-67890", portfolioId)).length;
    const oversizedUpload = await uploadFile("oversized.csv", `${atLimitContent}x`, "text/csv");
    const jobsAfterOversize = (await getPortfolioDocumentSources("dev-user-12345-uuid-67890", portfolioId)).length;
    if (oversizedUpload.status !== 413 || getMockDocumentCount() !== documentsBeforeOversize || jobsAfterOversize !== jobsBeforeOversize) {
      throw new Error("Expected oversized upload to return 413 without creating a document or import job");
    }
    if (jobsBeforeOversize !== jobsBeforeBoundaryTests + 1) {
      throw new Error("Expected the exact-limit upload to create one document import before asynchronous cleanup");
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

    let reviewJob;
    const reviewStartTime = Date.now();
    while (Date.now() - reviewStartTime < 2000) {
      const result = await getRequest(`/api/portfolios/${portfolioId}/upload/${reviewImportId}`);
      reviewJob = result.data?.job;
      if (result.status === 200 && reviewJob?.status === "READY_FOR_REVIEW") break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const missingCostHolding = reviewJob?.extractedData?.[0];
    if (reviewJob?.status !== "READY_FOR_REVIEW" || missingCostHolding?.costBasis !== null
      || !missingCostHolding?.validation?.missingFields?.includes("costBasis")) {
      throw new Error(`Expected missing cost basis to reach review with validation metadata, got: ${JSON.stringify(reviewJob)}`);
    }
    await expectSourceDeleted(reviewImportId);
    console.log("  PASS: Missing optional cost basis is surfaced for review");

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

    const undispatchedSource = await storeDocument("dev-user-12345-uuid-67890", portfolioId, "undispatched-import", {
      originalName: "undispatched.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("ticker,quantity,costBasis\nNVDA,1,100")
    });
    const undispatchedImport = await createDocImportJob("dev-user-12345-uuid-67890", portfolioId, undispatchedSource, "undispatched-import");
    const firstReconciliation = new Date(Date.now() + 5 * 60 * 1000);
    const firstCutoff = new Date(firstReconciliation.getTime() - 120 * 1000).toISOString();
    const [staleJob] = await getStaleUploadedDocImports(firstCutoff);
    if (!staleJob || !await claimDocImportDispatch(staleJob, firstReconciliation.toISOString())) {
      throw new Error("Expected the stale import to acquire a dispatch lease");
    }
    if (await claimDocImportDispatch(staleJob, firstReconciliation.toISOString())) {
      throw new Error("Expected the same stale candidate to be claimed only once");
    }
    if ((await getStaleUploadedDocImports(firstCutoff)).some(job => job.importId === undispatchedImport.importId)) {
      throw new Error("Expected the dispatch lease to suppress immediate duplicate enqueueing");
    }
    await requeueStaleDocumentImports(new Date(firstReconciliation.getTime() + 121 * 1000));
    await new Promise(resolve => setTimeout(resolve, 10));
    const reconciledJob = await getDocImportJob("dev-user-12345-uuid-67890", undispatchedImport.importId, portfolioId);
    if (reconciledJob.status !== "READY_FOR_REVIEW") {
      throw new Error(`Expected reconciliation to dispatch a stale UPLOADED job, got ${reconciledJob.status}`);
    }
    console.log("  PASS: Reconciliation dispatches stale UPLOADED jobs");

    const exhaustedSource = await storeDocument("dev-user-12345-uuid-67890", portfolioId, "exhausted-processing", {
      originalName: "exhausted.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("ticker,quantity,costBasis\nAMZN,1,100")
    });
    const exhaustedImport = await createDocImportJob("dev-user-12345-uuid-67890", portfolioId, exhaustedSource, "exhausted-processing");
    await updateDocImportJob("dev-user-12345-uuid-67890", portfolioId, exhaustedImport.importId, "PROCESSING", null, null);
    await finalizeImportFailure({ userId: "dev-user-12345-uuid-67890", portfolioId, importId: exhaustedImport.importId });
    const exhaustedJob = await getDocImportJob("dev-user-12345-uuid-67890", exhaustedImport.importId, portfolioId);
    let exhaustedSourceDeleted = false;
    try {
      await loadDocument(exhaustedSource);
    } catch {
      exhaustedSourceDeleted = true;
    }
    if (exhaustedJob.status !== "FAILED" || !exhaustedSourceDeleted) {
      throw new Error("Expected exhausted processing failures to become terminal and delete their source");
    }
    console.log("  PASS: Exhausted non-read failures become terminal and clean up their source");

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
    const cleanupPortfolioId = "portfolio-cleanup-123";
    await putPortfolio("dev-user-12345-uuid-67890", { portfolioId: cleanupPortfolioId, name: "Cleanup test" });
    const documentCountBeforeBlockedUpload = getMockDocumentCount();
    setMockStoreDocumentHook(() => markPortfolioDeleting("dev-user-12345-uuid-67890", cleanupPortfolioId));
    const cleanupFormData = new FormData();
    cleanupFormData.append("file", new Blob(["ticker,quantity,costBasis\nAAPL,1,100"], { type: "text/csv" }), "blocked.csv");
    const cleanupResponse = await fetch(`http://localhost:${PORT}/api/portfolios/${cleanupPortfolioId}/upload`, {
      method: "POST",
      headers: { "Authorization": "Bearer dummy-token" },
      body: cleanupFormData
    });
    setMockStoreDocumentHook(undefined);
    const blockedUpload = { status: cleanupResponse.status, data: await cleanupResponse.json() };
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
