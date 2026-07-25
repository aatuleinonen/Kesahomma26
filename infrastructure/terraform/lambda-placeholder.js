// Provides a safe response until the POC deployment script uploads the API bundle.
exports.handler = async () => ({
  statusCode: 503,
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    status: "error",
    message: "The POC API has not been deployed yet."
  })
});
