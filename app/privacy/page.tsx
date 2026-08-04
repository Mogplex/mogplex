import type { Metadata } from "next";
import { buildMarketingMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMarketingMetadata({
  title: "Privacy Policy — Mogplex",
  description:
    "Read how Mogplex collects, stores, and uses account, OAuth, and usage data for the coding-agent workbench.",
  path: "/privacy",
});

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background text-foreground font-mono">
      <div className="max-w-2xl mx-auto px-6 py-16 space-y-8">
        <h1 className="text-2xl text-primary">Privacy Policy</h1>
        <p className="text-muted-foreground text-sm">
          Last updated: July 27, 2026
        </p>

        <section className="space-y-4 text-sm leading-relaxed">
          <h2 className="text-lg text-foreground">1. Information We Collect</h2>
          <p>When you use Mogplex, we collect:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Account information:</strong> GitHub username, email, avatar, and Vercel username obtained through OAuth</li>
            <li><strong>OAuth tokens:</strong> GitHub and Vercel access tokens used to interact with your repositories and Vercel resources on your behalf</li>
            <li><strong>Usage data:</strong> Agent configurations, assignment settings, and conversation history stored in your account</li>
            <li><strong>Slack tool execution data:</strong> Tool results and error details stored temporarily to prevent duplicate actions when Slack retries an event</li>
          </ul>

          <h2 className="text-lg text-foreground">2. How We Use Your Information</h2>
          <p>We use your information solely to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Authenticate you and maintain your session</li>
            <li>Access your GitHub repositories as you direct</li>
            <li>Create and manage Vercel Sandboxes on your behalf</li>
            <li>Store your agent configurations and conversation history</li>
          </ul>

          <h2 className="text-lg text-foreground">3. Data Storage</h2>
          <p>Your data is stored in Supabase (PostgreSQL) with row-level security ensuring you can only access your own data. OAuth tokens are stored in your user profile and used only for API calls you initiate. Slack tool execution data is accessible only to the service role used by Mogplex&apos;s server.</p>

          <h2 className="text-lg text-foreground">4. Third-Party Services</h2>
          <p>Mogplex integrates with:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>GitHub:</strong> To access your repositories (governed by GitHub&apos;s privacy policy)</li>
            <li><strong>Vercel:</strong> To create sandboxes and use AI Gateway (governed by Vercel&apos;s privacy policy)</li>
            <li><strong>Supabase:</strong> For database and authentication infrastructure</li>
            <li><strong>AI providers:</strong> Conversations are sent to the AI model provider you select (Anthropic, OpenAI, Google, etc.)</li>
          </ul>

          <h2 className="text-lg text-foreground">5. Data Sharing</h2>
          <p>We do not sell, trade, or share your personal information with third parties. Your data is only sent to the services listed above as required to provide the functionality you request.</p>

          <h2 className="text-lg text-foreground">6. Data Retention</h2>
          <p>Your data is retained as long as your account exists. You can delete your account and associated data by contacting us. Sandbox environments are ephemeral and destroyed when stopped. Slack tool execution results and errors are automatically deleted after 24 hours.</p>

          <h2 className="text-lg text-foreground">7. Security</h2>
          <p>We use industry-standard security practices including encrypted connections (HTTPS), row-level security policies on all database tables, and secure OAuth flows. However, no method of transmission over the internet is 100% secure.</p>

          <h2 className="text-lg text-foreground">8. Your Rights</h2>
          <p>You may request access to, correction of, or deletion of your personal data at any time. You can revoke OAuth access from your GitHub and Vercel account settings.</p>

          <h2 className="text-lg text-foreground">9. Changes to This Policy</h2>
          <p>We may update this Privacy Policy from time to time. We will notify users of material changes by updating the date at the top of this page.</p>

          <h2 className="text-lg text-foreground">10. Contact</h2>
          <p>Questions about privacy? Open an issue on our <a href="https://github.com/mogplex/mogplex" className="text-primary hover:underline">GitHub repository</a>.</p>
        </section>
      </div>
    </main>
  )
}
