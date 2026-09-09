// Stores uploaded import documents durably in S3, with an in-memory implementation for tests.
const crypto = require("crypto");
const { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } = require("@aws-sdk/client-s3");

const isMock = process.env.MOCK_DYNAMODB === "true" || process.env.NODE_ENV === "test";
const bucketName = process.env.DOCUMENT_IMPORT_BUCKET;
const mockDocuments = new Map();
let s3Client;

if (!isMock) {
  s3Client = new S3Client({ region: process.env.AWS_REGION || "eu-north-1" });
}

function buildDocumentKey(userId, portfolioId, importId) {
  const ownerHash = crypto.createHash("sha256").update(`${userId}:${portfolioId}`).digest("hex");
  return `imports/${ownerHash}/${importId}`;
}

async function storeDocument(userId, portfolioId, importId, file) {
  const key = buildDocumentKey(userId, portfolioId, importId);
  const sourceDocument = {
    bucket: bucketName || "mock-document-imports",
    key,
    originalName: file.originalName,
    mimeType: file.mimeType,
    size: file.buffer.length
  };

  if (isMock) {
    mockDocuments.set(key, Buffer.from(file.buffer));
    return sourceDocument;
  }
  if (!bucketName) throw new Error("DOCUMENT_IMPORT_BUCKET is not configured");

  await s3Client.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimeType,
    ServerSideEncryption: "AES256"
  }));
  return sourceDocument;
}

async function loadDocument(sourceDocument) {
  if (isMock) {
    const body = mockDocuments.get(sourceDocument.key);
    if (!body) throw new Error("Uploaded document is not available");
    return Buffer.from(body);
  }

  const response = await s3Client.send(new GetObjectCommand({
    Bucket: sourceDocument.bucket,
    Key: sourceDocument.key
  }));
  return Buffer.from(await response.Body.transformToByteArray());
}

async function deleteDocument(sourceDocument) {
  if (isMock) {
    mockDocuments.delete(sourceDocument.key);
    return;
  }
  await s3Client.send(new DeleteObjectCommand({
    Bucket: sourceDocument.bucket,
    Key: sourceDocument.key
  }));
}

function clearMockDocuments() {
  mockDocuments.clear();
}

module.exports = { storeDocument, loadDocument, deleteDocument, clearMockDocuments };
