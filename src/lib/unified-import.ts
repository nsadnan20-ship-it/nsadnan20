export const MAX_IMPORT_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 100_000;
export const MAX_IMPORT_COLUMNS = 100;
export const MAX_IMPORT_CELL_CHARS = 4_000;
export const UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
export const PROCESSING_CHUNK_ROWS = 500;

export const DEFAULT_SYNONYMS: Record<string, string> = {
  "رمز الصنف": "item_code",
  "كود الصنف": "item_code",
  "اسم الصنف": "product_name",
  "اسم المنتج": "product_name",
  "الكمية": "quantity",
  "الوحدة": "unit",
  "السعر": "unit_price",
  "تاريخ": "date",
  "رقم العميل": "customer_code",
  "اسم العميل": "customer_name",
};

// ─── Types ───

export type ParsedImportRow = {
  row_number: number;
  data: Record<string, unknown>;
  status: "valid" | "rejected";
  errors: string[];
};

export type QualityResult = {
  score: number;
  label: string;
  totalRows: number;
  validRows: number;
  rejectedRows: number;
  warningRows: number;
  missingRequired: number;
  duplicates: number;
  byField: Record<string, { valid: number; rejected: number }>;
};

export type VerifiedImportChunk = {
  chunk_number: number;
  byte_offset: number;
  byte_size: number;
  chunk_hash: string;
};

// ─── SHA-256 ───

export class IncrementalSha256 {
  private state: Uint32Array;
  private buffer: Uint8Array = new Uint8Array(64);
  private bufferLength = 0;
  private totalLength = 0;

  constructor() {
    this.state = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
  }

  update(data: Uint8Array): this {
    this.totalLength += data.length;
    let offset = 0;
    if (this.bufferLength > 0) {
      const needed = 64 - this.bufferLength;
      const toCopy = Math.min(needed, data.length);
      this.buffer.set(data.subarray(0, toCopy), this.bufferLength);
      this.bufferLength += toCopy;
      offset = toCopy;
      if (this.bufferLength === 64) {
        this.processBlock(this.buffer);
        this.bufferLength = 0;
      }
    }
    while (offset + 64 <= data.length) {
      this.processBlock(data.subarray(offset, offset + 64));
      offset += 64;
    }
    if (offset < data.length) {
      const remaining = data.length - offset;
      this.buffer.set(data.subarray(offset), 0);
      this.bufferLength = remaining;
    }
    return this;
  }

  digestHex(): string {
    const savedBuffer = this.buffer.slice(0, this.bufferLength);
    const savedLength = this.bufferLength;
    const savedTotal = this.totalLength;

    const pad = new Uint8Array(64);
    pad[0] = 0x80;
    const bitLength = BigInt(this.totalLength) * 8n;
    const padOffset = this.bufferLength < 56 ? 56 : 64;

    const finalBuffer = new Uint8Array(padOffset + 8);
    finalBuffer.set(savedBuffer, 0);
    finalBuffer[savedLength] = 0x80;
    const view = new DataView(finalBuffer.buffer);
    view.setUint32(finalBuffer.length - 8, Number(bitLength >> 32n), false);
    view.setUint32(finalBuffer.length - 4, Number(bitLength & 0xffffffffn), false);

    let offset = 0;
    while (offset < finalBuffer.length) {
      this.processBlock(finalBuffer.subarray(offset, offset + 64));
      offset += 64;
    }

    const result = Array.from(this.state)
      .map((v) => v >>> 0)
      .map((v) => v.toString(16).padStart(8, "0"))
      .join("");

    // Reset state
    this.state = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    this.buffer = new Uint8Array(64);
    this.bufferLength = 0;
    this.totalLength = 0;

    return result;
  }

  private processBlock(block: Uint8Array): void {
    const K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
      0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
      0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
      0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
      0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
      0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
      0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
      0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
      0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];

