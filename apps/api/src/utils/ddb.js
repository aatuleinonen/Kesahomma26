const crypto = require("crypto");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand, TransactWriteCommand, UpdateCommand, BatchWriteCommand } = require("@aws-sdk/lib-dynamodb");

const tableName = process.env.DYNAMODB_TABLE_NAME || "kesahomma26-data";

let ddbDocClient;
// Enable mock database when running tests or if explicitly requested via environment variable.
const isMock = process.env.MOCK_DYNAMODB === "true" || process.env.NODE_ENV === "test";

// In-memory datastore simulating the DynamoDB table
const mockDb = [];

if (!isMock) {
  try {
    const client = new DynamoDBClient({
      region: process.env.AWS_REGION || "eu-north-1"
    });
    ddbDocClient = DynamoDBDocumentClient.from(client);
  } catch (err) {
    console.error("Failed to initialize real DynamoDB Client, falling back to mock:", err);
  }
}

function portfolioAvailableCondition(pk, portfolioId) {
  return {
    ConditionCheck: {
      TableName: tableName,
      Key: { PK: pk, SK: `METADATA#PORTFOLIO#${portfolioId}` },
      ConditionExpression: "attribute_exists(PK) AND (attribute_not_exists(#deletionStatus) OR #deletionStatus <> :deleting)",
      ExpressionAttributeNames: { "#deletionStatus": "deletionStatus" },
      ExpressionAttributeValues: { ":deleting": "DELETING" }
    }
  };
}

function assertMockPortfolioAvailable(pk, portfolioId) {
  const portfolio = mockDb.find(item => item.PK === pk && item.SK === `METADATA#PORTFOLIO#${portfolioId}`);
  if (!portfolio || portfolio.deletionStatus === "DELETING") {
    const error = new Error("Portfolio is unavailable");
    error.name = "ConditionalCheckFailedException";
    error.code = "PORTFOLIO_UNAVAILABLE";
    throw error;
  }
}

async function sendPortfolioTransaction(pk, portfolioId, transactItems) {
  try {
    await ddbDocClient.send(new TransactWriteCommand({
      TransactItems: [portfolioAvailableCondition(pk, portfolioId), ...transactItems]
    }));
  } catch (error) {
    const reasons = error?.CancellationReasons || error?.cancellationReasons;
    if (error?.name === "TransactionCanceledException" && Array.isArray(reasons)) {
      if (reasons[0]?.Code === "ConditionalCheckFailed") error.code = "PORTFOLIO_UNAVAILABLE";
      else if (reasons.slice(1).some(reason => reason?.Code === "ConditionalCheckFailed")) error.code = "CHILD_WRITE_CONFLICT";
    }
    throw error;
  }
}

/**
 * Saves a transaction to the DynamoDB table.
 * 
 * @param {string} userId - Cognito User ID (sub)
 * @param {string} portfolioId - Portfolio ID
 * @param {object} txn - Transaction object (type, quantity, price, amount, ticker, timestamp, etc.)
 * @returns {Promise<object>} The saved transaction item.
 */
async function putTransaction(userId, portfolioId, txn) {
  const pk = `USER#${userId}`;
  const sk = `PORTFOLIO#${portfolioId}#TXN#${txn.timestamp}`;
  const item = {
    PK: pk,
    SK: sk,
    portfolioId,
    ...txn,
    createdAt: new Date().toISOString()
  };

  if (isMock) {
    assertMockPortfolioAvailable(pk, portfolioId);
    // Mimic DynamoDB conditional writes: do not allow overwriting an existing transaction with the same PK+SK.
    const exists = mockDb.some(i => i.PK === pk && i.SK === sk);
    if (exists) {
      const err = new Error("Transaction already exists for the given timestamp");
      err.name = "ConditionalCheckFailedException";
      err.code = "CHILD_WRITE_CONFLICT";
      throw err;
    }
    mockDb.push(item);
    return item;
  }

  if (!ddbDocClient) {
    throw new Error("DynamoDB client is not initialized");
  }

  await sendPortfolioTransaction(pk, portfolioId, [{
    Put: {
      TableName: tableName,
      Item: item,
      ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)"
    }
  }]);
  return item;
}

/**
 * Retrieves all transactions for a portfolio from the DynamoDB table, sorted chronologically.
 * 
 * @param {string} userId - Cognito User ID (sub)
 * @param {string} portfolioId - Portfolio ID
 * @returns {Promise<Array>} List of transaction items.
 */
