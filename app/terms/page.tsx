import type { Metadata } from "next";
import Link from "next/link";
import { buildMarketingMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMarketingMetadata({
  title: "Terms of Service — Mogplex",
  description:
    "The terms that govern access to and use of the Mogplex hosted service — the workbench for coding agents.",
  path: "/terms",
});

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-background text-foreground font-mono">
      <div className="max-w-2xl mx-auto px-6 py-16 space-y-8">
        <h1 className="text-2xl text-primary">Terms of Service</h1>
        <p className="text-muted-foreground text-sm">
          Last updated: August 15, 2026
        </p>

        <section className="space-y-4 text-sm leading-relaxed">
          <p>
            These Terms of Service (&quot;Terms&quot;) are a binding agreement
            between you and Mogplex Inc. (&quot;Mogplex&quot;, &quot;we&quot;,
            &quot;us&quot;). They govern your use of the hosted Mogplex service
            at mogplex.com, including the web app, the Mogplex CLI, the Mogplex
            MCP server, automations, and integrations (together, the
            &quot;Service&quot;). Our{" "}
            <Link href="/privacy" className="text-primary hover:underline">
              Privacy Policy
            </Link>{" "}
            is incorporated into these Terms. If you do not agree, do not use
            the Service.
          </p>
          <p>
            The Mogplex software itself is open source. If you download or
            self-host it from our repositories, that use is governed solely by
            the Apache License 2.0 — not these Terms. These Terms apply only to
            the hosted Service we operate.
          </p>

          <h2 className="text-lg text-foreground">What is Mogplex?</h2>
          <p>
            Mogplex is a workbench for coding agents. It connects to your
            repositories, runs AI agents that read, write, and modify code in
            isolated sandbox environments, and lets you drive that work from
            the browser, the CLI, MCP clients, or Slack. Agents are powered by
            large language models operated by third-party providers.
          </p>

          <h2 className="text-lg text-foreground">
            What are the basics of using Mogplex?
          </h2>
          <p>
            You sign in with an email address and password, through single
            sign-on (SSO), or with a supported identity provider (currently
            GitHub, Google, or Microsoft). You must be of legal age to form a
            binding contract, and if you accept these Terms on behalf of an
            organization, you represent that you are authorized to bind it.
          </p>
          <p>
            You are responsible for everything that happens under your account
            and credentials, including personal access tokens and CLI or MCP
            sessions you authorize. Keep them secure, and tell us promptly if
            you believe an account or token has been compromised. When you
            connect third-party accounts such as GitHub or Slack, you authorize
            Mogplex to act on those accounts within the scopes you approve.
          </p>

          <h2 className="text-lg text-foreground">
            What about company workspaces?
          </h2>
          <p>
            If you join a company workspace, its owners and admins control it.
            They add members and set each role. They also manage the shared
            billing account and capacity. They can see usage and cost for each
            member. They can also review the audit log. Each Business or
            Enterprise contract defines the billing and service terms.
          </p>

          <h2 className="text-lg text-foreground">
            Are there restrictions on how I can use the Service?
          </h2>
          <p>You agree not to use the Service to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Violate any applicable law or regulation</li>
            <li>
              Access repositories, systems, or data you are not authorized to
              access
            </li>
            <li>
              Run malware, cryptocurrency miners, denial-of-service attacks, or
              other abusive workloads
            </li>
            <li>
              Infringe anyone&apos;s intellectual property or other rights
            </li>
            <li>
              Attempt to probe, disable, or circumvent the Service&apos;s
              security measures
            </li>
            <li>
              Resell or white-label the hosted Service without our written
              consent (self-hosting under the open-source license is always
              fine)
            </li>
          </ul>
          <p>
            We may suspend or terminate accounts engaged in these activities.
          </p>

          <h2 className="text-lg text-foreground">Who owns what?</h2>
          <p>
            Your code, repositories, prompts, and configurations remain yours.
            As between you and Mogplex, you own the output that agents generate
            for you, and we assign to you any interest we might otherwise have
            in it. Because models can produce similar results for similar
            inputs, output may not be unique to you. We do not use your code,
            prompts, or conversations to train AI models.
          </p>
          <p>
            You grant us only the rights needed to operate the Service — to
            store your content, transmit it to the model providers and
            subprocessors you direct us to use, and display it back to you and
            your team. Mogplex retains all rights in the Service itself.
          </p>

          <h2 className="text-lg text-foreground">
            What about the AI models?
          </h2>
          <p>
            Agent conversations are processed by third-party model providers
            (such as Anthropic and OpenAI), routed through an AI gateway.
            Those providers&apos; terms and data policies apply to their
            processing. On plans where you bring your own gateway or provider
            key, your direct agreement with that provider governs.
          </p>
          <p>
            AI-generated output can be wrong, insecure, or subject to
            third-party rights. You are responsible for reviewing output before
            you rely on it, run it, or ship it.
          </p>

          <h2 className="text-lg text-foreground">
            Does the Service cost anything?
          </h2>
          <p>
            Yes. Mogplex Cloud has no free hosted plan. Each subscription gives
            you Concurrency, Storage, and Inference. Current plans and
            rates are on our{" "}
            <Link href="/pricing" className="text-primary hover:underline">
              pricing page
            </Link>
            .
          </p>
          <p>
            Mogplex applies the published retail factor when it bills managed
            AI and other hosted services. Sandbox compute and transfer use the
            published rates. Purchased inference credit does not expire.
          </p>
          <p>
            The Apache-2.0 software has no license fee. Self-hosters pay their
            providers directly.
          </p>

          <h2 className="text-lg text-foreground">Billing</h2>
          <p>
            Payments are processed by Stripe, which acts as merchant of record
            for the Service and collects and remits applicable indirect taxes.
            Your payment method is governed by your agreement with Stripe and
            your financial institution. Subscriptions renew and bill
            automatically each period until you cancel; you can cancel or
            change plans at any time through the billing portal, effective at
            the end of the current billing period. Usage charges accrued
            before cancellation remain payable.
          </p>

          <h2 className="text-lg text-foreground">
            Will Mogplex ever change the Service?
          </h2>
          <p>
            Yes. We may add, change, suspend, or discontinue features of the
            hosted Service. If we discontinue a paid capability you have
            prepaid for, we will refund the unused portion.
          </p>

          <h2 className="text-lg text-foreground">
            What if I want to stop using Mogplex?
          </h2>
          <p>
            You may stop using the Service and delete your account at any
            time. We may suspend or terminate your access if you breach these
            Terms or use the Service in a way that creates risk for us or
            other users. Sections that by their nature should survive
            termination — including payment obligations, ownership,
            disclaimers, limitation of liability, and indemnity — survive.
          </p>

          <h2 className="text-lg text-foreground">Warranty disclaimer</h2>
          <p>
            THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS
            AVAILABLE&quot; WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
            INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
            PURPOSE, NON-INFRINGEMENT, AND UNINTERRUPTED OR ERROR-FREE
            OPERATION. WE MAKE NO WARRANTY ABOUT THE ACCURACY, RELIABILITY, OR
            SAFETY OF AI-GENERATED OUTPUT.
          </p>

          <h2 className="text-lg text-foreground">Limitation of liability</h2>
          <p>
            TO THE FULLEST EXTENT PERMITTED BY LAW, MOGPLEX AND ITS
            CONTRIBUTORS WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL,
            SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF DATA,
            PROFITS, OR REVENUE, ARISING FROM YOUR USE OF THE SERVICE. OUR
            AGGREGATE LIABILITY UNDER THESE TERMS IS CAPPED AT THE GREATER OF
            (A) $100 OR (B) THE AMOUNTS YOU PAID US IN THE TWELVE MONTHS BEFORE
            THE CLAIM AROSE.
          </p>

          <h2 className="text-lg text-foreground">Indemnity</h2>
          <p>
            You will indemnify and hold Mogplex harmless from claims arising
            out of your content, your use of the Service in violation of these
            Terms, or your violation of applicable law or third-party rights.
          </p>

          <h2 className="text-lg text-foreground">Governing law</h2>
          <p>
            These Terms are governed by the laws of the State of Delaware,
            without regard to conflict-of-laws principles. Disputes will be
            resolved in the state or federal courts located in Delaware, and
            both parties consent to their jurisdiction.
          </p>

          <h2 className="text-lg text-foreground">
            Will these Terms ever change?
          </h2>
          <p>
            We may update these Terms from time to time. For material changes
            we will give notice — on this page, by email, or in the product —
            before the changes take effect. Continued use of the Service after
            changes take effect constitutes acceptance.
          </p>

          <h2 className="text-lg text-foreground">Miscellaneous</h2>
          <p>
            These Terms are the entire agreement between you and Mogplex about
            the hosted Service and supersede prior agreements on that subject.
            If a provision is found unenforceable, the rest remains in effect.
            You may not assign these Terms without our consent; we may assign
            them in connection with a merger, acquisition, or sale of assets.
            Our failure to enforce a provision is not a waiver.
          </p>

          <h2 className="text-lg text-foreground">Contact</h2>
          <p>
            Questions about these Terms? Email{" "}
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