    const w = new Uint32Array(64);
    const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = this.state;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    this.state[0] = (this.state[0] + a) >>> 0;
    this.state[1] = (this.state[1] + b) >>> 0;
    this.state[2] = (this.state[2] + c) >>> 0;
    this.state[3] = (this.state[3] + d) >>> 0;
    this.state[4] = (this.state[4] + e) >>> 0;
    this.state[5] = (this.state[5] + f) >>> 0;
    this.state[6] = (this.state[6] + g) >>> 0;
    this.state[7] = (this.state[7] + h) >>> 0;
  }
}

function rotr(value: number, count: number): number {
  return ((value >>> count) | (value << (32 - count))) >>> 0;
}

export async function hashFileSha256(
  file: File,
  onProgress?: (bytesProcessed: number) => void,
): Promise<string> {
  const hasher = new IncrementalSha256();
  const chunkSize = 1024 * 1024;
  let processed = 0;
  for (let offset = 0; offset < file.size; offset += chunkSize) {
    const slice = file.slice(offset, Math.min(file.size, offset + chunkSize));
    const bytes = new Uint8Array(await slice.arrayBuffer());
    hasher.update(bytes);
    processed += bytes.length;
    onProgress?.(processed);
  }
  return hasher.digestHex();
}

// ─── Stable JSON ───

export function stableJsonStringify(value: unknown): string {
  if (value === undefined) throw new Error("القيمة غير قابلة للبصم (undefined).");
  return stringifySorted(value);
}

function stringifySorted(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return "[" + value.map(stringifySorted).join(",") + "]";
  if (typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return "{" + entries.map(([k, v]) => JSON.stringify(k) + ":" + stringifySorted(v)).join(",") + "}";
  }
  return JSON.stringify(value);
}

// ─── Header normalization ───

export function normalizeHeader(
  raw: string,
  synonyms?: Record<string, string>,
): string {
  const normalized = raw.trim().toLocaleLowerCase("ar").replace(/[ـ_-]+/g, " ").replace(/\s+/g, " ");
  const map = synonyms ?? DEFAULT_SYNONYMS;
  if (map[normalized]) return map[normalized];
  // Try the raw trimmed key
  const rawTrimmed = raw.trim();
  if (map[rawTrimmed]) return map[rawTrimmed];
  // Check if it already matches a canonical field name
  if (/^[a-z][a-z0-9_]{0,79}$/.test(normalized)) return normalized;
  return normalized;
}

// ─── CSV row validation ───

export function validateCsvRow(
  values: string[],
  headers: string[],
  rowNumber: number,
): ParsedImportRow {
  const data: Record<string, unknown> = {};
  const errors: string[] = [];
  for (let i = 0; i < values.length; i++) {
    const header = headers[i] ?? "";
    if (!header) continue;
    const cell = values[i] ?? "";
    if (cell.length > MAX_IMPORT_CELL_CHARS) {
      errors.push("قيمة العمود " + header + " تتجاوز " + MAX_IMPORT_CELL_CHARS + " حرفًا.");
      continue;
    }
    if (/^[+-]?\d+(\.\d*)?[eE][+-]?\d+$/.test(cell.trim()) ||
        /^(NaN|[+-]?Infinity)$/i.test(cell.trim())) {
      errors.push("قيمة رقمية غير صالحة في العمود " + header + ": " + cell.trim() + ".");
      continue;
    }
    data[header] = cell.trim() === "" ? "" : cell;
  }
  return { row_number: rowNumber, data, status: errors.length > 0 ? "rejected" : "valid", errors };
}

// ─── CSV streaming parser ───

export class StreamingCsvParser {
  private buffer = "";
  private inQuotes = false;
  private fieldBuffer = "";
  private rowBuffer: string[] = [];
  private headers: string[] | null = null;