async function getTransactions(userId, portfolioId) {
  const pk = `USER#${userId}`;
  const skPrefix = `PORTFOLIO#${portfolioId}#TXN#`;

  if (isMock) {
    // Filter by partition key and sort key prefix, then sort lexicographically by SK (chronological)
    return mockDb
      .filter(i => i.PK === pk && i.SK.startsWith(skPrefix))
      .sort((a, b) => a.SK.localeCompare(b.SK));
  }

  if (!ddbDocClient) {
    throw new Error("DynamoDB client is not initialized");
  }
  const response = await ddbDocClient.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
    ExpressionAttributeValues: {
      ":pk": pk,
      ":skPrefix": skPrefix
    }
  }));

  // DynamoDB returns results sorted by SK by default, but we enforce sort just to be sure
  return (response.Items || []).sort((a, b) => a.SK.localeCompare(b.SK));
}

/**
 * Retrieves all portfolios for a user.
 * 
 * @param {string} userId - Cognito User ID (sub)
 * @returns {Promise<Array>} List of portfolio metadata items.
 */
async function getPortfolios(userId) {
  const pk = `USER#${userId}`;
  const skPrefix = "METADATA#PORTFOLIO#";

  if (isMock) {
    return mockDb
      .filter(i => i.PK === pk && i.SK.startsWith(skPrefix))
      .sort((a, b) => a.SK.localeCompare(b.SK));
  }

  if (!ddbDocClient) {
    throw new Error("DynamoDB client is not initialized");
  }

  const response = await ddbDocClient.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
    ExpressionAttributeValues: {
      ":pk": pk,
      ":skPrefix": skPrefix
    }
  }));

  return (response.Items || [])
    .sort((a, b) => a.SK.localeCompare(b.SK));
}

async function getPortfolio(userId, portfolioId) {
  const pk = `USER#${userId}`;
  const sk = `METADATA#PORTFOLIO#${portfolioId}`;
  if (isMock) return mockDb.find(item => item.PK === pk && item.SK === sk) || null;
  if (!ddbDocClient) throw new Error("DynamoDB client is not initialized");
  const response = await ddbDocClient.send(new GetCommand({
    TableName: tableName,
    Key: { PK: pk, SK: sk },
    ConsistentRead: true
  }));
  return response.Item || null;
}

/**
 * Saves a portfolio metadata item.
 * 
 * @param {string} userId - Cognito User ID (sub)
 * @param {object} portfolio - Portfolio metadata
 * @returns {Promise<object>} The saved portfolio item.
 */
async function putPortfolio(userId, portfolio) {
  const pk = `USER#${userId}`;
  const sk = `METADATA#PORTFOLIO#${portfolio.portfolioId || portfolio.id}`;
  const item = {
    PK: pk,
    SK: sk,
    ...portfolio,
    createdAt: portfolio.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (isMock) {
    const exists = mockDb.some(i => i.PK === pk && i.SK === sk);
    if (exists) {
      const err = new Error("Portfolio already exists");
      err.name = "ConditionalCheckFailedException";
      throw err;
    }
    mockDb.push(item);
    return item;
  }

  if (!ddbDocClient) {
    throw new Error("DynamoDB client is not initialized");
  }

  await ddbDocClient.send(new PutCommand({
    TableName: tableName,
    Item: item,
    ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)"
  }));
  return item;
}

/** Marks a portfolio as deleting so transactional child creation can no longer succeed. */
async function markPortfolioDeleting(userId, portfolioId) {
  const pk = `USER#${userId}`;
  const sk = `METADATA#PORTFOLIO#${portfolioId}`;
  const portfolio = await getPortfolio(userId, portfolioId);
  if (!portfolio || portfolio.deletionStatus === "DELETING") return portfolio;
  const deletionStartedAt = new Date().toISOString();

  if (isMock) {
    portfolio.deletionStatus = "DELETING";
    portfolio.deletionStartedAt = deletionStartedAt;
    return portfolio;
  }
  try {
    const response = await ddbDocClient.send(new UpdateCommand({
      TableName: tableName,
      Key: { PK: pk, SK: sk },
      UpdateExpression: "SET #deletionStatus = :deleting, #deletionStartedAt = :startedAt",
      ExpressionAttributeNames: {
        "#deletionStatus": "deletionStatus",
        "#deletionStartedAt": "deletionStartedAt"
      },
      ExpressionAttributeValues: { ":deleting": "DELETING", ":startedAt": deletionStartedAt },
      ConditionExpression: "attribute_exists(PK) AND attribute_not_exists(#deletionStatus)",
      ReturnValues: "ALL_NEW"
    }));
    return response.Attributes;
  } catch (error) {
    if (error?.name !== "ConditionalCheckFailedException") throw error;
    const currentPortfolio = await getPortfolio(userId, portfolioId);
    if (!currentPortfolio || currentPortfolio.deletionStatus === "DELETING") return currentPortfolio;
    throw error;
  }
}

