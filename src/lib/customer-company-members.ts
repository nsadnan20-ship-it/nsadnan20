import { supabase } from "@/lib/supabase";

export type CompanyMemberRole = "buyer" | "finance" | "viewer";
export const COMPANY_MEMBER_ROLES: CompanyMemberRole[] = ["buyer", "finance", "viewer"];

export type CompanyMember = {
  profile_id: string;
  full_name: string;
  email: string | null;
  member_role: CompanyMemberRole;
  status: string;
  accepted_at: string | null;
};

export type CompanyInvitation = {
  invitation_id: string;
  invited_email: string;
  member_role: CompanyMemberRole;
  status: string;
  invitation_token?: string;
  expires_at: string;
};

export type CompanyMembershipWorkspace = {
  company_name: string;
  members: CompanyMember[];
  invitations: CompanyInvitation[];
};

export type CompanyInvitationResult = {
  invitation_id: string;
  invited_email: string;
  member_role: CompanyMemberRole;
  invitation_token: string;
  expires_at: string;
};

export type CompanyInvitationAcceptance = {
  company_name: string;
  member_role: CompanyMemberRole;
  status: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function createCompanyInvitation(
  email: string,
  role: CompanyMemberRole,
): Promise<CompanyInvitationResult> {
  if (typeof email !== "string") throw new Error("أدخل بريدًا إلكترونيًا صحيحًا.");
  const normalizedEmail = email.trim().toLowerCase();
  if (!EMAIL_RE.test(normalizedEmail)) throw new Error("أدخل بريدًا إلكترونيًا صحيحًا.");
  if (!COMPANY_MEMBER_ROLES.includes(role)) throw new Error("دور عضو الشركة غير صالح.");

  const { data, error } = await supabase.rpc("create_customer_company_invitation", {
    p_email: normalizedEmail,
    p_member_role: role,
  });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== "object" || typeof (data as Record<string, unknown>).invitation_id !== "string") {
    throw new Error("استجابة الخادم غير صالحة لإنشاء الدعوة.");
  }
  return data as CompanyInvitationResult;
}

export async function acceptCompanyInvitation(token: string): Promise<CompanyInvitationAcceptance> {
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/i.test(token.trim())) {
    throw new Error("رابط الدعوة غير صالح.");
  }
  const { data, error } = await supabase.rpc("accept_customer_company_invitation", {
    p_token: token.trim().toLowerCase(),
  });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== "object" || typeof (data as Record<string, unknown>).company_name !== "string") {
    throw new Error("استجابة الخادم غير صالحة.");
  }
  return data as CompanyInvitationAcceptance;
}

export async function fetchCompanyMembershipWorkspace(): Promise<CompanyMembershipWorkspace> {
  const { data, error } = await supabase.rpc("fetch_customer_company_workspace");
  if (error) throw new Error(error.message);
  if (!data || typeof data !== "object" || typeof (data as Record<string, unknown>).company_name !== "string") {
    throw new Error("استجابة الخادم غير صالحة لتحميل عضويات الشركة.");
  }
  return data as CompanyMembershipWorkspace;
}

export async function revokeCompanyMember(profileId: string): Promise<void> {
  if (typeof profileId !== "string" || !profileId) throw new Error("معرّف العضو غير صالح.");
  const { data, error } = await supabase.rpc("revoke_customer_company_member", { p_member_profile_id: profileId });
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error("لم يؤكد الخادم إلغاء العضوية.");
}

export async function revokeCompanyInvitation(invitationId: string): Promise<void> {
  if (typeof invitationId !== "string" || !invitationId) throw new Error("معرّف الدعوة غير صالح.");
  const { data, error } = await supabase.rpc("revoke_customer_company_invitation", { p_invitation_id: invitationId });
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error("لم يؤكد الخادم إلغاء الدعوة.");
}
