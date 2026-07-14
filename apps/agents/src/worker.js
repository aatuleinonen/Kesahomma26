const { updateAnalysisJob } = require("../../api/src/utils/ddb");

/**
 * Simulates processing of an AI analysis job in the background.
 * 
 * @param {string} userId - Cognito User ID (sub)
 * @param {string} portfolioId - Portfolio ID
 * @param {string} jobId - Job ID (UUID)
 */
async function processAnalysisJob(userId, portfolioId, jobId) {
  console.log(`[Worker] Picked up job ${jobId} for user ${userId} and portfolio ${portfolioId}`);
  try {
    // Simulate network/LLM delay
    await new Promise(resolve => setTimeout(resolve, 2000));

    const mockResult = {
      riskLevel: "Moderate",
      diversificationScore: 85,
      summary: "Well balanced portfolio."
    };

    await updateAnalysisJob(userId, portfolioId, jobId, "COMPLETED", mockResult);
    console.log(`[Worker] Successfully completed job ${jobId}`);
  } catch (error) {
    console.error(`[Worker] Error processing job ${jobId}:`, error);
    try {
      await updateAnalysisJob(userId, portfolioId, jobId, "FAILED", null, error.message);
    } catch (dbError) {
      console.error(`[Worker] Failed to update job status to FAILED:`, dbError);
    }
  }
}

module.exports = {
  processAnalysisJob
};
