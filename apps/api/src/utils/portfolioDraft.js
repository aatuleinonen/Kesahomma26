// Converts a holdings description into a structured, unsaved portfolio draft.
const { BedrockRuntimeClient, ConverseCommand } = require("@aws-sdk/client-bedrock-runtime");

const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION || "eu-north-1", maxAttempts: 1 });
const currencies = ["EUR", "USD", "GBP", "JPY"];
const tickerPattern = /^[A-Z0-9][A-Z0-9._:-]{0,19}$/;
const maxHoldings = 20;
const validNumber = (value, min) => typeof value === "number" && Number.isFinite(value)
  && value >= min && value <= 1e12;

function validateDraft(draft, allowMissingCost = false) {
  const name = typeof draft?.name === "string" ? draft.name.trim() : "";
  const description = typeof draft?.description === "string" ? draft.description.trim() : "";
  if (!name || name.length > 100 || description.length > 500 || !currencies.includes(draft.baseCurrency)) {
    throw new Error("Enter a portfolio name, supported currency, and a description up to 500 characters.");
  }
  if (!Array.isArray(draft.holdings) || draft.holdings.length > maxHoldings) {
    throw new Error(`A portfolio draft supports up to ${maxHoldings} starting holdings.`);
  }
  const holdings = draft.holdings.map((holding, index) => {
    const ticker = typeof holding?.ticker === "string" ? holding.ticker.trim().toUpperCase() : "";
    const quantity = holding?.quantity;
    const costBasis = holding?.costBasis;
    if (!tickerPattern.test(ticker) || !validNumber(quantity, 1e-8)
      || !(validNumber(costBasis, 0) || (allowMissingCost && costBasis === null))) {
      throw new Error(`Check the ticker, share count, and total cost for holding ${index + 1}.`);
    }
    return { ticker, quantity, costBasis };
  });
  return { name, description, baseCurrency: draft.baseCurrency, holdings };
}

const objectSchema = properties => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties
});
const schema = objectSchema({
  name: { type: "string" },
  description: { type: "string" },
  baseCurrency: { type: "string", enum: currencies },
  holdings: {
    type: "array",
    items: objectSchema({
      ticker: { type: "string" },
      quantity: { type: "number" },
      costBasis: { type: ["number", "null"] }
    })
  },
  notes: { type: "string" }
});

const instructions = [
  "Extract a portfolio draft from the user's description of holdings. This is data entry, never investment advice.",
  "Include at most 20 holdings with an identified ticker and explicit positive share quantity.",
  "Do not suggest securities or invent share quantities, prices, exchange rates or holdings.",
  "Cost basis is the total original cost in the portfolio currency. Use null when the user did not supply enough information or the currency differs.",
  "Never convert currencies. Use EUR when the currency is unspecified and mention that in notes.",
  "Use notes to flag ambiguous, unsupported or omitted entries. If the user requests investment recommendations, leave holdings empty and ask them to provide positions to track.",
  "Keep name under 100 characters and description under 500. Write a short, neutral description and avoid repeating personal information.",
  `Return only one JSON object matching this schema: ${JSON.stringify(schema)}`
].join(" ");

async function generatePortfolioDraft(description, modelId) {
  // First-use schema compilation can exceed the HTTP API deadline, so validate the JSON locally.
  const response = await bedrock.send(new ConverseCommand({
    modelId,
    system: [{ text: instructions }],
    messages: [{ role: "user", content: [{ text: description }] }],
    inferenceConfig: { maxTokens: 2200 }
  }), { abortSignal: AbortSignal.timeout(22000) });

  const content = response.output?.message?.content
    ?.map(block => block.text || "").join("").trim();
  if (response.stopReason !== "end_turn" || !content) {
    throw new Error("Bedrock did not return a complete portfolio draft");
  }
  const fenced = content.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const result = JSON.parse(fenced?.[1] ?? content);
  return { ...validateDraft(result, true), notes: typeof result.notes === "string" ? result.notes.slice(0, 1000) : "" };
}

module.exports = { generatePortfolioDraft, validateDraft };
