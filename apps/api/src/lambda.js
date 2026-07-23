// Adapts the existing Express application to AWS Lambda proxy events.
const serverlessExpress = require("@codegenie/serverless-express");
const app = require("./app");

exports.handler = serverlessExpress({ app });