/**
 * Deletes a portfolio metadata item and every record scoped to that portfolio.
 *
 * @param {string} userId - Cognito User ID (sub)
 * @param {string} portfolioId - Portfolio ID
 * @returns {Promise<object|null>} Deletion summary, or null when the portfolio does not exist
 */
async function deletePortfolio(userId, portfolioId) {
  const pk = `USER#${userId}`;
  const metadataSk = `METADATA#PORTFOLIO#${portfolioId}`;
  const recordPrefix = `PORTFOLIO#${portfolioId}#`;
  const belongsToPortfolio = item =>
    item.PK === pk && (item.SK === metadataSk || item.SK.startsWith(recordPrefix));

  if (isMock) {
    const exists = mockDb.some(item => item.PK === pk && item.SK === metadataSk);
    if (!exists) return null;

    const records = mockDb.filter(belongsToPortfolio);
    for (let index = mockDb.length - 1; index >= 0; index -= 1) {
      if (belongsToPortfolio(mockDb[index])) {
        mockDb.splice(index, 1);
      }
    }
    return { deletedCount: records.length };
  }

  if (!ddbDocClient) {
    throw new Error("DynamoDB client is not initialized");
  }

  const metadataResponse = await ddbDocClient.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: "PK = :pk AND SK = :metadataSk",
    ExpressionAttributeValues: {
      ":pk": pk,
      ":metadataSk": metadataSk
    },
    ProjectionExpression: "PK, SK",
    ConsistentRead: true
  }));
  const metadata = metadataResponse.Items?.[0];
  if (!metadata) {
    return null;
  }

  const records = [];
  let exclusiveStartKey;
  do {
    const response = await ddbDocClient.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :recordPrefix)",
      ExpressionAttributeValues: {
        ":pk": pk,
        ":recordPrefix": recordPrefix
      },
      ProjectionExpression: "PK, SK",
      ConsistentRead: true,
      ExclusiveStartKey: exclusiveStartKey
    }));
    records.push(...(response.Items || []));
    exclusiveStartKey = response.LastEvaluatedKey;
  } while (exclusiveStartKey);

  for (let offset = 0; offset < records.length; offset += 25) {
    let pending = records.slice(offset, offset + 25).map(item => ({
      DeleteRequest: { Key: { PK: item.PK, SK: item.SK } }
    }));

    for (let attempt = 1; pending.length > 0 && attempt <= 5; attempt += 1) {
      const response = await ddbDocClient.send(new BatchWriteCommand({
        RequestItems: { [tableName]: pending }
      }));
      pending = response.UnprocessedItems?.[tableName] || [];
      if (pending.length > 0) {
        await new Promise(resolve => setTimeout(resolve, attempt * 50));
      }
    }

    if (pending.length > 0) {
      throw new Error("DynamoDB did not process all portfolio deletion requests");
    }
  }

  await ddbDocClient.send(new DeleteCommand({
    TableName: tableName,
    Key: { PK: metadata.PK, SK: metadata.SK },
    ConditionExpression: "#deletionStatus = :deleting",
    ExpressionAttributeNames: { "#deletionStatus": "deletionStatus" },
    ExpressionAttributeValues: { ":deleting": "DELETING" }
  }));

  return { deletedCount: records.length + 1 };
}

/**
 * Deletes a transaction.
 * 
 * @param {string} userId - Cognito User ID (sub)
 * @param {string} portfolioId - Portfolio ID
 * @param {string} timestamp - Transaction timestamp
 */
async function deleteTransaction(userId, portfolioId, timestamp) {
  const pk = `USER#${userId}`;
  const sk = `PORTFOLIO#${portfolioId}#TXN#${timestamp}`;

  if (isMock) {
    const idx = mockDb.findIndex(i => i.PK === pk && i.SK === sk);
    if (idx === -1) {
      throw new Error("Transaction not found");
    }
    mockDb.splice(idx, 1);
    return { pk, sk };
  }

  if (!ddbDocClient) {
    throw new Error("DynamoDB client is not initialized");
  }

  await ddbDocClient.send(new DeleteCommand({
    TableName: tableName,
    Key: { PK: pk, SK: sk }
  }));
  return { pk, sk };
}

/**
 * Updates a transaction. If timestamp changes, deletes the old transaction first.
 * 
 * @param {string} userId - Cognito User ID (sub)
 * @param {string} portfolioId - Portfolio ID
 * @param {string} oldTimestamp - Original transaction timestamp
 * @param {object} newTxn - Updated transaction object
 * @returns {Promise<object>} The saved transaction item.
 */
