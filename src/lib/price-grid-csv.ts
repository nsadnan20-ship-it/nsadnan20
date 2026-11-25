import type { ProductPriceGridRow } from "@/lib/api";

const HEADERS = [
  "م", "كود الصنف", "اسم الصنف", "الوحدة", "",
  "السعر الأساسي", "جملة الجملة", "جملة", "تجزئة",
  "المخزون الفعلي", "المحجوز", "المتاح", "نقطة إعادة الطلب", "عدد المخازن",
];

type PriceDraft = {
  basePrice: string;
  wholesaleOfWholesale: string;
  wholesale: string;
  retail: string;
};

type ParseResult = {
  itemCount: number;
  drafts: Record<string, PriceDraft>;
};

function escapeCsvCell(value: string, forceQuote = false): string {
  const sanitized = value.replace(/\r?\n/g, " ");
  if (forceQuote || /[",\r\n]/.test(sanitized)) {
    return '"' + sanitized.replace(/"/g, '""') + '"';
  }
  return sanitized;
}

function formulaGuard(value: string): string {
  const trimmed = value.trim();
  if (/^[=+\-@]/.test(trimmed)) return "'" + trimmed;
  return value;
}

function formatMoney(value: number): string {
  return value.toFixed(2);
}

function formatQuantity(value: number | null): string {
  if (value === null) return "";
  return value.toFixed(3);
}

function formatInt(value: number | null): string {
  if (value === null) return "";
  return String(value);
}

export function buildPriceGridCsv(rows: readonly ProductPriceGridRow[]): string {
  const lines: string[] = [];
  lines.push(HEADERS.map((h) => escapeCsvCell(h, h !== "")).join(","));
  rows.forEach((row, index) => {
    const idCell = '"' + String(index + 1) + '"';
    const codeCell = '"' + formulaGuard(row.item_code).replace(/"/g, '""') + '"';
    const nameCell = '"' + formulaGuard(row.name).replace(/"/g, '""') + '"';
    const unitCell = '"' + row.unit.replace(/"/g, '""') + '"';
    const emptyCell = '""';
    const priceCells = [
      formatMoney(row.base_price),
      formatMoney(row.price_wholesale_of_wholesale),
      formatMoney(row.price_wholesale),
      formatMoney(row.price_retail),
    ].map((v) => '"' + v + '"').join(",");
    const quantityCells = [
      formatQuantity(row.quantity_on_hand_total),
      formatQuantity(row.quantity_reserved_total),
      formatQuantity(row.quantity_available_total),
      formatInt(row.reorder_point_total),
      formatInt(row.inventory_warehouse_count),
    ].map((v) => '"' + v + '"').join(",");
    lines.push([idCell, codeCell, nameCell, unitCell, emptyCell, priceCells, quantityCells].join(","));
  });
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

export function downloadPriceGridCsv(rows: readonly ProductPriceGridRow[]): void {
  const csv = buildPriceGridCsv(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "price-grid.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let i = 0;
  let current = "";
  let inQuotes = false;
  while (i < line.length) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        current += char;
        i += 1;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i += 1;
      } else if (char === ",") {
        cells.push(current);
        current = "";
        i += 1;
      } else {
        current += char;
        i += 1;
      }
    }
  }
  cells.push(current);
  return cells;
}

function parseCsv(csv: string): string[][] {
  const lines: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (inQuotes) {
      current += char;
      if (char === '"') {
        if (csv[i + 1] === '"') {
          current += csv[i + 1];
          i += 1;
        } else {
          inQuotes = false;
        }
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        current += char;
      } else if (char === "\r") {
        // skip, \n will handle line break
      } else if (char === "\n") {
        lines.push(current);
        current = "";
      } else {
        current += char;
      }
    }
  }
  if (current.trim()) lines.push(current);

  return lines.filter((line) => line.length > 0).map(parseCsvLine);
}

const PRICE_RE = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/;

function normalizePrice(value: string): string {
  const trimmed = value.trim();
  if (!PRICE_RE.test(trimmed)) throw new Error("قيمة سعر غير صالحة: " + trimmed);
  return trimmed.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

export function parsePriceGridRecords(
  records: string[][],
  products: readonly ProductPriceGridRow[],
): ParseResult {
  if (records.length < 2) throw new Error("الملف لا يحتوي على بيانات.");
  const header = records[0];
  const codeIndex = header.findIndex((h) => h.includes("كود") || h.toLowerCase().includes("code"));
  if (codeIndex < 0) throw new Error("عمود كود الصنف غير موجود.");

  const colMap: Record<string, number> = {};
  for (let i = 0; i < header.length; i++) {
    const h = header[i].trim();
    if (h.includes("السعر الأساسي")) colMap.basePrice = i;
    else if (h.includes("جملة الجملة")) colMap.wholesaleOfWholesale = i;
    else if (h === "جملة" || h.includes("جملة")) {
      if (colMap.wholesale === undefined && !h.includes("الجملة")) colMap.wholesale = i;
    }
    else if (h.includes("تجزئة")) colMap.retail = i;
  }

  const byCode = new Map<string, ProductPriceGridRow>();
  for (const p of products) byCode.set(p.item_code, p);

  const drafts: Record<string, PriceDraft> = {};
  const seen = new Set<string>();
  let itemCount = 0;
  const unknownCodes: string[] = [];

  for (let r = 1; r < records.length; r++) {
    const row = records[r];
    if (!row || row.every((c) => !c.trim())) continue;
    const code = (row[codeIndex] ?? "").trim();
    if (!code) continue;
    if (!byCode.has(code)) {
      unknownCodes.push(code);
      continue;
    }
    if (seen.has(code)) throw new Error("كود صنف مكرر في الملف: " + code);
    seen.add(code);

    const product = byCode.get(code)!;
    const basePrice = normalizePrice(row[colMap.basePrice ?? 3] ?? "");
    const wholesaleOfWholesale = normalizePrice(row[colMap.wholesaleOfWholesale ?? 4] ?? "");
    const wholesale = normalizePrice(row[colMap.wholesale ?? 5] ?? "");
    const retail = normalizePrice(row[colMap.retail ?? 6] ?? "");

    drafts[product.id] = { basePrice, wholesaleOfWholesale, wholesale, retail };
    itemCount += 1;
  }

  if (unknownCodes.length > 0)
    throw new Error("أكواد غير موجودة: " + unknownCodes.join(", "));

  return { itemCount, drafts };
}

export function parsePriceGridCsv(
  csv: string,
  products: readonly ProductPriceGridRow[],
): ParseResult {
  // Strip BOM
  const cleaned = csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv;
  const records = parseCsv(cleaned);
  return parsePriceGridRecords(records, products);
}
