import type { Metadata } from "next";
import { getScopeContext } from "@/lib/scope-context";
import { ConnectionsTabs } from "@/components/connections/connections-tabs";
import { TeamConnectionsNotice } from "@/components/connections/team-connections-notice";

export const metadata: Metadata = {
  title: "Connections | Mogplex",
  description: "Give your agents access to the services you use.",
  robots: { index: false, follow: false },
};

export default async function ConnectionsPage() {
  const scope = await getScopeContext();
  return (
    <div className="min-h-full w-full max-w-[1488px] space-y-4 p-3 md:space-y-6 md:p-6">
      <header>
        <h1 className="ui-page-title">Connections</h1>
        <p className="ui-page-subtitle">
          Give your agents access to the services you use.
        </p>
      </header>
      {scope.kind === "personal" ? (
        <ConnectionsTabs />
      ) : (
        <TeamConnectionsNotice />
      )}
    </div>
  );
}
