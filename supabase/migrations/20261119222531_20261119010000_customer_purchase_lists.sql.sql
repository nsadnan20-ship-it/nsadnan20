/*
# Customer purchase lists (قوائم الشراء المحفوظة)

1. New tables
- `customer_purchase_lists`: saved shopping lists owned by a customer account.
  - `id` uuid PK, `organization_id`, `customer_id` (FK customers, ON DELETE CASCADE),
    `name` (1..80 chars), `notes` (<=500, nullable), `created_at`, `updated_at`.
  - Unique per (customer_id, name) to prevent duplicate list names.
- `customer_purchase_list_items`: lines of a list, each pinning a product.
  - `id` uuid PK, `list_id` FK customer_purchase_lists ON DELETE CASCADE,
    `organization_id`, `product_id` FK products ON DELETE CASCADE,
    `quantity` numeric(14,3) > 0, `position` int (stable ordering), `created_at`.
  - Unique per (list_id, product_id).

2. Security (mirrors the customer_addresses hardening pattern)
- RLS enabled on both tables; ALL privileges revoked from PUBLIC/anon/authenticated;
  explicit grants: SELECT to authenticated (RLS still enforces rows).
- SELECT policies: the owning customer (active profile via current_profile_id() +
  auth.uid()) or same-organization staff via public.is_staff() (user_roles:
  admin/manager/staff).
- Writes go exclusively through the SECURITY DEFINER RPCs `save_customer_purchase_list`
  and `delete_customer_purchase_list`; direct INSERT/UPDATE/DELETE is denied by policy
  for everyone, so ownership and quantity validation cannot be bypassed via the Data API.
- RPCs are SECURITY DEFINER with `SET search_path = ''`, fully qualified table names,
  revoked from PUBLIC/anon, granted to authenticated only.

3. Notes
- No destructive operations; idempotent via IF NOT EXISTS / DROP POLICY IF EXISTS.
- quantity is bounded (0 < q <= 999999) and validated server-side in the RPC.
*/

CREATE TABLE IF NOT EXISTS public.customer_purchase_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  notes text CHECK (char_length(btrim(notes)) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, name)
);

CREATE TABLE IF NOT EXISTS public.customer_purchase_list_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES public.customer_purchase_lists(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0 AND quantity <= 999999),
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (list_id, product_id)
);

