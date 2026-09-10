// Processes durable SQS document-import messages outside the API Lambda lifecycle.
const { processDocumentImport } = require("@kesahomma26/agents");
const { claimDocImportDispatch, getDocImportJob, getStaleUploadedDocImports, updateDocImportJob } = require("./utils/ddb");
const { deleteDocument, loadDocument } = require("./utils/documentStorage");
const { enqueueDocumentImport } = require("./utils/documentQueue");

async function processImportMessage({ userId, portfolioId, importId }, { finalAttempt = false } = {}) {
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
    if (finalAttempt) {
      await updateDocImportJob(userId, portfolioId, importId, "FAILED", null, "Uploaded document could not be read after multiple attempts");
      if (job.sourceDocument) await deleteDocument(job.sourceDocument);
      return;
    }
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
  if (event?.source === "aws.events") {
    await requeueStaleDocumentImports();
    return { batchItemFailures: [] };
  }
  const batchItemFailures = [];
  const configuredMaxReceiveCount = Number.parseInt(process.env.DOCUMENT_IMPORT_MAX_RECEIVE_COUNT, 10);
  const maxReceiveCount = Number.isSafeInteger(configuredMaxReceiveCount) && configuredMaxReceiveCount > 0
    ? configuredMaxReceiveCount
    : 3;
  for (const record of event.Records || []) {
    let message;
    let finalAttempt = false;
    try {
      const receiveCount = Number.parseInt(record.attributes?.ApproximateReceiveCount || "1", 10);
      const fromDeadLetterQueue = record.eventSourceARN === process.env.DOCUMENT_IMPORT_DLQ_ARN;
      finalAttempt = fromDeadLetterQueue || receiveCount >= maxReceiveCount;
      message = JSON.parse(record.body);
      await processImportMessage(message, { finalAttempt });
    } catch (error) {
      console.error(`[DocParser] Import message ${record.messageId} failed:`, error);
      if (finalAttempt && message) {
        try {
          await finalizeImportFailure(message);
          continue;
        } catch (finalizationError) {
          console.error(`[DocParser] Import message ${record.messageId} terminal update failed:`, finalizationError);
        }
      }
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}

async function finalizeImportFailure({ userId, portfolioId, importId }) {
  const job = await getDocImportJob(userId, importId, portfolioId);
  if (!job) return;
  if (!["FAILED", "READY_FOR_REVIEW", "COMPLETED"].includes(job.status)) {
    await updateDocImportJob(userId, portfolioId, importId, "FAILED", null, "Document processing failed after multiple attempts");
  }
  if (job.sourceDocument) await deleteDocument(job.sourceDocument);
}

async function requeueStaleDocumentImports(now = new Date()) {
  const configuredAgeSeconds = Number.parseInt(process.env.DOCUMENT_IMPORT_STALE_AFTER_SECONDS, 10);
  const staleAfterSeconds = Number.isSafeInteger(configuredAgeSeconds) && configuredAgeSeconds > 0
    ? configuredAgeSeconds
    : 120;
  const cutoffIso = new Date(now.getTime() - staleAfterSeconds * 1000).toISOString();
  const jobs = await getStaleUploadedDocImports(cutoffIso);
  let dispatchedJobs = 0;
  for (const job of jobs) {
    if (!await claimDocImportDispatch(job, now.toISOString())) continue;
    await enqueueDocumentImport({ userId: job.userId, portfolioId: job.portfolioId, importId: job.importId });
    dispatchedJobs += 1;
  }
  return dispatchedJobs;
}

module.exports = { finalizeImportFailure, handler, processImportMessage, requeueStaleDocumentImports };
