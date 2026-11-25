import { supabase } from "@/lib/supabase";
import { getCurrentTenantScope } from "@/lib/supabase";

export type ProductReview = {
  id: string;
  product_id: string;
  rating: number;
  title: string | null;
  body: string | null;
  is_approved: boolean;
  created_at: string;
  author_name: string | null;
};

export type ReviewStats = {
  review_count: number;
  avg_rating: number;
  five_star: number;
  four_star: number;
  three_star: number;
  two_star: number;
  one_star: number;
};

export type ReviewSubmission = {
  product_id: string;
  rating: number;
  title?: string;
  body?: string;
};

export async function fetchProductReviews(productId: string): Promise<ProductReview[]> {
  const { data, error } = await supabase
    .from("product_reviews")
    .select("id, product_id, rating, title, body, is_approved, created_at, auth_user_id")
    .eq("product_id", productId)
    .eq("is_approved", true)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error("تعذر تحميل التقييمات");
  return (data ?? []).map((row) => ({
    id: row.id,
    product_id: row.product_id,
    rating: row.rating,
    title: row.title,
    body: row.body,
    is_approved: row.is_approved,
    created_at: row.created_at,
    author_name: null,
  })) as ProductReview[];
}

export async function fetchReviewStats(productId: string): Promise<ReviewStats> {
  const { data, error } = await supabase.rpc("get_product_review_stats", { p_product_id: productId });
  if (error) throw new Error("تعذر تحميل إحصائيات التقييم");
  if (!data || data.length === 0)
    return { review_count: 0, avg_rating: 0, five_star: 0, four_star: 0, three_star: 0, two_star: 0, one_star: 0 };
  const row = data[0];
  return {
    review_count: row.review_count,
    avg_rating: Number(row.avg_rating),
    five_star: row.five_star,
    four_star: row.four_star,
    three_star: row.three_star,
    two_star: row.two_star,
    one_star: row.one_star,
  };
}

export async function submitReview(input: ReviewSubmission): Promise<string> {
  const { data, error } = await supabase.rpc("submit_product_review", {
    p_product_id: input.product_id,
    p_rating: input.rating,
    p_title: input.title ?? null,
    p_body: input.body ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function fetchPendingReviews(): Promise<ProductReview[]> {
  const { organizationId } = await getCurrentTenantScope();
  const { data, error } = await supabase
    .from("product_reviews")
    .select("id, product_id, rating, title, body, is_approved, created_at")
    .eq("organization_id", organizationId)
    .eq("is_approved", false)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error("تعذر تحميل التقييمات المعلقة");
  return (data ?? []) as ProductReview[];
}

export async function approveReview(reviewId: string, approve: boolean): Promise<void> {
  const { error } = await supabase.rpc("approve_product_review", {
    p_review_id: reviewId,
    p_approve: approve,
  });
  if (error) throw new Error(error.message);
}

export function renderStars(rating: number): string {
  return "★".repeat(rating) + "☆".repeat(5 - rating);
}
