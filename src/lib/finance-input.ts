const PAYMENT_METHODS = new Set(["cash", "transfer", "card", "other"]);

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(label + " يجب أن يكون نصًا صالحًا.");
  return value;
}

export function validateCustomerPaymentInput(
  amount: string,
  method: string,
  reference: string,
  notes: string,
): number {
  const amountText = requireString(amount, "مبلغ الدفعة");
  const methodText = requireString(method, "طريقة الدفع");
  const referenceText = requireString(reference, "مرجع العملية");
  const notesText = requireString(notes, "ملاحظات الدفعة");

  if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(amountText.trim()) || Number(amountText) <= 0) {
    throw new Error("أدخل مبلغ دفعة موجبًا بمنزلتين عشريتين كحد أقصى.");
  }
  const value = Number(amountText);
  if (!Number.isFinite(value)) throw new Error("أدخل مبلغ دفعة موجبًا بمنزلتين عشريتين كحد أقصى.");
  if (Math.round(value * 100) > Number.MAX_SAFE_INTEGER) {
    throw new Error("مبلغ الدفعة يتجاوز دقة الوحدة الصغرى المسموحة.");
  }
  if (!PAYMENT_METHODS.has(methodText)) throw new Error("طريقة الدفع غير مسموحة.");
  if (referenceText.length > 200) throw new Error("مرجع العملية لا يجوز أن يتجاوز 200 حرف.");
  if (notesText.length > 1000) throw new Error("الملاحظات لا يجوز أن تتجاوز 1000 حرف.");
  return value;
}