  async push(
    chunk: string,
    onRow: (row: string[]) => void,
    isFinal = false,
  ): Promise<void> {
    this.buffer += chunk;
    let i = 0;
    while (i < this.buffer.length) {
      const char = this.buffer[i];
      if (this.inQuotes) {
        if (char === '"') {
          if (this.buffer[i + 1] === '"') {
            this.fieldBuffer += '"';
            i += 2;
          } else {
            this.inQuotes = false;
            i += 1;
          }
        } else {
          this.fieldBuffer += char;
          i += 1;
        }
      } else {
        if (char === '"') {
          this.inQuotes = true;
          i += 1;
        } else if (char === ",") {
          this.rowBuffer.push(this.fieldBuffer);
          this.fieldBuffer = "";
          i += 1;
        } else if (char === "\r") {
          // \r\n spans: wait for the next chunk if the newline is not buffered yet
          if (this.buffer[i + 1] === undefined && !isFinal) break;
          this.rowBuffer.push(this.fieldBuffer);
          this.fieldBuffer = "";
          if (this.buffer[i + 1] === "\n") i += 2;
          else i += 1;
          onRow(this.rowBuffer);
          this.rowBuffer = [];
        } else if (char === "\n") {
          this.rowBuffer.push(this.fieldBuffer);
          this.fieldBuffer = "";
          i += 1;
          onRow(this.rowBuffer);
          this.rowBuffer = [];
        } else {
          this.fieldBuffer += char;
          i += 1;
        }
      }
    }
    this.buffer = this.buffer.slice(i);
    if (isFinal) {
      if (this.fieldBuffer || this.rowBuffer.length > 0 || this.buffer) {
        // flush remaining
        if (this.buffer) {
          // process remaining buffer
          for (let j = 0; j < this.buffer.length; j++) {
            const char = this.buffer[j];
            if (this.inQuotes) {
              if (char === '"') {
                if (this.buffer[j + 1] === '"') {
                  this.fieldBuffer += '"';
                  j++;
                } else {
                  this.inQuotes = false;
                }
              } else {
                this.fieldBuffer += char;
              }
            } else {
              if (char === '"') {
                this.inQuotes = true;
              } else if (char === ",") {
                this.rowBuffer.push(this.fieldBuffer);
                this.fieldBuffer = "";
              } else if (char === "\r") {
                // skip
              } else if (char === "\n") {
                this.rowBuffer.push(this.fieldBuffer);
                this.fieldBuffer = "";
                onRow(this.rowBuffer);
                this.rowBuffer = [];
              } else {
                this.fieldBuffer += char;
              }
            }
          }
        }
        if (this.fieldBuffer || this.rowBuffer.length > 0) {
          this.rowBuffer.push(this.fieldBuffer);
          this.fieldBuffer = "";
          onRow(this.rowBuffer);
          this.rowBuffer = [];
        }
      }
      this.buffer = "";
      this.inQuotes = false;
    }
  }
}

// ─── Data quality ───

export class DataQualityAccumulator {
  private totalRows = 0;
  private validRows = 0;
  private rejectedRows = 0;
  private warningRows = 0;
  private missingRequired = 0;
  private duplicates = 0;
  private seenKeys = new Set<string>();
  private byField: Record<string, { valid: number; rejected: number }> = {};
  private requiredColumns: string[];
  private matchingKey: string;

  constructor(requiredColumns: string[], matchingKey: string) {
    this.requiredColumns = requiredColumns;
    this.matchingKey = matchingKey;
    for (const col of requiredColumns) this.byField[col] = { valid: 0, rejected: 0 };
  }

  add(row: ParsedImportRow): void {
    this.totalRows += 1;
    if (row.status === "valid") this.validRows += 1;
    else if (row.status === "rejected") this.rejectedRows += 1;

    for (const col of this.requiredColumns) {
      const value = row.data[col];
      if (value === undefined || value === null || String(value).trim() === "") {
        this.missingRequired += 1;
        this.byField[col].rejected += 1;
      } else {
        this.byField[col].valid += 1;
      }
    }

    const keyValue = row.data[this.matchingKey];
    if (keyValue !== undefined && keyValue !== null && String(keyValue).trim() !== "") {
      const key = String(keyValue);
      if (this.seenKeys.has(key)) this.duplicates += 1;
      else this.seenKeys.add(key);
    }
  }

