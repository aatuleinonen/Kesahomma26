/**
 * Simulates processing of an AI document import job in the background.
 * 
 * @param {string} userId - Cognito User ID (sub)
 * @param {string} portfolioId - Portfolio ID
 * @param {string} importId - Document Import Job ID (UUID)
 * @param {function} updateJobStatus - Injected callback function to persist job status changes
 */
async function processDocumentImport(userId, portfolioId, importId, updateJobStatus) {
  console.log(`[DocParser] Picked up document import job ${importId} for user ${userId} and portfolio ${portfolioId}`);
  try {
    // Simulate network/LLM extraction delay
    await new Promise(resolve => setTimeout(resolve, 3000));

    const mockResult = [
      { ticker: "AAPL", quantity: 10, costBasis: 1500 },
      { ticker: "VOO", quantity: 5, costBasis: 2000 }
    ];

    await updateJobStatus("READY_FOR_REVIEW", mockResult, null);
    console.log(`[DocParser] Successfully processed document import job ${importId}`);
  } catch (error) {
    console.error(`[DocParser] Error processing document import job ${importId}:`, error);
    const errorMessage = error instanceof Error ? error.message : String(error);
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
