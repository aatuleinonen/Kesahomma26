const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand, QueryCommand, DeleteCommand, TransactWriteCommand } = require("@aws-sdk/lib-dynamodb");

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
    // Mimic DynamoDB conditional writes: do not allow overwriting an existing transaction with the same PK+SK.
    const exists = mockDb.some(i => i.PK === pk && i.SK === sk);
    if (exists) {
      const err = new Error("Transaction already exists for the given timestamp");
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
    await ddbDocClient.send(new TransactWriteCommand({
      TransactItems: [
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
            Key: { PK: pk, SK: oldSk }
          }
        }
      ]
    }));
  } else {
    // Update/put directly
    await ddbDocClient.send(new PutCommand({
      TableName: tableName,
      Item: item
    }));
  }

  return item;
}

/**
 * Resets the in-memory database. Useful for clean test environments.
 */
function clearMockDb() {
  mockDb.length = 0;
}

module.exports = {
  putTransaction,
  getTransactions,
  getPortfolios,
  putPortfolio,
  deleteTransaction,
  updateTransaction,
  clearMockDb,
  isMock
};
