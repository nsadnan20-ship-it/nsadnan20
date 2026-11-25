import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  columns: "",
  orders: [] as Array<{ column: string; ascending?: boolean }>,
  inArgs: null as null | { column: string; values: string[] },
  readResponse: { data: [] as unknown[], error: null as null | { message: string } },
}));
vi.mock("@/lib/supabase", () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }));
import {
  deleteCustomerPurchaseList,
  fetchCustomerPurchaseLists,
  saveCustomerPurchaseList,
  type PurchaseListInput,
} from "@/lib/customer-purchase-lists";

function query() {
  const q = {
    select(columns: string) { mocks.columns = columns; return q; },
    order(column: string, options?: { ascending?: boolean }) { mocks.orders.push({ column, ascending: options?.ascending }); return q; },
    in(column: string, values: string[]) { mocks.inArgs = { column, values }; return q; },
    then(onfulfilled?: ((value: typeof mocks.readResponse) => unknown) | null, onrejected?: ((reason: unknown) => unknown) | null) {
      return Promise.resolve(mocks.readResponse).then(onfulfilled ?? undefined, onrejected ?? undefined);
    },
  };
  return q;
}

const BASE: PurchaseListInput = {
  id: null,
  name: "طلب الأسبوع",
  notes: "",
  items: [{ product_id: "a1111111-1111-4111-8111-111111111111", quantity: "3" }],
};

describe("customer purchase lists data contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.columns = "";
    mocks.orders.splice(0);
    mocks.inArgs = null;
    mocks.readResponse = { data: [], error: null };
    mocks.from.mockImplementation(() => query());
    mocks.rpc.mockResolvedValue({ data: "b1111111-1111-4111-8111-111111111111", error: null });
  });

  it("fetches lists newest first, then items scoped to those lists", async () => {
    mocks.from
      .mockImplementationOnce(() => {
        mocks.readResponse = { data: [{ id: "b1111111-1111-4111-8111-111111111111", name: "طلب الأسبوع", notes: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z" }], error: null };
        return query();
      })
      .mockImplementationOnce(() => {
        mocks.readResponse = { data: [{ id: "c1111111-1111-4111-8111-111111111111", list_id: "b1111111-1111-4111-8111-111111111111", product_id: "a1111111-1111-4111-8111-111111111111", quantity: "3.000", position: 1 }], error: null };
        return query();
      });
    const lists = await fetchCustomerPurchaseLists();
    expect(mocks.from).toHaveBeenNthCalledWith(1, "customer_purchase_lists");
    expect(mocks.from).toHaveBeenNthCalledWith(2, "customer_purchase_list_items");
    expect(mocks.orders[0]).toEqual({ column: "updated_at", ascending: false });
    expect(mocks.inArgs).toEqual({ column: "list_id", values: ["b1111111-1111-4111-8111-111111111111"] });
    expect(lists).toHaveLength(1);
    expect(lists[0].name).toBe("طلب الأسبوع");
    expect(lists[0].items).toEqual([{ id: "c1111111-1111-4111-8111-111111111111", product_id: "a1111111-1111-4111-8111-111111111111", quantity: "3.000", position: 1 }]);
  });

  it("saves through the RPC without ever sending customer or organization IDs", async () => {
    await expect(saveCustomerPurchaseList(BASE)).resolves.toBe("b1111111-1111-4111-8111-111111111111");
    expect(mocks.rpc).toHaveBeenCalledWith("save_customer_purchase_list", {
      p_list_id: null,
      p_name: "طلب الأسبوع",
      p_notes: "",
      p_items: [{ product_id: "a1111111-1111-4111-8111-111111111111", quantity: "3" }],
    });
    expect(JSON.stringify(mocks.rpc.mock.calls[0])).not.toMatch(/customer_id|organization_id/i);
  });

  it("rejects malformed input before any write", async () => {
    await expect(saveCustomerPurchaseList({ ...BASE, name: "  " })).rejects.toThrow("اسم القائمة");
    await expect(saveCustomerPurchaseList({ ...BASE, notes: "x".repeat(501) })).rejects.toThrow("500");
    await expect(saveCustomerPurchaseList({ ...BASE, items: [] })).rejects.toThrow("صنفًا واحدًا");
    await expect(saveCustomerPurchaseList({ ...BASE, items: [{ product_id: "not-a-uuid", quantity: 1 }] })).rejects.toThrow("صنف غير صالح");
    await expect(saveCustomerPurchaseList({ ...BASE, items: [{ product_id: "a1111111-1111-4111-8111-111111111111", quantity: "-2" }] })).rejects.toThrow("الكمية");
    await expect(saveCustomerPurchaseList({ ...BASE, items: [{ product_id: "a1111111-1111-4111-8111-111111111111", quantity: "abc" }] })).rejects.toThrow("الكمية");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("surfaces database errors instead of claiming success", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "القائمة غير موجودة أو لا تملكها" } });
    await expect(saveCustomerPurchaseList(BASE)).rejects.toThrow("القائمة غير موجودة أو لا تملكها");
  });

  it("requires explicit confirmation from the server before treating deletion as successful", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: true, error: null });
    await expect(deleteCustomerPurchaseList("b1111111-1111-4111-8111-111111111111")).resolves.toBeUndefined();
    expect(mocks.rpc).toHaveBeenCalledWith("delete_customer_purchase_list", { p_list_id: "b1111111-1111-4111-8111-111111111111" });
    mocks.rpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(deleteCustomerPurchaseList("b1111111-1111-4111-8111-111111111111")).rejects.toThrow("لم يؤكد الخادم");
    await expect(deleteCustomerPurchaseList("nope")).rejects.toThrow("معرّف القائمة غير صالح");
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
});
