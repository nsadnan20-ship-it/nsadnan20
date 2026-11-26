/*
# Product Reviews and Ratings

1. New Tables
- `product_reviews` — customer reviews for products with 1-5 star ratings.
  - Uses auth_user_id from profiles to link to auth.uid().
  - One review per user per product (UNIQUE constraint).
  - Staff must approve before public display (is_approved default false).

2. Security
- RLS enabled. Public reads approved reviews. Authors read/update/delete their own.
- Staff (admin/manager via user_roles) can read/update/delete in their org.
- SECURITY DEFINER functions enforce ownership and role checks.

3. Views
- product_review_stats materialized view: aggregate counts and avg per product (approved only).
*/

CREATE TABLE IF NOT EXISTS product_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  auth_user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  rating smallint NOT NULL CHECK (rating >= 1 AND rating <= 5),
  title text CHECK (char_length(title) <= 200),
  body text CHECK (char_length(body) <= 2000),
  is_approved boolean NOT NULL DEFAULT false,
  approved_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (auth_user_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_product_reviews_product ON product_reviews(product_id) WHERE is_approved = true;
CREATE INDEX IF NOT EXISTS idx_product_reviews_org ON product_reviews(organization_id);

ALTER TABLE product_reviews ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON product_reviews TO anon, authenticated;
GRANT INSERT ON product_reviews TO authenticated;
GRANT UPDATE ON product_reviews TO authenticated;
GRANT DELETE ON product_reviews TO authenticated;

DROP POLICY IF EXISTS "public_read_approved_reviews" ON product_reviews;
CREATE POLICY "public_read_approved_reviews"
ON product_reviews FOR SELECT
TO anon, authenticated
USING (is_approved = true);

DROP POLICY IF EXISTS "author_read_own_reviews" ON product_reviews;
CREATE POLICY "author_read_own_reviews"
ON product_reviews FOR SELECT
TO authenticated
USING (auth_user_id = auth.uid());

DROP POLICY IF EXISTS "author_update_own_review" ON product_reviews;
CREATE POLICY "author_update_own_review"
ON product_reviews FOR UPDATE
TO authenticated
USING (auth_user_id = auth.uid() AND is_approved = false)
WITH CHECK (auth_user_id = auth.uid() AND is_approved = false);

DROP POLICY IF EXISTS "author_delete_own_review" ON product_reviews;
CREATE POLICY "author_delete_own_review"
ON product_reviews FOR DELETE
TO authenticated
USING (auth_user_id = auth.uid());

DROP POLICY IF EXISTS "staff_read_org_reviews" ON product_reviews;
CREATE POLICY "staff_read_org_reviews"
ON product_reviews FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    JOIN user_roles ur ON ur.profile_id = p.id
    WHERE p.auth_user_id = auth.uid()
    AND p.organization_id = product_reviews.organization_id
    AND ur.role IN ('admin', 'manager', 'staff')
  )
);

DROP POLICY IF EXISTS "staff_update_org_reviews" ON product_reviews;
CREATE POLICY "staff_update_org_reviews"
ON product_reviews FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    JOIN user_roles ur ON ur.profile_id = p.id
    WHERE p.auth_user_id = auth.uid()
    AND p.organization_id = product_reviews.organization_id
    AND ur.role IN ('admin', 'manager')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles p
    JOIN user_roles ur ON ur.profile_id = p.id
    WHERE p.auth_user_id = auth.uid()
    AND p.organization_id = product_reviews.organization_id
    AND ur.role IN ('admin', 'manager')
  )
);

DROP POLICY IF EXISTS "staff_delete_org_reviews" ON product_reviews;
CREATE POLICY "staff_delete_org_reviews"
ON product_reviews FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    JOIN user_roles ur ON ur.profile_id = p.id
    WHERE p.auth_user_id = auth.uid()
    AND p.organization_id = product_reviews.organization_id
    AND ur.role IN ('admin', 'manager')
  )
);

DROP MATERIALIZED VIEW IF EXISTS product_review_stats;
CREATE MATERIALIZED VIEW product_review_stats AS
SELECT
  product_id,
  COUNT(*)::int AS review_count,
  ROUND(AVG(rating)::numeric, 2) AS avg_rating,
  COUNT(*) FILTER (WHERE rating = 5)::int AS five_star,
  COUNT(*) FILTER (WHERE rating = 4)::int AS four_star,
  COUNT(*) FILTER (WHERE rating = 3)::int AS three_star,
  COUNT(*) FILTER (WHERE rating = 2)::int AS two_star,
  COUNT(*) FILTER (WHERE rating = 1)::int AS one_star
FROM product_reviews
WHERE is_approved = true
GROUP BY product_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_review_stats_product ON product_review_stats(product_id);
GRANT SELECT ON product_review_stats TO anon, authenticated;

