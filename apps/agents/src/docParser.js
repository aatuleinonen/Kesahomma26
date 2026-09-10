const path = require("path");
const { parse } = require("csv-parse/sync");

const maxReviewPayloadBytes = 300 * 1024;
const decimalNumberPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const maxFinancialValue = 1e15;
const minNonZeroFinancialValue = 1e-12;

function parseFinancialValue(value, { rowNumber, field, allowZero }) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`CSV row ${rowNumber} is missing ${field}`);
  if (!decimalNumberPattern.test(text)) throw new Error(`CSV row ${rowNumber} has a non-decimal ${field}`);

  const significantDigits = text
    .replace(/^[+-]/, "")
    .split(/[eE]/, 1)[0]
    .replace(".", "")
    .replace(/^0+/, "").length;
  const parsed = Number(text);
  const magnitudeIsValid = parsed === 0
    ? allowZero
    : Math.abs(parsed) >= minNonZeroFinancialValue && Math.abs(parsed) <= maxFinancialValue;
  if (!Number.isFinite(parsed) || significantDigits > 15 || !magnitudeIsValid || (!allowZero && parsed <= 0) || (allowZero && parsed < 0)) {
    throw new Error(`CSV row ${rowNumber} contains an out-of-range ${field}`);
  }
  return parsed;
}

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

    let csvText;
    try {
      csvText = new TextDecoder("utf-8", { fatal: true }).decode(document.buffer);
    } catch {
      throw new Error("CSV must contain valid UTF-8 text");
    }
    const rows = parse(csvText, {
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
      const rowNumber = index + 2;
      if (!ticker) throw new Error(`CSV row ${rowNumber} is missing ticker`);
      const quantity = parseFinancialValue(quantityValue, { rowNumber, field: "quantity", allowZero: false });
      const costBasis = parseFinancialValue(costBasisValue, { rowNumber, field: "cost basis", allowZero: true });
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