async function updateTransaction(userId, portfolioId, oldTimestamp, newTxn) {
  const pk = `USER#${userId}`;
  const oldSk = `PORTFOLIO#${portfolioId}#TXN#${oldTimestamp}`;
  const newSk = `PORTFOLIO#${portfolioId}#TXN#${newTxn.timestamp}`;

  const item = {
    PK: pk,
    SK: newSk,
    portfolioId,
    ...newTxn,
    updatedAt: new Date().toISOString()
  };

  if (isMock) {
    assertMockPortfolioAvailable(pk, portfolioId);
    const oldIdx = mockDb.findIndex(i => i.PK === pk && i.SK === oldSk);
    if (oldIdx === -1) {
      throw new Error("Original transaction not found");
    }

    if (oldSk !== newSk) {
      // Simulates atomic swap using TransactWriteCommand: check if new destination already exists
      const newExists = mockDb.some(i => i.PK === pk && i.SK === newSk);
      if (newExists) {
        const err = new Error("Transaction already exists for the target timestamp");
        err.name = "ConditionalCheckFailedException";
        err.code = "CHILD_WRITE_CONFLICT";
        throw err;
      }
      // Remove old and add new atomically in the mock database
      mockDb.splice(oldIdx, 1);
      mockDb.push(item);
    } else {
      // Replace in place
      mockDb[oldIdx] = item;
    }
    return item;
  }

  if (!ddbDocClient) {
    throw new Error("DynamoDB client is not initialized");
  }

  if (oldSk !== newSk) {
    await sendPortfolioTransaction(pk, portfolioId, [
      {
        Put: {
          TableName: tableName,
          Item: item,
          ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)"
        }
      },
      {
        Delete: {
          TableName: tableName,
          Key: { PK: pk, SK: oldSk },
          ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)"
        }
      }
    ]);
  } else {
    await sendPortfolioTransaction(pk, portfolioId, [{
      Put: {
        TableName: tableName,
        Item: item,
        ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)"
      }
    }]);
  }

  return item;
}

/**
 * Resets the in-memory database. Useful for clean test environments.
 */
function clearMockDb() {
  mockDb.length = 0;
}

/**
 * Creates a new asynchronous AI analysis job.
 * 
 * @param {string} userId - Cognito User ID (sub)
 * @param {string} portfolioId - Portfolio ID
 * @returns {Promise<object>} The created job item.
 */
async function createAnalysisJob(userId, portfolioId) {
  const jobId = crypto.randomUUID();
  const pk = `USER#${userId}`;
  const sk = `PORTFOLIO#${portfolioId}#ANALYSIS_JOB#${jobId}`;
  const item = {
    PK: pk,
    SK: sk,
    GSI1PK: `USER#${userId}#ANALYSIS_JOB#${jobId}`,
    GSI1SK: `PORTFOLIO#${portfolioId}`,
    jobId,
    type: "ai_analysis",
    status: "PENDING",
    portfolioId,
    result: null,
    error: null,
    createdAt: new Date().toISOString()
  };

  if (isMock) {
    assertMockPortfolioAvailable(pk, portfolioId);
    mockDb.push(item);
    return item;
  }

  if (!ddbDocClient) {
    throw new Error("DynamoDB client is not initialized");
  }

  await sendPortfolioTransaction(pk, portfolioId, [{
    Put: {
      TableName: tableName,
      Item: item,
      ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)"
    }
  }]);

  return item;
}

/**
 * Retrieves an analysis job by its jobId for a user.
 * 
 * @param {string} userId - Cognito User ID (sub)
 * @param {string} jobId - Job ID (UUID)
 * @returns {Promise<object|null>} The job item, or null if not found.
 */
async function getAnalysisJob(userId, jobId) {
  const gsi1pk = `USER#${userId}#ANALYSIS_JOB#${jobId}`;

  if (isMock) {
    return mockDb.find(i => i.GSI1PK === gsi1pk) || null;
  }

  if (!ddbDocClient) {
    throw new Error("DynamoDB client is not initialized");
  }

  const response = await ddbDocClient.send(new QueryCommand({
    TableName: tableName,
    IndexName: "GSI1",
    KeyConditionExpression: "GSI1PK = :gsi1pk",
    ExpressionAttributeValues: {
      ":gsi1pk": gsi1pk
    }
  }));

  return response.Items?.[0] || null;
}

/**
 * Updates status, result, and error of an existing AI analysis job.
 * 
 * @param {string} userId - Cognito User ID (sub)
 * @param {string} portfolioId - Portfolio ID
 * @param {string} jobId - Job ID (UUID)
 * @param {string} status - New job status ("PENDING" | "PROCESSING" | "COMPLETED" | "FAILED")
 * @param {object|string|null} result - Results payload
 * @param {string|null} error - Error message
 * @returns {Promise<object>} The updated job item.
 */
