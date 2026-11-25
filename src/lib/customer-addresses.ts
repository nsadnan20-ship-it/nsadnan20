import { supabase } from "@/lib/supabase";

export type CustomerAddressInput = {
  id: string | null;
  label: string;
  recipient_name: string;
  phone: string;
  address_line1: string;
  address_line2: string;
  city: string;
  region: string;
  postal_code: string;
  country: string;
  delivery_instructions: string;
  is_default: boolean;
};

export type CustomerAddress = {
  id: string;
  label: string;
  recipient_name: string;
  phone: string;
  address_line1: string;
  address_line2: string | null;
  city: string;
  region: string | null;
  postal_code: string | null;
  country: string;
  delivery_instructions: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

const ADDRESS_COLUMNS = "id,label,recipient_name,phone,address_line1,address_line2,city,region,postal_code,country,delivery_instructions,is_default,created_at,updated_at";

export async function fetchCustomerAddresses(): Promise<CustomerAddress[]> {
  const { data, error } = await supabase
    .from("customer_addresses")
    .select(ADDRESS_COLUMNS)
    .order("is_default", { ascending: false })
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error("تعذر تحميل عناوين التوصيل: " + error.message);
  return (data ?? []) as CustomerAddress[];
}

function optionalText(value: string, label: string, maxLength: number): string | null {
  if (typeof value !== "string") throw new Error(label + " يجب أن يكون نصًا صالحًا.");
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new Error(label + " يتجاوز الحد المسموح (" + maxLength + " حرفًا).");
  return trimmed || null;
}

export async function saveCustomerAddress(input: CustomerAddressInput): Promise<string> {
  if (!input || typeof input !== "object") throw new Error("بيانات العنوان غير صالحة.");
  const label = optionalText(input.label, "اسم العنوان", 50);
  if (!label) throw new Error("اسم العنوان مطلوب.");
  const recipientName = optionalText(input.recipient_name, "اسم المستلم", 120);
  if (!recipientName || recipientName.length < 2) throw new Error("اسم المستلم مطلوب (حرفان على الأقل).");
  const phone = optionalText(input.phone, "رقم الهاتف", 32);
  if (!phone || !/^\+?[0-9][0-9\s-]{5,31}$/.test(phone)) throw new Error("أدخل رقم هاتف صحيح.");
  const addressLine1 = optionalText(input.address_line1, "العنوان التفصيلي", 180);
  if (!addressLine1 || addressLine1.length < 3) throw new Error("العنوان التفصيلي مطلوب (3 أحرف على الأقل).");
  const city = optionalText(input.city, "المدينة", 100);
  if (!city || city.length < 2) throw new Error("المدينة مطلوبة.");
  const addressLine2 = optionalText(input.address_line2, "تفاصيل العنوان الإضافية", 180);
  const region = optionalText(input.region, "المحافظة / المنطقة", 100);
  const postalCode = optionalText(input.postal_code, "الرمز البريدي", 24);
  const country = typeof input.country === "string" ? input.country.trim().toUpperCase() : "";
  if (!/^[A-Z]{2}$/.test(country)) throw new Error("رمز الدولة يجب أن يكون حرفين مثل YE.");
  const deliveryInstructions = optionalText(input.delivery_instructions, "تعليمات المندوب", 1000);
  const addressId = input.id === null || input.id === undefined || input.id === "" ? null : String(input.id);

  const { data, error } = await supabase.rpc("save_customer_address", {
    p_address_id: addressId,
    p_label: label,
    p_recipient_name: recipientName,
    p_phone: phone,
    p_address_line1: addressLine1,
    p_address_line2: addressLine2,
    p_city: city,
    p_region: region,
    p_postal_code: postalCode,
    p_country: country,
    p_delivery_instructions: deliveryInstructions,
    p_is_default: input.is_default === true,
  });
  if (error) throw new Error(error.message);
  if (typeof data !== "string" || !data) throw new Error("لم يؤكد الخادم حفظ العنوان.");
  return data;
}

export async function deleteCustomerAddress(addressId: string): Promise<void> {
  if (typeof addressId !== "string" || !addressId) throw new Error("معرّف العنوان غير صالح.");
  const { data, error } = await supabase.rpc("delete_customer_address", { p_address_id: addressId });
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error("لم يؤكد الخادم حذف العنوان.");
}
