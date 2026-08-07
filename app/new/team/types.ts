import type { SlugCheckResponse } from "@/app/api/teams/slug-check/route";

export type SlugStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available" }
  | { state: "unavailable"; reason: SlugCheckResponse["reason"] };

export type Installation = {
  installation_id: number;
  account_login: string | null;
  account_type: string | null;
  target_type: string | null;
  scope_label: string;
};

export type SubmitProgress = "idle" | "creating" | "attaching" | "inviting";

export type { OrgMembersResponse } from "@/app/api/github/installations/[installationId]/org-members/route";
