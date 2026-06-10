/**
 * Helper to extract unique Cognito user ID (sub) from the request context.
 * Throws an error if the user context is missing.
 * 
 * @param {object} req - Express request object
 * @returns {string} The Cognito user sub identifier
 */
function getUserId(req) {
  if (!req.user || !req.user.sub) {
    throw new Error("Unauthorized: User context is missing from the request");
  }
  return req.user.sub;
}

/**
 * Builds DynamoDB query parameters to ensure user-level data isolation.
 * Restricts partition key queries to the current authenticated user.
 * 
 * @param {object} req - Express request object containing the verified user context
 * @param {string} tableName - DynamoDB table name
 * @param {object} extraParams - Additional DynamoDB parameter configuration overrides
 * @returns {object} Isolated DynamoDB query parameter configuration
 */
function buildIsolatedQueryParams(req, tableName, extraParams = {}) {
  const userId = getUserId(req);

  return {
    TableName: tableName,
    KeyConditionExpression: "userId = :userId",
    ...extraParams,
    ExpressionAttributeValues: {
      ":userId": userId,
      ...(extraParams.ExpressionAttributeValues || {})
    }
  };
}

module.exports = {
  getUserId,
  buildIsolatedQueryParams
};
