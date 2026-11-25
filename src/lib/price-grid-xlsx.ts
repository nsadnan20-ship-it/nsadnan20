import type { ProductPriceGridRow } from "@/lib/api";

type CellValue = string | number | null | undefined;

const HEADERS = [
  "م", "كود الصنف", "اسم الصنف", "الوحدة", "",
  "السعر الأساسي", "جملة الجملة", "جملة", "تجزئة",
  "المخزون الفعلي", "المحجوز", "المتاح", "نقطة إعادة الطلب", "عدد المخازن",
];

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function columnName(index: number): string {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function formatMoney(value: number): string {
  return value.toFixed(2);
}

function formatQuantity(value: number | null): string {
  if (value === null) return "";
  return value.toFixed(3);
}

function cellXml(reference: string, value: CellValue): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    return '<c r="' + reference + '" t="n"><v>' + String(value) + "</v></c>";
  }
  return (
    '<c r="' +
    reference +
    '" t="inlineStr"><is><t xml:space="preserve">' +
    xmlEscape(String(value)) +
    "</t></is></c>"
  );
}

function worksheetXml(rows: readonly (readonly CellValue[])[]): string {
  const maxColumns = Math.max(1, ...rows.map((row) => row.length));
  const lastColumn = columnName(maxColumns - 1);
  const rowXml = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, columnIndex) =>
          cellXml(columnName(columnIndex) + (rowIndex + 1), value),
        )
        .join("");
      return '<row r="' + (rowIndex + 1) + '">' + cells + "</row>";
    })
    .join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="18"/><sheetData>' +
    rowXml +
    '</sheetData><autoFilter ref="A1:' +
    lastColumn +
    rows.length +
    '"/></worksheet>'
  );
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let bit = 0; bit < 8; bit += 1)
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function write16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}
function write32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function zipStore(files: readonly { name: string; content: string }[]): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;
  let centralSize = 0;
  const utf8Flag = 0x0800;
  const dosDate = 0x0021;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const localHeader = new Uint8Array(30 + name.length);
    const localView = new DataView(localHeader.buffer);
    write32(localView, 0, 0x04034b50);
    write16(localView, 4, 20);
    write16(localView, 6, utf8Flag);
    write16(localView, 8, 0);
    write16(localView, 10, 0);
    write16(localView, 12, dosDate);
    write32(localView, 14, crc);
    write32(localView, 18, data.length);
    write32(localView, 22, data.length);
    write16(localView, 26, name.length);
    write16(localView, 28, 0);
    localHeader.set(name, 30);
    localParts.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + name.length);
    const centralView = new DataView(centralHeader.buffer);
    write32(centralView, 0, 0x02014b50);
    write16(centralView, 4, 20);
    write16(centralView, 6, 20);
    write16(centralView, 8, utf8Flag);
    write16(centralView, 10, 0);
    write16(centralView, 12, 0);
    write16(centralView, 14, dosDate);
    write32(centralView, 16, crc);
    write32(centralView, 20, data.length);
    write32(centralView, 24, data.length);
    write16(centralView, 28, name.length);
    write16(centralView, 30, 0);
    write16(centralView, 32, 0);
    write16(centralView, 34, 0);
    write16(centralView, 36, 0);
    write32(centralView, 38, 0);
    write32(centralView, 42, localOffset);
    centralHeader.set(name, 46);
    centralParts.push(centralHeader);
    localOffset += localHeader.length + data.length;
    centralSize += centralHeader.length;
  }

  const centralOffset = localOffset;
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  write32(endView, 0, 0x06054b50);
  write16(endView, 4, 0);
  write16(endView, 6, 0);
  write16(endView, 8, files.length);
  write16(endView, 10, files.length);
  write32(endView, 12, centralSize);
  write32(endView, 16, centralOffset);
  write16(endView, 20, 0);

  const output = new Uint8Array(centralOffset + centralSize + end.length);
  let offset = 0;
  for (const part of localParts) {
    output.set(part, offset);
    offset += part.length;
  }
  for (const part of centralParts) {
    output.set(part, offset);
    offset += part.length;
  }
  output.set(end, offset);
  return output;
}

function buildRows(rows: readonly ProductPriceGridRow[]): CellValue[][] {
  const result: CellValue[][] = [[...HEADERS]];
  rows.forEach((row, index) => {
    result.push([
      index + 1,
      String(row.item_code),
      String(row.name),
      String(row.unit),
      "",
      formatMoney(row.base_price),
      formatMoney(row.price_wholesale_of_wholesale),
      formatMoney(row.price_wholesale),
      formatMoney(row.price_retail),
      row.quantity_on_hand_total === null ? "" : formatQuantity(row.quantity_on_hand_total),
      row.quantity_reserved_total === null ? "" : formatQuantity(row.quantity_reserved_total),
      row.quantity_available_total === null ? "" : formatQuantity(row.quantity_available_total),
      row.reorder_point_total === null ? "" : String(row.reorder_point_total),
      String(row.inventory_warehouse_count),
    ]);
  });
  return result;
}

function workbookFiles(rows: readonly ProductPriceGridRow[]): {
  name: string;
  content: string;
}[] {
  const dataRows = buildRows(rows);
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    "</Types>";
  const packageRelationships =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    "</Relationships>";
  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="شبكة الأسعار" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029"/></workbook>';
  const workbookRelationships =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    "</Relationships>";
  return [
    { name: "[Content_Types].xml", content: contentTypes },
    { name: "_rels/.rels", content: packageRelationships },
    { name: "xl/workbook.xml", content: workbook },
    { name: "xl/_rels/workbook.xml.rels", content: workbookRelationships },
    { name: "xl/worksheets/sheet1.xml", content: worksheetXml(dataRows) },
  ];
}

export function buildPriceGridXlsx(rows: readonly ProductPriceGridRow[]): Blob {
  const bytes = zipStore(workbookFiles(rows));
  return new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export function downloadPriceGridXlsx(rows: readonly ProductPriceGridRow[]): void {
  const blob = buildPriceGridXlsx(rows);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "price-grid.xlsx";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
