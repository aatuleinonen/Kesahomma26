// Stores uploaded import documents durably in S3, with an in-memory implementation for tests.
const crypto = require("crypto");
const { DeleteObjectCommand, DeleteObjectsCommand, PutObjectCommand, S3Client } = require("@aws-sdk/client-s3");

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

async function deleteDocument(sourceDocument) {
  if (isMock) {
    mockDocuments.delete(sourceDocument.key);
    return;
  }
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await s3Client.send(new DeleteObjectCommand({
        Bucket: sourceDocument.bucket,
        Key: sourceDocument.key
      }));
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
    }
  }
}

async function deleteDocuments(sourceDocuments) {
  if (isMock) {
    for (const sourceDocument of sourceDocuments) mockDocuments.delete(sourceDocument.key);
    return;
  }

  const documentsByBucket = new Map();
  for (const sourceDocument of sourceDocuments) {
    const bucketDocuments = documentsByBucket.get(sourceDocument.bucket) || [];
    bucketDocuments.push(sourceDocument);
    documentsByBucket.set(sourceDocument.bucket, bucketDocuments);
  }

  for (const [bucket, bucketDocuments] of documentsByBucket) {
    for (let index = 0; index < bucketDocuments.length; index += 1000) {
      const batch = bucketDocuments.slice(index, index + 1000);
      const response = await s3Client.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: batch.map(document => ({ Key: document.key })),
          Quiet: true
        }
      }));
      if (response.Errors?.length) {
        const failedKeys = response.Errors.map(error => error.Key).filter(Boolean).join(", ");
        throw new Error(`Failed to delete document import objects: ${failedKeys || "unknown keys"}`);
      }
    }
  }
}

function clearMockDocuments() {
  mockDocuments.clear();
}

function hasMockDocument(sourceDocument) {
  if (!isMock) throw new Error("Mock document inspection is only available in tests");
  return mockDocuments.has(sourceDocument.key);
}

function getMockDocumentCount() {
  if (!isMock) throw new Error("Mock document inspection is only available in tests");
  return mockDocuments.size;
}

module.exports = { storeDocument, deleteDocument, deleteDocuments, clearMockDocuments, getMockDocumentCount, hasMockDocument };