  result(): QualityResult {
    const score = this.totalRows === 0 ? 0 : Math.round((this.validRows / this.totalRows) * 100);
    let label = "excellent";
    if (score < 50) label = "poor";
    else if (score < 75) label = "fair";
    else if (score < 90) label = "good";
    return {
      score,
      label,
      totalRows: this.totalRows,
      validRows: this.validRows,
      rejectedRows: this.rejectedRows,
      warningRows: this.warningRows,
      missingRequired: this.missingRequired,
      duplicates: this.duplicates,
      byField: this.byField,
    };
  }
}

export function chooseImportStatus(score: number): string {
  if (score >= 75) return "completed";
  if (score >= 50) return "manual_review";
  return "rejected";
}

// ─── Import profile rules ───

type TransformationRule = { field: string; operation: string };
type ValidationRule = { field: string; rule: string; value?: unknown; values?: string[]; message?: string };

const ALLOWED_OPERATIONS = new Set([
  "trim", "lowercase", "uppercase", "to_number", "date_iso",
]);

const ALLOWED_VALIDATION_RULES = new Set([
  "required", "numeric", "min", "max", "safe_pattern", "enum",
]);

export function validateImportProfileRules(
  transformations: TransformationRule[],
  validations: ValidationRule[],
): void {
  for (const t of transformations) {
    if (!ALLOWED_OPERATIONS.has(t.operation))
      throw new Error("قاعدة تحويل غير مدعومة: " + t.operation);
  }
  for (const v of validations) {
    if (!ALLOWED_VALIDATION_RULES.has(v.rule))
      throw new Error("قاعدة تحقق غير مدعومة: " + v.rule);
    if (v.rule === "safe_pattern") {
      if (typeof v.value !== "string") throw new Error("نمط التحقق غير آمن.");
      try {
        const regex = new RegExp(v.value);
        // Test for ReDoS vulnerability — catastrophic backtracking patterns
        if (/(.+)\1\+|(.+)\2\+.*\2\+|\(\w+\)\+\w*\1|(\w+)\+\w*\3\+/.test(v.value) ||
            (v.value.includes(")+") && v.value.includes(")+"))) {
          // Simple heuristic: nested quantifiers
          const nested = /\([^)]*[+*?][^)]*\)[+*?]/.test(v.value) ||
            /\([^)]*[+*?][^)]*\)[^)]*[+*?]/.test(v.value) && v.value.includes(")+");
          if (nested) throw new Error("نمط التحقق غير آمن.");
        }
        void regex;
      } catch {
        throw new Error("نمط التحقق غير آمن.");
      }
    }
    if (v.rule === "enum") {
      if (!Array.isArray(v.values) || v.values.length > 100)
        throw new Error("قاعدة enum تتجاوز قائمة نصية مسموحة (100).");
    }
  }
}

