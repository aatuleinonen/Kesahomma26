// Validates uploaded document bytes before they are persisted as import jobs.
const path = require("path");

const OLE_COMPOUND_SIGNATURE = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);

function hasPrefix(buffer, signature) {
  return buffer.length >= signature.length && buffer.subarray(0, signature.length).equals(signature);
}

function validateCsv(buffer) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return "CSV file must contain valid UTF-8 text";
  }
  if (text.includes("\0")) return "CSV file contains unsupported binary data";
  const firstLine = text.split(/\r?\n/).find(line => line.trim());
  if (!firstLine || !firstLine.includes(",")) return "CSV file must contain comma-separated data";

  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '"') continue;
    if (quoted && text[index + 1] === '"') index += 1;
    else quoted = !quoted;
  }
  return quoted ? "CSV file contains an unterminated quoted field" : null;
}

function validateUploadContent(originalName, buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return "Uploaded file is empty";
  const extension = path.extname(originalName || "").toLowerCase();

  if (extension === ".csv") return validateCsv(buffer);
  if (extension === ".pdf") {
    return hasPrefix(buffer, Buffer.from("%PDF-")) ? null : "PDF file has an invalid signature";
  }
  if (extension === ".xls") {
    return hasPrefix(buffer, OLE_COMPOUND_SIGNATURE) ? null : "XLS file has an invalid compound-document signature";
  }
  if (extension === ".xlsx") {
    const hasZipSignature = hasPrefix(buffer, Buffer.from([0x50, 0x4B, 0x03, 0x04]));
    const hasWorkbookEntries = buffer.includes(Buffer.from("[Content_Types].xml")) && buffer.includes(Buffer.from("xl/"));
    return hasZipSignature && hasWorkbookEntries ? null : "XLSX file has an invalid workbook container";
  }
  return "Unsupported document format";
}

module.exports = { validateUploadContent };
