// Verifies parser validation and that persistence failures remain retryable.
const assert = require("node:assert/strict");
const { processDocumentImport } = require("./docParser");

const document = content => ({
  buffer: Buffer.from(content),
  metadata: { originalName: "holdings.csv", mimeType: "text/csv" }
});

async function expectRejected(run, message) {
  await assert.rejects(run, new RegExp(message));
}

async function main() {
  const successfulCases = [
    {
      content: "ticker,quantity,costBasis\nAAPL,2,300",
      expected: [{ ticker: "AAPL", quantity: 2, costBasis: 300 }]
    },
    {
      content: "symbol,quantity,cost_basis\nVOO,5,2000",
      expected: [{ ticker: "VOO", quantity: 5, costBasis: 2000 }]
    }
  ];
  for (const [index, testCase] of successfulCases.entries()) {
    let extracted;
    const status = await processDocumentImport("user", "portfolio", `mapping-${index}`, document(testCase.content), async (nextStatus, data) => {
      if (nextStatus === "READY_FOR_REVIEW") extracted = data;
    });
    assert.equal(status, "READY_FOR_REVIEW");
    assert.deepEqual(extracted, testCase.expected);
  }

  let encodingFailure;
  const invalidUtf8Status = await processDocumentImport("user", "portfolio", "invalid-utf8", {
    buffer: Buffer.from([0xff, 0xfe, 0xfd]),
    metadata: { originalName: "holdings.csv", mimeType: "text/csv" }
  }, async (status, data, error) => {
    if (status === "FAILED") encodingFailure = error;
  });
  assert.equal(invalidUtf8Status, "FAILED");
  assert.match(encodingFailure, /valid UTF-8/);

  for (const [value, expectedMessage] of [
    ["0x10", /non-decimal quantity/],
    ["0b10", /non-decimal quantity/],
    ["0o10", /non-decimal quantity/],
    ["1e126", /out-of-range quantity/],
    ["9007199254740993", /out-of-range quantity/],
    ["1e-200", /out-of-range quantity/]
  ]) {
    let numericFailure;
    const status = await processDocumentImport("user", "portfolio", `invalid-number-${value}`, document(`ticker,quantity,costBasis\nAAPL,${value},100`), async (nextStatus, data, error) => {
      if (nextStatus === "FAILED") numericFailure = error;
    });
    assert.equal(status, "FAILED");
    assert.match(numericFailure, expectedMessage);
  }

  await expectRejected(
    () => processDocumentImport("user", "portfolio", "processing-write", document("ticker,quantity,costBasis\nAAPL,1,100"), async status => {
      if (status === "PROCESSING") throw new Error("processing persistence failed");
    }),
    "processing persistence failed"
  );

  await expectRejected(
    () => processDocumentImport("user", "portfolio", "failed-write", document("ticker,quantity,costBasis\nAAPL,1,"), async status => {
      if (status === "FAILED") throw new Error("failed persistence failed");
    }),
    "failed persistence failed"
  );

  await expectRejected(
    () => processDocumentImport("user", "portfolio", "ready-write", document("ticker,description,quantity,costBasis\nAAPL,\"Apple, Inc.\",1,100"), async status => {
      if (status === "READY_FOR_REVIEW") throw new Error("ready persistence failed");
    }),
    "ready persistence failed"
  );

  const oversizedCsv = `ticker,quantity,costBasis\n${Array.from({ length: 8000 }, (_, index) => `T${index},1,100`).join("\n")}`;
  let failureMessage;
  const oversizedStatus = await processDocumentImport("user", "portfolio", "oversized-review", document(oversizedCsv), async (status, data, error) => {
    if (status === "FAILED") failureMessage = error;
  });
  assert.equal(oversizedStatus, "FAILED");
  assert.match(failureMessage, /too much review data/);

  console.log("Document parser tests passed");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