async function updateAnalysisJob(userId, portfolioId, jobId, status, result = null, error = null) {
  const pk = `USER#${userId}`;
  const sk = `PORTFOLIO#${portfolioId}#ANALYSIS_JOB#${jobId}`;

  if (isMock) {
    const item = mockDb.find(i => i.PK === pk && i.SK === sk);
    if (!item) {
      throw new Error("Analysis job not found");
    }
    item.status = status;
    item.result = result;
    item.error = error;
    item.updatedAt = new Date().toISOString();
    return item;
  }

  if (!ddbDocClient) {
    throw new Error("DynamoDB client is not initialized");
  }

  const response = await ddbDocClient.send(new UpdateCommand({
    TableName: tableName,
    Key: { PK: pk, SK: sk },
    UpdateExpression: "SET #status = :status, #result = :result, #error = :error, #updatedAt = :updatedAt",
    ExpressionAttributeNames: {
      "#status": "status",
      "#result": "result",
      "#error": "error",
      "#updatedAt": "updatedAt"
    },
    ExpressionAttributeValues: {
      ":status": status,
      ":result": result,
      ":error": error,
      ":updatedAt": new Date().toISOString()
    },
    ConditionExpression: "attribute_exists(PK)",
    ReturnValues: "ALL_NEW"
  }));

  return response.Attributes;
}

/**
 * Creates a new document import job for a portfolio.
 * 
 * @param {string} userId - Cognito User ID (sub)
 * @param {string} portfolioId - Portfolio ID
 * @param {object} sourceDocument - Uploaded document metadata retained with the job.
 * @returns {Promise<object>} The created doc import job item.
 */
async function createDocImportJob(userId, portfolioId, sourceDocument = null, importId = crypto.randomUUID()) {
  const pk = `USER#${userId}`;
  const sk = `PORTFOLIO#${portfolioId}#DOC_IMPORT#${importId}`;
  const createdAt = new Date().toISOString();
  const item = {
    PK: pk,
    SK: sk,
    GSI1PK: `USER#${userId}#DOC_IMPORT#${importId}`,
    GSI1SK: `PORTFOLIO#${portfolioId}`,
    GSI2PK: "DOC_IMPORT#UPLOADED",
    GSI2SK: `${createdAt}#${importId}`,
    importId,
    portfolioId,
    type: "document_import",
    status: "UPLOADED",
    sourceDocument,
    extractedData: null,
    createdAt
  };

  if (isMock) {
    const portfolio = mockDb.find(candidate => candidate.PK === pk && candidate.SK === `METADATA#PORTFOLIO#${portfolioId}`);
    if (!portfolio || portfolio.deletionStatus === "DELETING") {
      const err = new Error("Portfolio is unavailable for document imports");
      err.name = "TransactionCanceledException";
      err.CancellationReasons = [{ Code: "ConditionalCheckFailed" }, { Code: "None" }];
      throw err;
    }
    if (mockDb.some(candidate => candidate.PK === pk && candidate.SK === sk)) {
      const err = new Error("Document import job already exists");
      err.name = "TransactionCanceledException";
      err.CancellationReasons = [{ Code: "None" }, { Code: "ConditionalCheckFailed" }];
      throw err;
    }
    mockDb.push(item);
    return item;
  }

  if (!ddbDocClient) {
    throw new Error("DynamoDB client is not initialized");
  }

  await ddbDocClient.send(new TransactWriteCommand({
    TransactItems: [
      {
        ConditionCheck: {
          TableName: tableName,
          Key: { PK: pk, SK: `METADATA#PORTFOLIO#${portfolioId}` },
          ConditionExpression: "attribute_exists(PK) AND (attribute_not_exists(#deletionStatus) OR #deletionStatus <> :deleting)",
          ExpressionAttributeNames: { "#deletionStatus": "deletionStatus" },
          ExpressionAttributeValues: { ":deleting": "DELETING" }
        }
      },
      {
        Put: {
          TableName: tableName,
          Item: item,
          ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)"
        }
      }
    ]
  }));

  return item;
}

/**
 * Retrieves a document import job by its importId for a user.
 * 
 * @param {string} userId - Cognito User ID (sub)
 * @param {string} importId - Import Job ID (UUID)
 * @returns {Promise<object|null>} The document import job item, or null if not found.
 */
