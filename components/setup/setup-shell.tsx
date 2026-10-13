import type { ReactNode } from "react";

type SetupShellProps = {
  title: string;
  description: string;
  children?: ReactNode;
};

/** Page frame for the self-hosting setup screens. */
export function SetupShell({ title, description, children }: SetupShellProps) {
  return (
    <main className="bg-background text-foreground min-h-dvh p-6">
      <div className="mx-auto mt-16 max-w-xl space-y-6">
        <div className="space-y-2">
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
        {children}
      </div>
    </main>
  );
}
