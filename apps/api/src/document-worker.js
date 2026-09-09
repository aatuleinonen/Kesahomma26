// Processes durable SQS document-import messages outside the API Lambda lifecycle.
const { processDocumentImport } = require("@kesahomma26/agents");
const { getDocImportJob, updateDocImportJob } = require("./utils/ddb");
const { deleteDocument, loadDocument } = require("./utils/documentStorage");

async function processImportMessage({ userId, portfolioId, importId }) {
  const job = await getDocImportJob(userId, importId, portfolioId);
  if (!job) return;
  if (["FAILED", "READY_FOR_REVIEW", "COMPLETED"].includes(job.status)) {
    if (job.sourceDocument) await deleteDocument(job.sourceDocument);
    return;
  }

  let buffer;
  try {
    buffer = await loadDocument(job.sourceDocument);
  } catch (error) {
    await updateDocImportJob(userId, portfolioId, importId, "RETRYING", null, "Uploaded document could not be read; processing will be retried");
    throw error;
  }

  const terminalStatus = await processDocumentImport(
    userId,
    portfolioId,
    importId,
    { buffer, metadata: job.sourceDocument },
    (status, data, error) => updateDocImportJob(userId, portfolioId, importId, status, data, error)
  );
  if (job.sourceDocument && ["READY_FOR_REVIEW", "FAILED"].includes(terminalStatus)) {
    await deleteDocument(job.sourceDocument);
  }
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