async function getDocImportJob(userId, importId, portfolioId) {
  if (portfolioId) {
    const pk = `USER#${userId}`;
    const sk = `PORTFOLIO#${portfolioId}#DOC_IMPORT#${importId}`;
    if (isMock) return mockDb.find(item => item.PK === pk && item.SK === sk) || null;
    if (!ddbDocClient) throw new Error("DynamoDB client is not initialized");
    const response = await ddbDocClient.send(new GetCommand({
      TableName: tableName,
      Key: { PK: pk, SK: sk },
      ConsistentRead: true
    }));
    return response.Item || null;
  }

  const gsi1pk = `USER#${userId}#DOC_IMPORT#${importId}`;

  if (isMock) {
    return mockDb.find(i => i.GSI1PK === gsi1pk || (i.PK === `USER#${userId}` && i.SK && i.SK.endsWith(`#DOC_IMPORT#${importId}`))) || null;
  }

  if (!ddbDocClient) {
    throw new Error("DynamoDB client is not initialized");
  }

  const response = await ddbDocClient.send(new QueryCommand({
    TableName: tableName,
    IndexName: "GSI1",
    KeyConditionExpression: "GSI1PK = :gsi1pk",
    ExpressionAttributeValues: {
      ":gsi1pk": gsi1pk
    },
    Limit: 1
  }));

  return response.Items?.[0] || null;
}

/** Finds stale uploaded jobs through the sparse dispatch index. */
async function getStaleUploadedDocImports(cutoffIso, maxJobs = 25) {
  const toDispatchMessage = item => ({
    userId: item.PK.slice("USER#".length),
    portfolioId: item.portfolioId,
    importId: item.importId,
    dispatchIndexKey: item.GSI2SK
  });
  const isStaleUpload = item => item.GSI2PK === "DOC_IMPORT#UPLOADED"
    && typeof item.GSI2SK === "string"
    && item.GSI2SK <= `${cutoffIso}#\uffff`;

  if (isMock) return mockDb.filter(isStaleUpload).slice(0, maxJobs).map(toDispatchMessage);
  if (!ddbDocClient) throw new Error("DynamoDB client is not initialized");

  const response = await ddbDocClient.send(new QueryCommand({
    TableName: tableName,
    IndexName: "GSI2",
    KeyConditionExpression: "GSI2PK = :uploaded AND GSI2SK <= :cutoff",
    ExpressionAttributeValues: { ":uploaded": "DOC_IMPORT#UPLOADED", ":cutoff": `${cutoffIso}#\uffff` },
    ProjectionExpression: "PK, SK, portfolioId, importId, GSI2SK",
    Limit: maxJobs
  }));
  return (response.Items || []).map(toDispatchMessage);
}

/** Acquires a dispatch lease so overlapping schedulers cannot repeatedly enqueue the same job. */
async function claimDocImportDispatch(job, dispatchedAtIso) {
  const pk = `USER#${job.userId}`;
  const sk = `PORTFOLIO#${job.portfolioId}#DOC_IMPORT#${job.importId}`;
  const nextIndexKey = `${dispatchedAtIso}#${job.importId}`;
  if (isMock) {
    const item = mockDb.find(candidate => candidate.PK === pk && candidate.SK === sk);
    if (!item || item.status !== "UPLOADED" || item.GSI2SK !== job.dispatchIndexKey) return false;
    item.GSI2SK = nextIndexKey;
    item.lastDispatchedAt = dispatchedAtIso;
    return true;
  }
  if (!ddbDocClient) throw new Error("DynamoDB client is not initialized");

  try {
    await ddbDocClient.send(new UpdateCommand({
      TableName: tableName,
      Key: { PK: pk, SK: sk },
      UpdateExpression: "SET GSI2SK = :nextIndexKey, #lastDispatchedAt = :dispatchedAt",
      ConditionExpression: "#status = :uploaded AND GSI2SK = :expectedIndexKey",
      ExpressionAttributeNames: { "#status": "status", "#lastDispatchedAt": "lastDispatchedAt" },
      ExpressionAttributeValues: {
        ":uploaded": "UPLOADED",
        ":expectedIndexKey": job.dispatchIndexKey,
        ":nextIndexKey": nextIndexKey,
        ":dispatchedAt": dispatchedAtIso
      }
    }));
    return true;
  } catch (error) {
    if (error?.name === "ConditionalCheckFailedException") return false;
    throw error;
  }
}

/**
 * Updates status, extractedData, and error of an existing document import job.
 * 
 * @param {string} userId - Cognito User ID (sub)
 * @param {string} portfolioId - Portfolio ID
 * @param {string} importId - Import Job ID (UUID)
 * @param {string} status - New job status ("PROCESSING" | "RETRYING" | "READY_FOR_REVIEW" | "FAILED")
 * @param {Array|object|null} extractedData - Extracted holdings payload
 * @param {string|null} error - Error message
 * @returns {Promise<object>} The updated job item attributes.
 */
