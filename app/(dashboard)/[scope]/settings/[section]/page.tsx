import { notFound } from "next/navigation";
import { getScopeContext } from "@/lib/scope-context";
import { PERSONAL_SETTINGS, TEAM_SETTINGS } from "@/lib/settings-navigation";
import { TeamSettingsClient } from "@/components/settings/team-settings-client";
import { TeamsListSection } from "@/components/settings/teams-list-section";
import { CliApiKeysSection } from "@/components/settings/cli-api-keys-section";
import { PersonalAccountPage } from "../_components/personal-account-page";
import { ProviderKeysPage } from "../_components/provider-keys-page";

export default async function SettingsSectionPage({ params }: {
  params: Promise<{ section: string }>;
}) {
  const [{ section }, scope] = await Promise.all([params, getScopeContext()]);
  const items = scope.kind === "team" ? TEAM_SETTINGS : PERSONAL_SETTINGS;
  const item = items.find((entry) => entry.id === section);
  if (!item) notFound();

  if (scope.kind === "team") {
    if (section !== "members" && section !== "keys" && section !== "models" && section !== "audit") notFound();
    return <TeamSettingsClient teamId={scope.teamId} teamSlug={scope.slug} section={section} />;
  }

  return (
    <div className="min-h-full w-full max-w-[1488px] space-y-4 p-3 md:space-y-6 md:p-6">
      <h1 className="ui-page-title">{item.label}</h1>
      {section === "account" && <PersonalAccountPage />}
      {section === "teams" && <TeamsListSection />}
      {section === "keys" && <ProviderKeysPage />}
      {section === "mogplex-keys" && <CliApiKeysSection />}
    </div>
  );
}