CREATE OR REPLACE FUNCTION refresh_product_review_stats()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY product_review_stats;
$$;
REVOKE EXECUTE ON FUNCTION refresh_product_review_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION refresh_product_review_stats() TO authenticated;

CREATE OR REPLACE FUNCTION submit_product_review(
  p_product_id uuid,
  p_rating smallint,
  p_title text DEFAULT NULL,
  p_body text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_profile profiles%ROWTYPE;
  v_product products%ROWTYPE;
  v_customer_id uuid;
  v_existing uuid;
  v_review_id uuid;
  v_is_customer boolean;
BEGIN
  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'التقييم يجب أن يكون من 1 إلى 5';
  END IF;
  IF p_title IS NOT NULL AND char_length(p_title) > 200 THEN
    RAISE EXCEPTION 'عنوان التقييم طويل جدًا';
  END IF;
  IF p_body IS NOT NULL AND char_length(p_body) > 2000 THEN
    RAISE EXCEPTION 'نص التقييم طويل جدًا';
  END IF;

  SELECT * INTO v_profile FROM profiles WHERE auth_user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'تعذر تحديد هويتك';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM user_roles WHERE profile_id = v_profile.id AND role = 'customer'
  ) INTO v_is_customer;
  IF NOT v_is_customer THEN
    RAISE EXCEPTION 'يمكن للعملاء فقط تقييم المنتجات';
  END IF;

  SELECT * INTO v_product FROM products WHERE id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'المنتج غير موجود';
  END IF;
  IF v_product.organization_id != v_profile.organization_id THEN
    RAISE EXCEPTION 'لا يمكنك تقييم منتج خارج مؤسستك';
  END IF;

  SELECT id INTO v_customer_id FROM customers WHERE profile_id = v_profile.id LIMIT 1;

  SELECT id INTO v_existing FROM product_reviews WHERE auth_user_id = auth.uid() AND product_id = p_product_id;
  IF FOUND THEN
    RAISE EXCEPTION 'لقد قمت بتقييم هذا المنتج من قبل';
  END IF;

  INSERT INTO product_reviews (
    organization_id, product_id, customer_id, auth_user_id,
    rating, title, body, is_approved
  )
  VALUES (
    v_profile.organization_id, p_product_id, v_customer_id, auth.uid(),
    p_rating, p_title, p_body, false
  )
  RETURNING id INTO v_review_id;

  RETURN v_review_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION submit_product_review(uuid, smallint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION submit_product_review(uuid, smallint, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION approve_product_review(
  p_review_id uuid,
  p_approve boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_profile profiles%ROWTYPE;
  v_review product_reviews%ROWTYPE;
  v_is_manager boolean;
BEGIN
  SELECT * INTO v_profile FROM profiles WHERE auth_user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'تعذر تحديد هويتك';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM user_roles WHERE profile_id = v_profile.id AND role IN ('admin', 'manager')
  ) INTO v_is_manager;
  IF NOT v_is_manager THEN
    RAISE EXCEPTION 'يتطلب صلاحية مدير أو مدير نظام';
  END IF;

  SELECT * INTO v_review FROM product_reviews WHERE id = p_review_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'التقييم غير موجود';
  END IF;
  IF v_review.organization_id != v_profile.organization_id THEN
    RAISE EXCEPTION 'لا يمكنك إدارة تقييم خارج مؤسستك';
  END IF;

  IF p_approve THEN
    UPDATE product_reviews
    SET is_approved = true, approved_by = v_profile.id, approved_at = now(), updated_at = now()
    WHERE id = p_review_id;
  ELSE
    DELETE FROM product_reviews WHERE id = p_review_id;
  END IF;

  PERFORM refresh_product_review_stats();
END;
$$;
REVOKE EXECUTE ON FUNCTION approve_product_review(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION approve_product_review(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION get_product_review_stats(
  p_product_id uuid
)
RETURNS TABLE(
  review_count int,
  avg_rating numeric,
  five_star int,
  four_star int,
  three_star int,
  two_star int,
  one_star int
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    COALESCE(review_count, 0),
    COALESCE(avg_rating, 0),
    COALESCE(five_star, 0),
    COALESCE(four_star, 0),
    COALESCE(three_star, 0),
    COALESCE(two_star, 0),
    COALESCE(one_star, 0)
  FROM product_review_stats
  WHERE product_id = p_product_id
  UNION ALL
  SELECT 0, 0, 0, 0, 0, 0, 0
  WHERE NOT EXISTS (SELECT 1 FROM product_review_stats WHERE product_id = p_product_id)
  LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION get_product_review_stats(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_product_review_stats(uuid) TO anon, authenticated;
