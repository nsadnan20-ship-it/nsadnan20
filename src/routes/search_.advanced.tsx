import { createFileRoute } from "@tanstack/react-router";
import { AdvancedStorefrontSearchPage } from "@/components/AdvancedStorefrontSearchPage";

export const Route = createFileRoute("/search_/advanced")({
  head: () => ({ meta: [{ title: "البحث المتقدم | متجر الأغبري" }] }),
  component: AdvancedStorefrontSearchPage,
});
