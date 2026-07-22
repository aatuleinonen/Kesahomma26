/**
 * Simulates processing of an AI analysis job in the background.
 * 
 * @param {string} userId - Cognito User ID (sub)
 * @param {string} portfolioId - Portfolio ID
 * @param {string} jobId - Job ID (UUID)
 * @param {function} updateJobStatus - Injected callback function to persist job status changes
 */
async function processAnalysisJob(userId, portfolioId, jobId, updateJobStatus) {
  console.log(`[Worker] Picked up job ${jobId} for user ${userId} and portfolio ${portfolioId}`);
  try {
    // Simulate network/LLM delay
    await new Promise(resolve => setTimeout(resolve, 2000));

    const mockResult = {
      riskLevel: "Moderate",
      diversificationScore: 85,
      summary: "Well balanced portfolio."
    };

    await updateJobStatus("COMPLETED", mockResult, null);
    console.log(`[Worker] Successfully completed job ${jobId}`);
  } catch (error) {
    console.error(`[Worker] Error processing job ${jobId}:`, error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    try {
      await updateJobStatus("FAILED", null, errorMessage);
    } catch (dbError) {
      console.error(`[Worker] Failed to update job status to FAILED:`, dbError);
    }
  }
}

module.exports = {
  processAnalysisJob
};
