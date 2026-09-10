process.env.PORT = "3004";
process.env.NODE_ENV = "development";
process.env.BYPASS_AUTH = "true";
process.env.MOCK_DYNAMODB = "true";
process.env.DOCUMENT_UPLOAD_MAX_BYTES = "1024";

const app = require("./app");
const { clearMockDb, createDocImportJob, getPortfolioDocumentSources, markPortfolioDeleting, putPortfolio } = require("./utils/ddb");
const { clearMockDocuments, getMockDocumentCount, setMockStoreDocumentHook } = require("./utils/documentStorage");
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
    const uploadFile = async (filename, content = validContents[filename.slice(filename.lastIndexOf(".")).toLowerCase()] || "sample content", mimeType = "application/octet-stream") => {
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

    for (const filename of validExtensions) {
      const { status, data } = await uploadFile(filename, "sample content");
      if (status !== 400 || data.status !== "error") {
        throw new Error(`Expected invalid ${filename} content to return 400, got ${status}: ${JSON.stringify(data)}`);
      }
    }
    const emptyUpload = await uploadFile("empty.csv", "", "text/csv");
    if (emptyUpload.status !== 400) throw new Error(`Expected empty upload to return 400, got ${emptyUpload.status}`);

    const documentsBeforeBoundaryTests = getMockDocumentCount();
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
    if (documentsBeforeOversize !== documentsBeforeBoundaryTests + 1 || jobsBeforeOversize !== jobsBeforeBoundaryTests + 1) {
      throw new Error("Expected the exact-limit upload to create one document import");
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
    if (!d3.job || d3.job.importId !== createdImportId || d3.job.status !== "UPLOADED" || d3.job.type !== "document_import") {
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
