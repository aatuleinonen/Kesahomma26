// Dispatches document imports to SQS in production and an isolated async runner in tests.
const { SendMessageCommand, SQSClient } = require("@aws-sdk/client-sqs");

const isMock = process.env.MOCK_DYNAMODB === "true" || process.env.NODE_ENV === "test";
const queueUrl = process.env.DOCUMENT_IMPORT_QUEUE_URL;
let sqsClient;

if (!isMock) sqsClient = new SQSClient({ region: process.env.AWS_REGION || "eu-north-1" });

async function enqueueDocumentImport(message) {
  if (isMock) {
    setImmediate(async () => {
      const { processImportMessage } = require("../document-worker");
      await processImportMessage(message).catch(() => {});
    });
    return;
  }
  if (!queueUrl) throw new Error("DOCUMENT_IMPORT_QUEUE_URL is not configured");
  await sqsClient.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(message) }));
}

module.exports = { enqueueDocumentImport };