CREATE INDEX IF NOT EXISTS customer_purchase_lists_customer_idx
  ON public.customer_purchase_lists(customer_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS customer_purchase_list_items_list_idx
  ON public.customer_purchase_list_items(list_id, position, created_at);
CREATE INDEX IF NOT EXISTS customer_purchase_list_items_product_idx
  ON public.customer_purchase_list_items(product_id);

ALTER TABLE public.customer_purchase_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_purchase_list_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.customer_purchase_lists FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.customer_purchase_list_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.customer_purchase_lists TO authenticated;
GRANT SELECT ON TABLE public.customer_purchase_list_items TO authenticated;

-- Owning customer: active profile matching auth.uid() that owns the customer record
DROP POLICY IF EXISTS customer_purchase_lists_own_read ON public.customer_purchase_lists;
CREATE POLICY customer_purchase_lists_own_read ON public.customer_purchase_lists
FOR SELECT TO authenticated
USING (
  organization_id = public.current_organization_id()
  AND EXISTS (
    SELECT 1 FROM public.customers c
    JOIN public.profiles p ON p.id = c.profile_id
    WHERE c.id = customer_purchase_lists.customer_id
      AND c.organization_id = customer_purchase_lists.organization_id
      AND p.id = public.current_profile_id()
      AND p.auth_user_id = auth.uid()
      AND p.is_active = true
  )
);

-- Staff of the same organization may view lists (read-only; writes stay RPC-only)
DROP POLICY IF EXISTS customer_purchase_lists_staff_read ON public.customer_purchase_lists;
CREATE POLICY customer_purchase_lists_staff_read ON public.customer_purchase_lists
FOR SELECT TO authenticated
USING (
  organization_id = public.current_organization_id()
  AND public.is_staff()
);

DROP POLICY IF EXISTS customer_purchase_list_items_own_read ON public.customer_purchase_list_items;
CREATE POLICY customer_purchase_list_items_own_read ON public.customer_purchase_list_items
FOR SELECT TO authenticated
USING (
  organization_id = public.current_organization_id()
  AND EXISTS (
    SELECT 1 FROM public.customer_purchase_lists l
    WHERE l.id = customer_purchase_list_items.list_id
      AND l.organization_id = customer_purchase_list_items.organization_id
      AND (
        EXISTS (
          SELECT 1 FROM public.customers c
          JOIN public.profiles p ON p.id = c.profile_id
          WHERE c.id = l.customer_id
            AND c.organization_id = l.organization_id
            AND p.id = public.current_profile_id()
            AND p.auth_user_id = auth.uid()
            AND p.is_active = true
        )
        OR public.is_staff()
      )
  )
);

-- No INSERT/UPDATE/DELETE policies: all writes are RPC-only (deny by default).

CREATE OR REPLACE FUNCTION public.save_customer_purchase_list(
  p_list_id uuid,
  p_name text,
  p_notes text,
  p_items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_profile uuid := public.current_profile_id();
  v_customer_id uuid;
  v_organization_id uuid;
  v_list_id uuid;
  v_name text := pg_catalog.btrim(pg_catalog.coalesce(p_name, ''));
  v_notes text := nullif(pg_catalog.btrim(pg_catalog.coalesce(p_notes, '')), '');
  v_item jsonb;
  v_product_id text;
  v_quantity numeric;
  v_position integer := 0;
BEGIN
  IF auth.uid() IS NULL OR v_profile IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authenticated customer required';
  END IF;

  SELECT c.id, c.organization_id INTO v_customer_id, v_organization_id
  FROM public.customers c
  JOIN public.profiles p ON p.id = c.profile_id
  WHERE p.id = v_profile
    AND p.auth_user_id = auth.uid()
    AND p.is_active = true
    AND p.organization_id = c.organization_id
  ORDER BY c.created_at, c.id
  LIMIT 1;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'an active customer account is required';
  END IF;

  IF pg_catalog.length(v_name) NOT BETWEEN 1 AND 80
     OR pg_catalog.length(pg_catalog.coalesce(v_notes, '')) > 500 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'اسم القائمة أو الملاحظات يتجاوز الحد المسموح';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) > 200 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'أصناف القائمة غير صالحة (حتى 200 صنف)';
  END IF;

  IF p_list_id IS NOT NULL THEN
    SELECT l.id INTO v_list_id
    FROM public.customer_purchase_lists l
    WHERE l.id = p_list_id
      AND l.customer_id = v_customer_id
      AND l.organization_id = v_organization_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'القائمة غير موجودة أو لا تملكها';
    END IF;
  END IF;

  IF v_list_id IS NULL THEN
    INSERT INTO public.customer_purchase_lists (organization_id, customer_id, name, notes)
    VALUES (v_organization_id, v_customer_id, v_name, v_notes)
    RETURNING id INTO v_list_id;
  ELSE
    UPDATE public.customer_purchase_lists
    SET name = v_name, notes = v_notes, updated_at = now()
    WHERE id = v_list_id;
  END IF;

  DELETE FROM public.customer_purchase_list_items WHERE list_id = v_list_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_position := v_position + 1;
    v_product_id := NULLIF(pg_catalog.btrim(pg_catalog.coalesce(v_item->>'product_id', '')), '');
    IF v_product_id IS NULL OR v_product_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'صنف بمعرّف غير صالح داخل القائمة';
    END IF;
    v_quantity := pg_catalog.least(
      pg_catalog.greatest(COALESCE(pg_catalog.btrim(v_item->>'quantity'), '')::numeric, 0.001),
      999999
    );
    IF NOT EXISTS (
      SELECT 1 FROM public.products pr
      WHERE pr.id = v_product_id::uuid
        AND pr.organization_id = v_organization_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'صنف غير موجود في مؤسستك';
    END IF;
    INSERT INTO public.customer_purchase_list_items (list_id, organization_id, product_id, quantity, position)
    VALUES (v_list_id, v_organization_id, v_product_id::uuid, v_quantity, v_position);
  END LOOP;

  RETURN v_list_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_customer_purchase_list(uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_customer_purchase_list(uuid, text, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_customer_purchase_list(p_list_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_profile uuid := public.current_profile_id();
  v_customer_id uuid;
  v_organization_id uuid;
BEGIN
  IF auth.uid() IS NULL OR v_profile IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authenticated customer required';
  END IF;

  SELECT c.id, c.organization_id INTO v_customer_id, v_organization_id
  FROM public.customers c
  JOIN public.profiles p ON p.id = c.profile_id
  WHERE p.id = v_profile
    AND p.auth_user_id = auth.uid()
    AND p.is_active = true
    AND p.organization_id = c.organization_id
  ORDER BY c.created_at, c.id
  LIMIT 1;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'an active customer account is required';
  END IF;

  DELETE FROM public.customer_purchase_lists l
  WHERE l.id = p_list_id
    AND l.customer_id = v_customer_id
    AND l.organization_id = v_organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'القائمة غير موجودة أو لا تملكها';
  END IF;
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_customer_purchase_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_customer_purchase_list(uuid) TO authenticated;
