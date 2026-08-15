import type { Metadata } from "next";
import { buildMarketingMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMarketingMetadata({
  title: "Privacy Policy — Mogplex",
  description:
    "How Mogplex collects, uses, and protects account, content, and usage data on the hosted coding-agent workbench.",
  path: "/privacy",
});

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background text-foreground font-mono">
      <div className="max-w-2xl mx-auto px-6 py-16 space-y-8">
        <h1 className="text-2xl text-primary">Privacy Policy</h1>
        <p className="text-muted-foreground text-sm">
          Last updated: August 15, 2026
        </p>

        <section className="space-y-4 text-sm leading-relaxed">
          <p>
            This Privacy Policy describes how Mogplex Inc.
            (&quot;Mogplex&quot;, &quot;we&quot;, &quot;us&quot;) collects,
            uses, and shares personal data when you use the hosted Mogplex
            service at mogplex.com, including the web app, CLI, MCP server, and
            integrations. It does not apply to self-hosted deployments of the
            open-source software — those are operated by whoever runs them.
          </p>

          <h2 className="text-lg text-foreground">1. Data we collect</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <strong>Account data:</strong> your name and email address; a
              hash of your password if you sign up with one; and, if you sign
              in through single sign-on or an identity provider (GitHub,
              Google, or Microsoft), your avatar and profile from that
              provider plus the OAuth tokens needed to act on connected
              accounts within the scopes you approve
            </li>
            <li>
              <strong>Content you provide:</strong> prompts, agent
              conversations, agent and automation configurations, and the
              repository content agents access at your direction
            </li>
            <li>
              <strong>Usage records:</strong> per-request metering for billing
              and observability — model used, token counts, duration, tool-call
              metadata, and sandbox runtime
            </li>
            <li>
              <strong>Team data:</strong> team membership, roles, and an audit
              log of team actions (with credentials and prompt contents
              redacted)
            </li>
            <li>
              <strong>Billing data:</strong> plan, balance, and transaction
              history. Payment card details go directly to Stripe; we never
              store them
            </li>
            <li>
              <strong>Device and log data:</strong> IP address, browser or
              client user agent, and session records used for authentication
              and security
            </li>
            <li>
              <strong>Integration data:</strong> if you connect Slack,
              workspace and event data needed to run agents from Slack; tool
              execution results are kept briefly to deduplicate Slack retries
            </li>
          </ul>

          <h2 className="text-lg text-foreground">2. How we use it</h2>
          <p>We use this data to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Authenticate you and operate the Service</li>
            <li>
              Run agents against your repositories and sandboxes as you direct
            </li>
            <li>Meter usage and bill you accurately</li>
            <li>Secure the Service and prevent fraud and abuse</li>
            <li>Debug problems and improve reliability</li>
            <li>Communicate with you about your account and the Service</li>
            <li>Comply with law</li>
          </ul>
          <p>
            We do not use your code, prompts, or conversations to train AI
            models, and we do not sell your personal data.
          </p>

          <h2 className="text-lg text-foreground">3. AI model providers</h2>
          <p>
            When you run an agent, your prompts and relevant repository content
            are sent through an AI gateway to the model provider you select
            (such as Anthropic or OpenAI). Those providers process that data
            under their own terms and privacy policies. If you bring your own
            gateway or provider key, your direct agreement with that provider
            governs its processing.
          </p>

          <h2 className="text-lg text-foreground">4. Service providers</h2>
          <p>
            We share data with subprocessors only as needed to run the
            Service:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <strong>Vercel:</strong> application hosting, sandbox compute,
              AI gateway, and privacy-friendly analytics
            </li>
            <li>
              <strong>Neon:</strong> our Postgres database, where your account
              and content data live
            </li>
            <li>
              <strong>Stripe:</strong> payments, as merchant of record for the
              Service
            </li>
            <li>
              <strong>Resend:</strong> transactional email (sign-in, invites,
              billing notices)
            </li>
            <li>
              <strong>Trigger.dev:</strong> background job execution
            </li>
            <li>
              <strong>Sentry:</strong> error tracking
            </li>
            <li>
              <strong>Cloudflare:</strong> CLI release distribution
            </li>
            <li>
              <strong>GitHub and Slack:</strong> when you connect them,
              governed by their own privacy policies
            </li>
          </ul>
          <p>
            Beyond these providers, we disclose personal data only with your
            direction, when required by law, or as part of a merger,
            acquisition, or sale of assets (in which case this policy
            continues to apply to your data).
          </p>

          <h2 className="text-lg text-foreground">5. Teams</h2>
          <p>
            If you use Mogplex as part of a team, the team&apos;s owners and
            admins can see your membership, role, usage and cost attribution,
            and entries you generate in the team audit log.
          </p>

          <h2 className="text-lg text-foreground">6. Cookies and analytics</h2>
          <p>
            We use cookies for authentication and session management, and
            aggregate analytics to understand how the Service is used. A
            consent manager on our public pages lets you accept or decline
            non-essential categories; in regions that require opt-in consent
            (such as the EU) nothing non-essential runs until you agree, and
            California residents can opt out.
          </p>

          <h2 className="text-lg text-foreground">7. Data retention</h2>
          <p>
            We keep your data while your account exists. Sandbox environments
            are ephemeral and destroyed when they stop. Slack tool execution
            records are deleted automatically after 24 hours. Billing and
            audit records may be retained longer where the law requires it.
            When your account is deleted, associated content is deleted from
            our production database.
          </p>

          <h2 className="text-lg text-foreground">8. Your rights</h2>
          <p>
            You may request access to, correction of, export of, or deletion
            of your personal data at any time by contacting us. You can revoke
            Mogplex&apos;s access from your GitHub, Google, Microsoft, or
            Slack settings, and revoke personal access tokens and CLI sessions
            from your Mogplex settings. Depending on where you live (including
            the EU/EEA, UK, and certain US states), you may have additional
            statutory rights, which we will honor. We will not discriminate
            against you for exercising them.
          </p>

          <h2 className="text-lg text-foreground">
            9. International transfers
          </h2>
          <p>
            Mogplex is operated from the United States, and your data is
            processed there and in the regions where our subprocessors
            operate. Where required, we rely on appropriate safeguards for
            cross-border transfers.
          </p>

          <h2 className="text-lg text-foreground">10. Security</h2>
          <p>
            We encrypt data in transit, isolate agent execution in sandboxed
            environments, enforce row-level security on database access, and
            scope OAuth tokens to the permissions you approve. No method of
            transmission or storage is 100% secure, so we cannot guarantee
            absolute security.
          </p>

          <h2 className="text-lg text-foreground">11. Children</h2>
          <p>
            The Service is not directed to anyone under 18, and we do not
            knowingly collect personal data from children. If we learn we have
            collected data from a child, we will delete it.
          </p>

          <h2 className="text-lg text-foreground">12. Changes to this policy</h2>
          <p>
            We may update this Privacy Policy from time to time. For material
            changes we will give notice — on this page, by email, or in the
            product — before the changes take effect.
          </p>

          <h2 className="text-lg text-foreground">13. Contact</h2>
          <p>
            Questions or requests about your data? Email{" "}
            <a
              href="mailto:support@mogplex.com"
              className="text-primary hover:underline"
            >
              support@mogplex.com
            </a>{" "}
            or open an issue on our{" "}
            <a
              href="https://github.com/mogplex/mogplex"
              className="text-primary hover:underline"
            >
              GitHub repository
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
