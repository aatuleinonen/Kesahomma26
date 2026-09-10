// Validates uploaded document bytes before they are persisted as import jobs.
const path = require("path");
const zlib = require("zlib");

const OLE_COMPOUND_SIGNATURE = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);

function hasPrefix(buffer, signature) {
  return buffer.length >= signature.length && buffer.subarray(0, signature.length).equals(signature);
}

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function readZipEntries(buffer) {
  const minimumEocdOffset = Math.max(0, buffer.length - 65557);
  let eocdOffset = -1;
  for (let offset = buffer.length - 22; offset >= minimumEocdOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054B50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0 || eocdOffset + 22 + buffer.readUInt16LE(eocdOffset + 20) !== buffer.length) {
    throw new Error("ZIP end-of-directory record is invalid");
  }

  const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
  const centralDirectoryDisk = buffer.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocdOffset + 8);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== entryCount
    || centralDirectoryOffset + centralDirectorySize !== eocdOffset) {
    throw new Error("Multi-disk or malformed ZIP archives are unsupported");
  }

  const entries = new Map();
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > eocdOffset || buffer.readUInt32LE(offset) !== 0x02014B50) {
      throw new Error("ZIP central directory is invalid");
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const compression = buffer.readUInt16LE(offset + 10);
    const expectedCrc = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const filenameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const nextOffset = offset + 46 + filenameLength + extraLength + commentLength;
    if ((flags & 1) !== 0 || nextOffset > eocdOffset || localHeaderOffset + 30 > centralDirectoryOffset
      || buffer.readUInt32LE(localHeaderOffset) !== 0x04034B50) {
      throw new Error("ZIP entry metadata is invalid");
    }

    const name = buffer.subarray(offset + 46, offset + 46 + filenameLength).toString("utf8");
    const localFilenameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localFilenameLength + localExtraLength;
    const dataEnd = dataOffset + compressedSize;
    if (!name || name.includes("\0") || dataEnd > centralDirectoryOffset) {
      throw new Error("ZIP entry bounds are invalid");
    }
    const compressed = buffer.subarray(dataOffset, dataEnd);
    const content = compression === 0
      ? compressed
      : compression === 8
        ? zlib.inflateRawSync(compressed)
        : (() => { throw new Error("ZIP compression method is unsupported"); })();
    if (content.length !== uncompressedSize || crc32(content) !== expectedCrc) {
      throw new Error("ZIP entry contents are corrupt");
    }
    entries.set(name, content);
    offset = nextOffset;
  }
  if (offset !== eocdOffset) throw new Error("ZIP central directory size is invalid");
  return entries;
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
    try {
      const entries = readZipEntries(buffer);
      return entries.has("[Content_Types].xml") && entries.has("_rels/.rels") && entries.has("xl/workbook.xml")
        ? null
        : "XLSX file is missing required workbook entries";
    } catch {
      return "XLSX file has an invalid workbook container";
    }
  }
  return "Unsupported document format";
}

module.exports = { validateUploadContent };
