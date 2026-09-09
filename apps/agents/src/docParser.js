/**
 * Simulates processing of an AI document import job in the background.
 * 
 * @param {string} userId - Cognito User ID (sub)
 * @param {string} portfolioId - Portfolio ID
 * @param {string} importId - Document Import Job ID (UUID)
 * @param {{buffer: Buffer, metadata: object}} document - Uploaded document bytes and metadata.
 * @param {function} updateJobStatus - Injected callback function to persist job status changes
 */
async function processDocumentImport(userId, portfolioId, importId, document, updateJobStatus) {
  console.log(`[DocParser] Picked up document import job ${importId}`);
  try {
    if (!Buffer.isBuffer(document?.buffer)) {
      throw new Error("Document import is missing uploaded file bytes");
    }

    await updateJobStatus("PROCESSING", null, null);
    console.log(`[DocParser] Processing document import job ${importId} (${document.buffer.length} bytes)`);

    if (document.buffer.length === 0) throw new Error("Uploaded document is empty");
    if (document.metadata?.mimeType !== "text/csv") {
      throw new Error("This document format is not yet supported for extraction; upload a UTF-8 CSV file");
    }

    const lines = document.buffer.toString("utf8").trim().split(/\r?\n/);
    const headers = lines.shift()?.split(",").map(value => value.trim().toLowerCase()) || [];
    const tickerIndex = headers.findIndex(value => value === "ticker" || value === "symbol");
    const quantityIndex = headers.indexOf("quantity");
    const costBasisIndex = headers.findIndex(value => value === "costbasis" || value === "cost_basis");
    if (tickerIndex < 0 || quantityIndex < 0 || costBasisIndex < 0) {
      throw new Error("CSV must contain ticker, quantity, and costBasis columns");
    }

    const extracted = lines.filter(line => line.trim()).map((line, index) => {
      const values = line.split(",").map(value => value.trim());
      const ticker = values[tickerIndex];
      const quantity = Number(values[quantityIndex]);
      const costBasis = Number(values[costBasisIndex]);
      if (!ticker || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(costBasis) || costBasis < 0) {
        throw new Error(`CSV row ${index + 2} contains invalid holding values`);
      }
      return { ticker, quantity, costBasis };
    });
    if (extracted.length === 0) throw new Error("CSV does not contain any holdings");

    await updateJobStatus("READY_FOR_REVIEW", extracted, null);
    console.log(`[DocParser] Successfully processed document import job ${importId}`);
  } catch (error) {
    console.error(`[DocParser] Error processing document import job ${importId}:`, error);
    const errorMessage = error instanceof Error ? error.message : "Document processing failed";
    try {
      await updateJobStatus("FAILED", null, errorMessage);
    } catch (dbError) {
      console.error(`[DocParser] Failed to update job status to FAILED:`, dbError);
    }
  }
}

module.exports = {
  processDocumentImport
};