export function applyImportProfileRules(
  row: ParsedImportRow,
  transformations: TransformationRule[],
  validations: ValidationRule[],
): ParsedImportRow {
  const data = { ...row.data };
  const errors = [...row.errors];

  for (const t of transformations) {
    const value = data[t.field];
    if (value === undefined) continue;
    const str = String(value);
    switch (t.operation) {
      case "trim": data[t.field] = str.trim(); break;
      case "lowercase": data[t.field] = str.trim().toLowerCase(); break;
      case "uppercase": data[t.field] = str.trim().toUpperCase(); break;
      case "to_number": {
        const num = Number(str.trim());
        if (!Number.isFinite(num)) {
          errors.push("قيمة " + t.field + " ليست رقمًا صالحًا.");
        } else {
          data[t.field] = str.trim();
        }
        break;
      }
      case "date_iso": {
        const trimmed = str.trim();
        const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
        if (match) {
          const day = match[1].padStart(2, "0");
          const month = match[2].padStart(2, "0");
          const year = match[3];
          data[t.field] = year + "-" + month + "-" + day;
        } else {
          data[t.field] = trimmed;
        }
        break;
      }
    }
  }

  for (const v of validations) {
    const value = data[v.field];
    const str = value === undefined || value === null ? "" : String(value);
    switch (v.rule) {
      case "required":
        if (!str.trim()) errors.push(v.message ?? (v.field + " مطلوب."));
        break;
      case "numeric":
        if (str.trim() && (!/^[0-9]*\.?[0-9]+$/.test(str.trim()) || /^0\d/.test(str.trim()) && !str.trim().startsWith("0."))) {
          if (str.trim() && !/^(0|[1-9]\d*)(?:\.\d+)?$/.test(str.trim())) {
            errors.push("قيمة " + v.field + " ليست رقمًا صالحًا.");
          }
        }
        break;
      case "min":
        if (str.trim() && Number(str) < Number(v.value)) errors.push(v.field + " أقل من الحد الأدنى.");
        break;
      case "max":
        if (str.trim() && Number(str) > Number(v.value)) errors.push(v.field + " أكبر من الحد الأقصى.");
        break;
      case "safe_pattern":
        if (str.trim() && typeof v.value === "string") {
          try {
            if (!new RegExp(v.value).test(str)) errors.push(v.field + " لا يطابق النمط المطلوب.");
          } catch { /* skip invalid regex */ }
        }
        break;
      case "enum":
        if (str.trim() && Array.isArray(v.values) && !v.values.includes(str.trim()))
          errors.push(v.field + " ليس ضمن القيم المسموحة.");
        break;
    }
  }

  return {
    row_number: row.row_number,
    data,
    status: errors.length > 0 ? "rejected" : "valid",
    errors,
  };
}

// ─── Verified chunk prefix validation ───

export function validateVerifiedImportChunkPrefix(
  chunks: VerifiedImportChunk[],
  fileSize: number,
  chunkSize: number,
): number[] {
  if (fileSize <= 0 || fileSize > MAX_IMPORT_FILE_BYTES)
    throw new Error("حجم الملف غير صالح.");
  const sorted = [...chunks].sort((a, b) => a.chunk_number - b.chunk_number);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].chunk_number !== i) throw new Error("فجوة في تسلسل الشرائح.");
  }
  let expectedOffset = 0;
  const result: number[] = [];
  for (const chunk of sorted) {
    if (chunk.byte_offset !== expectedOffset)
      throw new Error("إزاحة الشريحة غير متطابقة مع التسلسل المتوقع.");
    if (chunk.byte_size <= 0 || chunk.byte_size > chunkSize)
      throw new Error("حجم الشريحة غير متطابقة.");
    if (!/^[a-f0-9]{64}$/.test(chunk.chunk_hash))
      throw new Error("بصمة الشريحة غير متطابقة.");
    if (expectedOffset + chunk.byte_size > fileSize)
      throw new Error("أكثر من حجم الملف.");
    expectedOffset += chunk.byte_size;
    result.push(chunk.chunk_number);
  }
  return result;
}

// ─── Row persistence gating ───

export function shouldPersistParsedImportRow(
  chunkNumber: number,
  verifiedChunks: Set<number>,
  isFinalizing = false,
): boolean {
  if (isFinalizing && verifiedChunks.has(chunkNumber)) return true;
  return !verifiedChunks.has(chunkNumber);
}

// ─── XLSX parsing ───

type XlsxRow = { cells: Array<{ ref: string; type: string; value: string; style?: number }> };

