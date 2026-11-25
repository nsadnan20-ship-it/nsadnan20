export type InventoryTransferBatchLineInput = {
  productId: string;
  quantity: number;
};

export type InventoryTransferBatchDraft = {
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  reason: string;
  lines: InventoryTransferBatchLineInput[];
};

export type InventoryTransferBatchInput = InventoryTransferBatchDraft & {
  idempotencyKey: string;
};

export type ValidatedInventoryTransferBatch = {
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  reason: string;
  lines: InventoryTransferBatchLineInput[];
  idempotencyKey: string;
};

export type InventoryTransferBatchResult = {
  batch_id: string;
  idempotent_replay: boolean;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LINES = 200;
const MAX_REASON = 500;
const IDEMPOTENCY_RE = /^[A-Za-z0-9_-]{16,128}$/;

export function normalizeInventoryTransferBatchDraft(
  draft: InventoryTransferBatchDraft,
): InventoryTransferBatchDraft {
  if (!draft || typeof draft !== "object") throw new Error("بيانات دفعة التحويل غير صالحة.");
  const sourceWarehouseId = String(draft.sourceWarehouseId ?? "").trim();
  const destinationWarehouseId = String(draft.destinationWarehouseId ?? "").trim();
  const reason = String(draft.reason ?? "").trim();

  if (!sourceWarehouseId || !UUID_RE.test(sourceWarehouseId))
    throw new Error("معرّف المستودع المصدر غير صالح.");
  if (!destinationWarehouseId || !UUID_RE.test(destinationWarehouseId))
    throw new Error("معرّف المستودع الوجهة غير صالح.");
  if (sourceWarehouseId === destinationWarehouseId)
    throw new Error("يجب اختيار مستودعين مختلفين للتحويل.");
  if (!reason) throw new Error("سبب التحويل مطلوب.");
  if (reason.length > MAX_REASON)
    throw new Error("سبب التحويل يتجاوز الحد المسموح (" + MAX_REASON + " حرفًا).");

  if (!Array.isArray(draft.lines) || draft.lines.length === 0)
    throw new Error("يجب أن تحتوي دفعة التحويل على بند واحد على الأقل.");
  if (draft.lines.length > MAX_LINES)
    throw new Error("تجاوزت دفعة التحويل الحد الأقصى " + MAX_LINES + " بند.");

  const seen = new Set<string>();
  const sorted = [...draft.lines].sort((a, b) =>
    a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0,
  );
  const normalizedLines: InventoryTransferBatchLineInput[] = [];
  for (const line of sorted) {
    if (!line || typeof line !== "object") throw new Error("بند التحويل غير صالح.");
    const productId = String(line.productId ?? "").trim();
    if (!productId || !UUID_RE.test(productId))
      throw new Error("معرّف المنتج في بند التحويل غير صالح.");
    if (seen.has(productId)) throw new Error("تكرار المنتج في دفعة التحويل غير مسموح.");
    seen.add(productId);
    const quantity = Number(line.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0)
      throw new Error("كمية التحويل يجب أن تكون رقمًا موجبًا.");
    if (Math.round(quantity * 1000) !== quantity * 1000)
      throw new Error("كمية التحويل يجب ألا تتجاوز ثلاث منازل عشرية.");
    if (quantity > 999999999999.999)
      throw new Error("كمية التحويل تتجاوز الحد المسموح.");
    normalizedLines.push({ productId, quantity });
  }

  return { sourceWarehouseId, destinationWarehouseId, reason, lines: normalizedLines };
}

export function inventoryTransferBatchSignature(
  draft: InventoryTransferBatchDraft,
): string {
  const normalized = normalizeInventoryTransferBatchDraft(draft);
  const payload = [
    normalized.sourceWarehouseId,
    normalized.destinationWarehouseId,
    normalized.reason,
    normalized.lines.map((l) => l.productId + ":" + l.quantity).join(","),
  ].join("|");
  return payload;
}

export function validateInventoryTransferBatchInput(
  input: InventoryTransferBatchInput,
): ValidatedInventoryTransferBatch {
  const normalized = normalizeInventoryTransferBatchDraft(input);
  const idempotencyKey = String(input.idempotencyKey ?? "").trim();
  if (!IDEMPOTENCY_RE.test(idempotencyKey))
    throw new Error("مفتاح منع تكرار الدفعة غير صالح (16–128 حرفًا alphanumeric).");
  return { ...normalized, idempotencyKey };
}
