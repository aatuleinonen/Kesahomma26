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
