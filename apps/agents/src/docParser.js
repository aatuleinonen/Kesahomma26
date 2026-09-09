const path = require("path");
const { parse } = require("csv-parse/sync");

const maxReviewPayloadBytes = 300 * 1024;

/**
 * Extracts reviewed holdings from a persisted CSV document.
 * 
 * @param {string} userId - Cognito User ID (sub)
 * @param {string} portfolioId - Portfolio ID
 * @param {string} importId - Document Import Job ID (UUID)
 * @param {{buffer: Buffer, metadata: object}} document - Uploaded document bytes and metadata.
 * @param {function} updateJobStatus - Injected callback function to persist job status changes
 */
async function processDocumentImport(userId, portfolioId, importId, document, updateJobStatus) {
  console.log(`[DocParser] Picked up document import job ${importId}`);
  await updateJobStatus("PROCESSING", null, null);

  let extracted;
  try {
    if (!Buffer.isBuffer(document?.buffer)) {
      throw new Error("Document import is missing uploaded file bytes");
    }
    console.log(`[DocParser] Processing document import job ${importId} (${document.buffer.length} bytes)`);

    if (document.buffer.length === 0) throw new Error("Uploaded document is empty");
    if (path.extname(document.metadata?.originalName || "").toLowerCase() !== ".csv") {
      throw new Error("This document format is not yet supported for extraction; upload a UTF-8 CSV file");
    }

    const rows = parse(document.buffer, {
      bom: true,
      columns: headers => headers.map(value => value.trim().toLowerCase()),
      skip_empty_lines: true,
      trim: true
    });
    extracted = rows.map((row, index) => {
      const tickerValue = row.ticker ?? row.symbol;
      const quantityValue = row.quantity;
      const costBasisValue = row.costbasis ?? row.cost_basis;
      const ticker = String(tickerValue ?? "").trim();
      if (String(quantityValue ?? "").trim() === "" || String(costBasisValue ?? "").trim() === "") {
        throw new Error(`CSV row ${index + 2} is missing quantity or cost basis`);
      }
      const quantity = Number(quantityValue);
      const costBasis = Number(costBasisValue);
      if (!ticker || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(costBasis) || costBasis < 0) {
        throw new Error(`CSV row ${index + 2} contains invalid holding values`);
      }
      return { ticker, quantity, costBasis };
    });
    if (extracted.length === 0) throw new Error("CSV does not contain any holdings");
    if (Buffer.byteLength(JSON.stringify(extracted), "utf8") > maxReviewPayloadBytes) {
      throw new Error("CSV contains too much review data; split it into smaller files");
    }
  } catch (error) {
    console.error(`[DocParser] Error processing document import job ${importId}:`, error);
    const errorMessage = error instanceof Error ? error.message : "Document processing failed";
    await updateJobStatus("FAILED", null, errorMessage);
    return "FAILED";
  }

  await updateJobStatus("READY_FOR_REVIEW", extracted, null);
  console.log(`[DocParser] Successfully processed document import job ${importId}`);
  return "READY_FOR_REVIEW";
}

module.exports = {
  processDocumentImport
};
