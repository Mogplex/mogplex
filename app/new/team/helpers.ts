import type { Installation, SlugStatus, SubmitProgress } from "./types";

export function isOrgInstallation(
  installation: Installation | undefined | null
) {
  const raw = installation?.target_type || installation?.account_type || "";
  return raw.toLowerCase().includes("org");
}

export function getSlugHelp(slugStatus: SlugStatus): string {
  if (slugStatus.state === "checking") return "Checking availability...";
  if (slugStatus.state === "available") return "Slug is available";
  if (slugStatus.state === "unavailable") {
    if (slugStatus.reason === "reserved") return "Slug is reserved";
    if (slugStatus.reason === "taken") return "Slug is already taken";
    return "Slug must be 1-39 chars, [a-z0-9-], no leading/trailing/double hyphens";
  }
  return "Used in URLs like mogplex.com/your-slug";
}

export function getSubmitLabel(progress: SubmitProgress): string {
  if (progress === "creating") return "Creating team...";
  if (progress === "attaching") return "Attaching installation...";
  if (progress === "inviting") return "Sending invites...";
  return "Create team";
}
