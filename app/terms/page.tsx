import type { Metadata } from "next";
import { buildMarketingMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMarketingMetadata({
  title: "Terms of Service — Mogplex",
  description:
    "Read the terms that govern access to and use of Mogplex, the browser-based workspace for AI-agent workflows.",
  path: "/terms",
});

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-background text-foreground font-mono">
      <div className="max-w-2xl mx-auto px-6 py-16 space-y-8">
        <h1 className="text-2xl text-primary">Terms of Service</h1>
        <p className="text-muted-foreground text-sm">Last updated: March 15, 2026</p>

        <section className="space-y-4 text-sm leading-relaxed">
          <h2 className="text-lg text-foreground">1. Acceptance of Terms</h2>
          <p>By accessing or using Mogplex (&quot;the Service&quot;), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.</p>

          <h2 className="text-lg text-foreground">2. Description of Service</h2>
          <p>Mogplex is a browser-based terminal multiplexer for AI agents. It allows users to connect GitHub repositories, manage AI agent workflows, and run code in isolated Vercel Sandbox environments.</p>

          <h2 className="text-lg text-foreground">3. Account &amp; Authentication</h2>
          <p>You may sign in using GitHub OAuth or Vercel OAuth. By connecting these accounts, you authorize Mogplex to access your repositories and Vercel resources as permitted by the OAuth scopes you approve. You are responsible for maintaining the security of your connected accounts.</p>

          <h2 className="text-lg text-foreground">4. Vercel Sandbox Usage &amp; Billing</h2>
          <p>When you launch a sandbox, it runs under your Vercel account using your Vercel credentials. All sandbox compute costs (CPU, memory, network) are billed directly to your Vercel account. Mogplex does not intermediate or mark up these charges.</p>

          <h2 className="text-lg text-foreground">5. Acceptable Use</h2>
          <p>You agree not to use the Service to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Violate any applicable laws or regulations</li>
            <li>Access repositories or systems without authorization</li>
            <li>Run malicious code, cryptocurrency miners, or denial-of-service attacks</li>
            <li>Attempt to circumvent security measures or rate limits</li>
          </ul>

          <h2 className="text-lg text-foreground">6. Intellectual Property</h2>
          <p>Your code and repositories remain yours. Mogplex does not claim ownership of any content you create, upload, or process through the Service. Mogplex is open source under the Apache License 2.0.</p>

          <h2 className="text-lg text-foreground">7. Disclaimer of Warranties</h2>
          <p>The Service is provided &quot;as is&quot; without warranty of any kind, express or implied, including but not limited to merchantability, fitness for a particular purpose, and non-infringement.</p>

          <h2 className="text-lg text-foreground">8. Limitation of Liability</h2>
          <p>In no event shall Mogplex or its contributors be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the Service.</p>

          <h2 className="text-lg text-foreground">9. Changes to Terms</h2>
          <p>We may update these Terms at any time. Continued use of the Service after changes constitutes acceptance of the new Terms.</p>

          <h2 className="text-lg text-foreground">10. Contact</h2>
          <p>Questions about these Terms? Open an issue on our <a href="https://github.com/mogplex/mogplex" className="text-primary hover:underline">GitHub repository</a>.</p>
        </section>
      </div>
    </main>
  )
}