function parseXmlSharedStrings(xml: string): string[] {
  const result: string[] = [];
  const siRegex = /<si[^>]*>([\s\S]*?)<\/si>/g;
  let match: RegExpExecArray | null;
  while ((match = siRegex.exec(xml)) !== null) {
    const textMatches = match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g);
    let text = "";
    for (const tm of textMatches) text += tm[1];
    result.push(decodeXmlEntities(text));
  }
  return result;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseNumFmt(xml: string): Map<number, string> {
  const result = new Map<number, string>();
  const regex = /<numFmt\s+numFmtId="(\d+)"\s+formatCode="([^"]*)"[^/]*\/>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    result.set(Number(match[1]), match[2]);
  }
  return result;
}

function parseStyles(xml: string): number[] {
  const result: number[] = [];
  const xfRegex = /<xf[^>]*numFmtId="(\d+)"[^/]*\/?>/g;
  let match: RegExpExecArray | null;
  while ((match = xfRegex.exec(xml)) !== null) {
    result.push(Number(match[1]));
  }
  return result;
}

function parseWorksheet(xml: string, sharedStrings: string[], numFmts: Map<number, string>, styles: number[]): XlsxRow[] {
  const rows: XlsxRow[] = [];
  const rowRegex = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(xml)) !== null) {
    const cells: XlsxRow["cells"] = [];
    const cellRegex = /<c\s+([^>]*?)(?:\/>|>(?:<v>([\s\S]*?)<\/v>|<is><t[^>]*>([\s\S]*?)<\/t><\/is>)?<\/c>)/g;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      const attrs = cellMatch[1];
      const refMatch = /r="([A-Z]+\d+)"/.exec(attrs);
      const typeMatch = /t="(\w+)"/.exec(attrs);
      const styleMatch = /s="(\d+)"/.exec(attrs);
      const ref = refMatch ? refMatch[1] : "";
      const type = typeMatch ? typeMatch[1] : "n";
      const style = styleMatch ? Number(styleMatch[1]) : undefined;
      let value = "";
      if (cellMatch[2] !== undefined) value = cellMatch[2];
      else if (cellMatch[3] !== undefined) value = decodeXmlEntities(cellMatch[3]);
      cells.push({ ref, type, value, style });
    }
    rows.push({ cells });
  }
  return rows;
}

function columnNameToIndex(ref: string): number {
  const match = /^([A-Z]+)/.exec(ref);
  if (!match) return 0;
  let result = 0;
  for (const ch of match[1]) result = result * 26 + (ch.charCodeAt(0) - 64);
  return result - 1;
}

function applyZeroMask(formatCode: string, numValue: number): string {
  if (!formatCode.includes("0")) return String(numValue);
  // Simple zero-mask: count digits before decimal in format
  const match = /^0+/.exec(formatCode.replace(/[^0#]/g, ""));
  if (!match) return String(numValue);
  const minDigits = match[0].length;
  const str = String(Math.trunc(numValue));
  return str.padStart(minDigits, "0");
}

// Minimal ZIP reader (stored entries, no compression)
function readZipEntries(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder("utf-8");
  const entries = new Map<string, string>();

  // Find End of Central Directory
  if (view.getUint32(0, true) === 0x04034b50) {
    // Has local file header at start — parse sequentially
    let offset = 0;
    while (offset + 30 <= bytes.length) {
      const sig = view.getUint32(offset, true);
      if (sig !== 0x04034b50) break;
      const nameLen = view.getUint16(offset + 26, true);
      const extraLen = view.getUint16(offset + 28, true);
      const compressedSize = view.getUint32(offset + 18, true);
      const compressionMethod = view.getUint16(offset + 8, true);
      const nameStart = offset + 30;
      const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLen));
      const dataStart = nameStart + nameLen + extraLen;
      if (compressionMethod !== 0) throw new Error("ملف XLSX مضغوط بطريقة غير مدعومة.");
      const content = decoder.decode(bytes.subarray(dataStart, dataStart + compressedSize));
      entries.set(name, content);
      offset = dataStart + compressedSize;
    }
  }

  return entries;
}

async function blobToBytes(file: Blob | File): Promise<Uint8Array> {
  if (typeof (file as Blob).arrayBuffer === "function") {
    return new Uint8Array(await (file as Blob).arrayBuffer());
  }
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      reader.result instanceof ArrayBuffer ? resolve(reader.result) : reject(new Error("تعذّر قراءة الملف."));
    reader.onerror = () => reject(reader.error ?? new Error("تعذّر قراءة الملف."));
    reader.readAsArrayBuffer(file);
  });
  return new Uint8Array(buffer);
}