async function updateDocImportJob(userId, portfolioId, importId, status, extractedData = null, error = null) {
  const pk = `USER#${userId}`;
  const sk = `PORTFOLIO#${portfolioId}#DOC_IMPORT#${importId}`;
  const expectedStatuses = {
    PROCESSING: ["UPLOADED", "PROCESSING", "RETRYING"],
    RETRYING: ["UPLOADED", "PROCESSING", "RETRYING"],
    READY_FOR_REVIEW: ["PROCESSING"],
    FAILED: ["UPLOADED", "PROCESSING", "RETRYING"]
  }[status];
  if (!expectedStatuses) throw new Error(`Unsupported document import status transition: ${status}`);

  if (isMock) {
    const item = mockDb.find(i => i.PK === pk && i.SK === sk);
    if (!item) {
      throw new Error("Document import job not found");
    }
    if (!expectedStatuses.includes(item.status)) {
      const err = new Error(`Cannot transition document import from ${item.status} to ${status}`);
      err.name = "ConditionalCheckFailedException";
      throw err;
    }
    item.status = status;
    delete item.GSI2PK;
    delete item.GSI2SK;
    item.extractedData = extractedData;
    item.error = error;
    item.updatedAt = new Date().toISOString();
    return item;
  }

  if (!ddbDocClient) {
    throw new Error("DynamoDB client is not initialized");
  }

  const expectedStatusValues = Object.fromEntries(expectedStatuses.map((value, index) => [`:expectedStatus${index}`, value]));
  const response = await ddbDocClient.send(new UpdateCommand({
    TableName: tableName,
    Key: { PK: pk, SK: sk },
    UpdateExpression: "SET #status = :status, #extractedData = :extractedData, #error = :error, #updatedAt = :updatedAt REMOVE GSI2PK, GSI2SK",
    ExpressionAttributeNames: {
      "#status": "status",
      "#extractedData": "extractedData",
      "#error": "error",
      "#updatedAt": "updatedAt"
    },
    ExpressionAttributeValues: {
      ":status": status,
      ":extractedData": extractedData,
      ":error": error,
      ":updatedAt": new Date().toISOString(),
      ...expectedStatusValues
    },
    ConditionExpression: `attribute_exists(PK) AND #status IN (${Object.keys(expectedStatusValues).join(", ")})`,
    ReturnValues: "ALL_NEW"
  }));

  return response.Attributes;
}

/**
 * Atomically saves extracted holdings as portfolio transactions and completes an import job.
 * DynamoDB transactions support at most 100 operations, leaving room for 98 holdings,
 * the portfolio condition check, and the job update.
 */
