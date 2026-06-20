const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand, QueryCommand } = require("@aws-sdk/lib-dynamodb");

const tableName = process.env.DYNAMODB_TABLE_NAME || "kesahomma26-data";

let ddbDocClient;
// Enable mock database when running tests or if explicitly requested via environment variable.
// Default to mock database if Cognito credentials are not fully set up for local development.
const isMock = process.env.MOCK_DYNAMODB === "true" || 
               process.env.NODE_ENV === "test" || 
               (!process.env.AWS_ACCESS_KEY_ID && !process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI && !process.env.AWS_WEB_IDENTITY_TOKEN_FILE);

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

  if (isMock || !ddbDocClient) {
    // Overwrite if exact PK & SK exists (simulating PutItem replacement behaviour)
    const index = mockDb.findIndex(i => i.PK === pk && i.SK === sk);
    if (index > -1) {
      mockDb[index] = item;
    } else {
      mockDb.push(item);
    }
    return item;
  }

  await ddbDocClient.send(new PutCommand({
    TableName: tableName,
    Item: item
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

  if (isMock || !ddbDocClient) {
    // Filter by partition key and sort key prefix, then sort lexicographically by SK (chronological)
    return mockDb
      .filter(i => i.PK === pk && i.SK.startsWith(skPrefix))
      .sort((a, b) => a.SK.localeCompare(b.SK));
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
 * Resets the in-memory database. Useful for clean test environments.
 */
function clearMockDb() {
  mockDb.length = 0;
}

module.exports = {
  putTransaction,
  getTransactions,
  clearMockDb,
  isMock
};
