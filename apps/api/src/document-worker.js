// Processes durable SQS document-import messages outside the API Lambda lifecycle.
const { processDocumentImport } = require("@kesahomma26/agents");
const { getDocImportJob, updateDocImportJob } = require("./utils/ddb");
const { loadDocument } = require("./utils/documentStorage");

async function processImportMessage({ userId, portfolioId, importId }) {
  const job = await getDocImportJob(userId, importId, portfolioId);
  if (!job || ["READY_FOR_REVIEW", "COMPLETED"].includes(job.status)) return;
  const buffer = await loadDocument(job.sourceDocument);
  await processDocumentImport(
    userId,
    portfolioId,
    importId,
    { buffer, metadata: job.sourceDocument },
    (status, data, error) => updateDocImportJob(userId, portfolioId, importId, status, data, error)
  );
}

async function handler(event) {
  const batchItemFailures = [];
  for (const record of event.Records || []) {
    try {
      await processImportMessage(JSON.parse(record.body));
    } catch (error) {
      console.error(`[DocParser] Import message ${record.messageId} failed:`, error);
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}

module.exports = { handler, processImportMessage };