async function confirmDocImport(userId, job) {
  const holdings = new Map();
  for (const [index, asset] of (Array.isArray(job.extractedData) ? job.extractedData : []).entries()) {
    const ticker = typeof asset?.ticker === "string" ? asset.ticker.trim().toUpperCase() : "";
    const hasQuantity = asset?.quantity !== null && asset?.quantity !== undefined && String(asset.quantity).trim() !== "";
    const hasCostBasis = asset?.costBasis !== null && asset?.costBasis !== undefined && String(asset.costBasis).trim() !== "";
    const quantity = Number(asset?.quantity);
    const costBasis = Number(asset?.costBasis);
    if (!ticker || !hasQuantity || !hasCostBasis || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(costBasis) || costBasis < 0) {
      const err = new Error(`Extracted holding ${index + 1} has invalid ticker, quantity, or cost basis`);
      err.code = "INVALID_IMPORT_ASSETS";
      throw err;
    }
    const current = holdings.get(ticker) || { ticker, quantity: 0, costBasis: 0 };
    current.quantity += quantity;
    current.costBasis += costBasis;
    if (!Number.isFinite(current.quantity) || !Number.isFinite(current.costBasis)) {
      const err = new Error(`Extracted holdings for ${ticker} exceed supported numeric limits after aggregation`);
      err.code = "INVALID_IMPORT_ASSETS";
      throw err;
    }
    holdings.set(ticker, current);
  }

  if (holdings.size === 0) {
    const err = new Error("Cannot confirm document import without extracted holdings");
    err.code = "INVALID_IMPORT_ASSETS";
    throw err;
  }
  if (holdings.size > 98) {
    const err = new Error("Document import contains too many assets to confirm atomically");
    err.code = "TOO_MANY_IMPORT_ASSETS";
    throw err;
  }

  const pk = `USER#${userId}`;
  const now = new Date().toISOString();
  const baseTimestamp = Date.now();
  const transactionItems = [...holdings.values()].map((holding, index) => {
    const timestamp = new Date(baseTimestamp + index).toISOString();
    const averageCost = holding.costBasis / holding.quantity;
    if (!Number.isFinite(averageCost)) {
      const err = new Error(`Extracted holdings for ${holding.ticker} produce an invalid average cost`);
      err.code = "INVALID_IMPORT_ASSETS";
      throw err;
    }
    return {
      PK: pk,
      SK: `PORTFOLIO#${job.portfolioId}#TXN#${timestamp}`,
      portfolioId: job.portfolioId,
      type: "transfer_in",
      ticker: holding.ticker,
      quantity: holding.quantity,
      price: averageCost,
      amount: holding.costBasis,
      costBasis: holding.costBasis,
      timestamp,
      sourceImportId: job.importId,
      createdAt: now
    };
  });

  if (isMock) {
    const portfolioItem = mockDb.find(item => item.PK === pk && item.SK === `METADATA#PORTFOLIO#${job.portfolioId}`);
    if (!portfolioItem || portfolioItem.deletionStatus === "DELETING") {
      const err = new Error("Portfolio is unavailable for import confirmation");
      err.name = "TransactionCanceledException";
      err.code = "PORTFOLIO_UNAVAILABLE";
      throw err;
    }
    const jobItem = mockDb.find(item => item.PK === pk && item.SK === job.SK);
    if (!jobItem || jobItem.status !== "READY_FOR_REVIEW") {
      const err = new Error("Document import is no longer ready for confirmation");
      err.name = "ConditionalCheckFailedException";
      err.code = "IMPORT_NOT_READY";
      throw err;
    }

    if (transactionItems.some(item => mockDb.some(existing => existing.PK === item.PK && existing.SK === item.SK))) {
      const err = new Error("An imported transaction already exists at the generated timestamp");
      err.name = "ConditionalCheckFailedException";
      err.code = "IMPORT_TRANSACTION_CONFLICT";
      throw err;
    }
    mockDb.push(...transactionItems);
    jobItem.status = "COMPLETED";
    jobItem.error = null;
    jobItem.updatedAt = now;
    return { job: jobItem, savedTransactions: transactionItems };
  }

  if (!ddbDocClient) {
    throw new Error("DynamoDB client is not initialized");
  }

  await ddbDocClient.send(new TransactWriteCommand({
    TransactItems: [
      {
        ConditionCheck: {
          TableName: tableName,
          Key: { PK: pk, SK: `METADATA#PORTFOLIO#${job.portfolioId}` },
          ExpressionAttributeNames: { "#deletionStatus": "deletionStatus" },
          ExpressionAttributeValues: { ":deleting": "DELETING" },
          ConditionExpression: "attribute_exists(PK) AND (attribute_not_exists(#deletionStatus) OR #deletionStatus <> :deleting)"
        }
      },
      ...transactionItems.map(Item => ({
        Put: {
          TableName: tableName,
          Item,
          ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)"
        }
      })),
      {
        Update: {
          TableName: tableName,
          Key: { PK: pk, SK: job.SK },
          UpdateExpression: "SET #status = :completed, #error = :error, #updatedAt = :updatedAt",
          ExpressionAttributeNames: {
            "#status": "status",
            "#error": "error",
            "#updatedAt": "updatedAt"
          },
          ExpressionAttributeValues: {
            ":completed": "COMPLETED",
            ":ready": "READY_FOR_REVIEW",
            ":error": null,
            ":updatedAt": now
          },
          ConditionExpression: "#status = :ready"
        }
      }
    ]
  }));

  return {
    job: { ...job, status: "COMPLETED", error: null, updatedAt: now },
    savedTransactions: transactionItems
  };
}

/** Returns stored document pointers for import jobs owned by one portfolio. */
async function getPortfolioDocumentSources(userId, portfolioId) {
  const pk = `USER#${userId}`;
  const skPrefix = `PORTFOLIO#${portfolioId}#DOC_IMPORT#`;
  if (isMock) {
    return mockDb
      .filter(item => item.PK === pk && item.SK.startsWith(skPrefix) && item.sourceDocument)
      .map(item => item.sourceDocument);
  }
  if (!ddbDocClient) throw new Error("DynamoDB client is not initialized");

  const sourceDocuments = [];
  let exclusiveStartKey;
  do {
    const response = await ddbDocClient.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
      ExpressionAttributeValues: { ":pk": pk, ":skPrefix": skPrefix },
      ProjectionExpression: "sourceDocument",
      ConsistentRead: true,
      ExclusiveStartKey: exclusiveStartKey
    }));
    sourceDocuments.push(...(response.Items || []).map(item => item.sourceDocument).filter(Boolean));
    exclusiveStartKey = response.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return sourceDocuments;
}

module.exports = {
  putTransaction,
  getTransactions,
  getPortfolios,
  getPortfolio,
  putPortfolio,
  markPortfolioDeleting,
  deletePortfolio,
  deleteTransaction,
  updateTransaction,
  clearMockDb,
  createAnalysisJob,
  getAnalysisJob,
  updateAnalysisJob,
  createDocImportJob,
  getDocImportJob,
  getStaleUploadedDocImports,
  claimDocImportDispatch,
  updateDocImportJob,
  confirmDocImport,
  getPortfolioDocumentSources,
  isMock
};
