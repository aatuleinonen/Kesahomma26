// Exercises AI draft generation and atomic, retry-safe creation using local fakes.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { once } = require("node:events");
const { BedrockRuntimeClient, ConverseCommand } = require("@aws-sdk/client-bedrock-runtime");

process.env.NODE_ENV = "development";
process.env.BYPASS_AUTH = "true";
process.env.MOCK_DYNAMODB = "true";

const app = require("./app");

test("portfolio drafts require authentication and persist only on reviewed save", async t => {
  const apiFetch = global.fetch;
  const originalModelId = process.env.PORTFOLIO_BEDROCK_MODEL_ID;
  const server = app.listen(0, "127.0.0.1");
  t.after(() => {
    if (originalModelId === undefined) delete process.env.PORTFOLIO_BEDROCK_MODEL_ID;
    else process.env.PORTFOLIO_BEDROCK_MODEL_ID = originalModelId;
    server.close();
  });
  await once(server, "listening");
  const request = (path, body, authenticated = true) => apiFetch(
    `http://127.0.0.1:${server.address().port}/api/portfolios${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(authenticated ? { Authorization: "Bearer test-token" } : {})
      },
      body: body && JSON.stringify(body)
    });

  const description = "I own 12 shares of AAPL in USD";
  assert.equal((await request("/draft", { description }, false)).status, 401);
  delete process.env.PORTFOLIO_BEDROCK_MODEL_ID;
  assert.equal((await request("/draft", { description })).status, 503);

  const modelId = "global.openai.gpt-6.2-sol";
  process.env.PORTFOLIO_BEDROCK_MODEL_ID = modelId;
  const draftData = {
    name: "Long-term holdings",
    description: "Existing positions",
    baseCurrency: "USD",
    holdings: [{ ticker: "AAPL", quantity: 12, costBasis: null }],
    notes: "Original cost is missing."
  };
  const send = t.mock.method(BedrockRuntimeClient.prototype, "send", async (command, options) => {
    assert.ok(command instanceof ConverseCommand);
    assert.equal(command.input.modelId, modelId);
    assert.deepEqual(command.input.messages, [{ role: "user", content: [{ text: description }] }]);
    assert.ok(command.input.inferenceConfig.maxTokens > 0);
    assert.ok(options.abortSignal instanceof AbortSignal);
    return {
      stopReason: "end_turn",
      output: { message: { content: [{ text: JSON.stringify(draftData) }] } }
    };
  });

  const generated = await request("/draft", { description });
  assert.equal(generated.status, 200);
  assert.equal(send.mock.callCount(), 1);
  const { draft } = await generated.json();
  assert.equal(draft.holdings[0].costBasis, null);
  assert.deepEqual((await (await request("")).json()).portfolios, []);

  send.mock.mockImplementationOnce(async () => ({
    stopReason: "max_tokens",
    output: { message: { content: [{ text: JSON.stringify(draftData) }] } }
  }));
  assert.equal((await request("/draft", { description })).status, 502);

  const reviewed = { ...draft, portfolioId: "ai-portfolio" };
  assert.equal((await request("", reviewed)).status, 400);
  assert.deepEqual((await (await request("")).json()).portfolios, []);

  reviewed.holdings[0].costBasis = 2040;
  await Promise.all([request("", reviewed), request("", reviewed)]).then(responses =>
    responses.forEach(response => assert.equal(response.status, 201))
  );
  const result = await (await request("/ai-portfolio/holdings")).json();
  assert.deepEqual(result.holdings, { AAPL: 12 });
  assert.equal(result.cashBalance, 0);
  const { transactions } = await (await request("/ai-portfolio/transactions")).json();
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].type, "transfer_in");
  assert.equal(transactions[0].amount, 2040);
  assert.equal(transactions[0].price, 170);
  assert.equal((await request("", { ...reviewed, name: "Conflicting draft" })).status, 409);
});
