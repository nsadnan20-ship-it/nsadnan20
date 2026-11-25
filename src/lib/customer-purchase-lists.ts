import { supabase } from "@/lib/supabase";

export type PurchaseListItemInput = {
  product_id: string;
  quantity: string | number;
};

export type PurchaseListInput = {
  id: string | null;
  name: string;
  notes: string;
  items: PurchaseListItemInput[];
};

export type PurchaseListItem = {
  id: string;
  product_id: string;
  quantity: string;
  position: number;
};

export type PurchaseList = {
  id: string;
  name: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  items: PurchaseListItem[];
};

const LIST_COLUMNS = "id,name,notes,created_at,updated_at";
const ITEM_COLUMNS = "id,list_id,product_id,quantity,position";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateQuantity(raw: string | number, index: number): string {
  const trimmed = String(raw ?? "").trim();
  if (!/^\d{1,6}(\.\d{1,3})?$/.test(trimmed)) {
    throw new Error("الكمية في السطر " + (index + 1) + " يجب أن تكون رقمًا أكبر من صفر وبحد أقصى 999999.");
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("الكمية في السطر " + (index + 1) + " يجب أن تكون أكبر من صفر.");
  }
  return trimmed;
}

export async function fetchCustomerPurchaseLists(): Promise<PurchaseList[]> {
  const { data: lists, error: listsError } = await supabase
    .from("customer_purchase_lists")
    .select(LIST_COLUMNS)
    .order("updated_at", { ascending: false });
  if (listsError) throw new Error("تعذر تحميل قوائم الشراء: " + listsError.message);

  const result = (lists ?? []) as Array<Omit<PurchaseList, "items">>;
  if (result.length === 0) return [];

  const { data: items, error: itemsError } = await supabase
    .from("customer_purchase_list_items")
    .select(ITEM_COLUMNS)
    .in("list_id", result.map((list) => list.id))
    .order("position", { ascending: true });
  if (itemsError) throw new Error("تعذر تحميل أصناف قوائم الشراء: " + itemsError.message);

  const byList = new Map<string, PurchaseListItem[]>();
  for (const item of (items ?? []) as Array<PurchaseListItem & { list_id: string }>) {
    const bucket = byList.get(item.list_id) ?? [];
    bucket.push({ id: item.id, product_id: item.product_id, quantity: item.quantity, position: item.position });
    byList.set(item.list_id, bucket);
  }
  return result.map((list) => ({ ...list, items: byList.get(list.id) ?? [] }));
}

export async function saveCustomerPurchaseList(input: PurchaseListInput): Promise<string> {
  if (!input || typeof input !== "object") throw new Error("بيانات القائمة غير صالحة.");
  const name = (input.name ?? "").trim();
  if (name.length < 1 || name.length > 80) throw new Error("اسم القائمة مطلوب ولا يتجاوز 80 حرفًا.");
  const notes = (input.notes ?? "").trim();
  if (notes.length > 500) throw new Error("الملاحظات لا تتجاوز 500 حرف.");
  if (!Array.isArray(input.items)) throw new Error("أصناف القائمة غير صالحة.");
  if (input.items.length > 200) throw new Error("لا تتجاوز 200 صنف في القائمة الواحدة.");

  const seen = new Set<string>();
  const items = input.items.map((item, index) => {
    const productId = String(item?.product_id ?? "").trim();
    if (!UUID_RE.test(productId)) throw new Error("صنف غير صالح في السطر " + (index + 1) + ".");
    if (seen.has(productId)) throw new Error("الصنف مكرر داخل القائمة: السطر " + (index + 1) + ".");
    seen.add(productId);
    return { product_id: productId, quantity: validateQuantity(item.quantity, index) };
  });
  if (items.length === 0) throw new Error("أضف صنفًا واحدًا على الأقل إلى القائمة.");

  const listId = input.id == null || input.id === "" ? null : String(input.id);
  if (listId !== null && !UUID_RE.test(listId)) throw new Error("معرّف القائمة غير صالح.");

  const { data, error } = await supabase.rpc("save_customer_purchase_list", {
    p_list_id: listId,
    p_name: name,
    p_notes: notes,
    p_items: items,
  });
  if (error) throw new Error(error.message);
  if (typeof data !== "string" || !data) throw new Error("لم يؤكد الخادم حفظ القائمة.");
  return data;
}

export async function deleteCustomerPurchaseList(listId: string): Promise<void> {
  if (!UUID_RE.test(String(listId))) throw new Error("معرّف القائمة غير صالح.");
  const { data, error } = await supabase.rpc("delete_customer_purchase_list", { p_list_id: String(listId) });
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error("لم يؤكد الخادم حذف القائمة.");
}