export async function parseXlsxFirstWorksheet(
  file: Blob | File,
  onRow: (row: string[]) => void,
): Promise<{ rowCount: number; worksheetName: string }> {
  const bytes = await blobToBytes(file);

  // Verify ZIP signature
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    throw new Error("ترويسة ZIP غير صالحة؛ الملف ليس مصنف XLSX صالحًا.");
  }

  const entries = readZipEntries(bytes);
  const workbookXml = entries.get("xl/workbook.xml");
  if (!workbookXml) throw new Error("ملف XLSX لا يحتوي على مصنف.");
  const relsXml = entries.get("xl/_rels/workbook.xml.rels");
  if (!relsXml) throw new Error("ملف XLSX لا يحتوي على علاقات المصنف.");

  // Parse first sheet name and target
  const sheetMatch = /<sheet\s+[^>]*name="([^"]*)"[^>]*r:id="(rId\d+)"/.exec(workbookXml) ??
    /<sheet\s+[^>]*name="([^"]*)"[^>]*sheetId="[^"]*"/.exec(workbookXml);
  const worksheetName = sheetMatch ? sheetMatch[1] : "Sheet1";
  const rId = sheetMatch ? sheetMatch[2] : "rId1";

  const relMatch = new RegExp('<Relationship\\s+Id="' + rId + '"[^>]*Target="([^"]*)"').exec(relsXml);
  const target = relMatch ? relMatch[1] : "worksheets/sheet1.xml";
  const worksheetKey = target.startsWith("/") ? target.slice(1) : "xl/" + target;
  const worksheetXml = entries.get(worksheetKey);
  if (!worksheetXml) throw new Error("ملف XLSX لا يحتوي على ورقة العمل.");

  const sharedStringsXml = entries.get("xl/sharedStrings.xml") ?? "";
  const sharedStrings = sharedStringsXml ? parseXmlSharedStrings(sharedStringsXml) : [];

  const stylesXml = entries.get("xl/styles.xml") ?? "";
  const numFmts = stylesXml ? parseNumFmt(stylesXml) : new Map<number, string>();
  const styles = stylesXml ? parseStyles(stylesXml) : [];

  const rows = parseWorksheet(worksheetXml, sharedStrings, numFmts, styles);
  let prevColCount = 0;
  for (const row of rows) {
    if (row.cells.length === 0) {
      onRow([]);
      continue;
    }
    const maxCol = Math.max(...row.cells.map((c) => columnNameToIndex(c.ref)), prevColCount - 1);
    const colCount = Math.max(maxCol + 1, prevColCount);
    prevColCount = colCount;
    const values: string[] = new Array(colCount).fill("");
    for (const cell of row.cells) {
      const colIndex = columnNameToIndex(cell.ref);
      if (cell.type === "s") {
        const idx = parseInt(cell.value, 10);
        values[colIndex] = sharedStrings[idx] ?? "";
      } else if (cell.type === "inlineStr") {
        values[colIndex] = cell.value;
      } else if (cell.type === "n" || cell.type === "") {
        // Check for zero-mask format
        let displayValue = cell.value;
        if (cell.style !== undefined && cell.style < styles.length) {
          const fmtId = styles[cell.style];
          const fmtCode = numFmts.get(fmtId);
          if (fmtCode && fmtCode.includes("0") && cell.value) {
            displayValue = applyZeroMask(fmtCode, Number(cell.value));
          }
        }
        values[colIndex] = displayValue;
      } else {
        values[colIndex] = cell.value;
      }
    }
    onRow(values);
  }

  return { rowCount: rows.length, worksheetName };
}
