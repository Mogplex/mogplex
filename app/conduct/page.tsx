import type { Metadata } from "next";
import { buildMarketingMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMarketingMetadata({
  title: "Code of Conduct — Mogplex",
  description:
    "Read the community conduct expectations for participating in Mogplex spaces and project discussions.",
  path: "/conduct",
});

export default function ConductPage() {
  return (
    <main className="min-h-screen bg-background text-foreground font-mono">
      <div className="max-w-2xl mx-auto px-6 py-16 space-y-8">
        <h1 className="text-2xl text-primary">Code of Conduct</h1>
        <p className="text-muted-foreground text-sm">Contributor Covenant v2.1</p>

        <section className="space-y-4 text-sm leading-relaxed">
          <h2 className="text-lg text-foreground">Our Pledge</h2>
          <p>We as members, contributors, and leaders pledge to make participation in our community a harassment-free experience for everyone, regardless of age, body size, visible or invisible disability, ethnicity, sex characteristics, gender identity and expression, level of experience, education, socio-economic status, nationality, personal appearance, race, caste, color, religion, or sexual identity and orientation.</p>

          <h2 className="text-lg text-foreground">Our Standards</h2>
          <p>Examples of behavior that contributes to a positive environment:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Demonstrating empathy and kindness toward other people</li>
            <li>Being respectful of differing opinions, viewpoints, and experiences</li>
            <li>Giving and gracefully accepting constructive feedback</li>
            <li>Accepting responsibility and apologizing to those affected by our mistakes</li>
            <li>Focusing on what is best for the overall community</li>
          </ul>

          <p>Examples of unacceptable behavior:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>The use of sexualized language or imagery, and sexual attention or advances of any kind</li>
            <li>Trolling, insulting or derogatory comments, and personal or political attacks</li>
            <li>Public or private harassment</li>
            <li>Publishing others&apos; private information without their explicit permission</li>
            <li>Other conduct which could reasonably be considered inappropriate in a professional setting</li>
          </ul>

          <h2 className="text-lg text-foreground">Enforcement</h2>
          <p>Community leaders are responsible for clarifying and enforcing our standards of acceptable behavior and will take appropriate and fair corrective action in response to any behavior that they deem inappropriate, threatening, offensive, or harmful.</p>

          <h2 className="text-lg text-foreground">Scope</h2>
          <p>This Code of Conduct applies within all community spaces, and also applies when an individual is officially representing the community in public spaces.</p>

          <h2 className="text-lg text-foreground">Enforcement Guidelines</h2>
          <p>Community leaders will follow these impact guidelines in determining consequences:</p>
          <ol className="list-decimal pl-6 space-y-2">
            <li><strong>Correction:</strong> A private, written warning providing clarity around the nature of the violation.</li>
            <li><strong>Warning:</strong> A warning with consequences for continued behavior.</li>
            <li><strong>Temporary Ban:</strong> A temporary ban from any sort of interaction or public communication with the community.</li>
            <li><strong>Permanent Ban:</strong> A permanent ban from any sort of public interaction within the community.</li>
          </ol>

          <h2 className="text-lg text-foreground">Reporting</h2>
          <p>Instances of abusive, harassing, or otherwise unacceptable behavior may be reported by opening an issue on our <a href="https://github.com/mogplex/mogplex" className="text-primary hover:underline">GitHub repository</a> or contacting the project maintainers directly.</p>

          <h2 className="text-lg text-foreground">Attribution</h2>
          <p>This Code of Conduct is adapted from the <a href="https://www.contributor-covenant.org/version/2/1/code_of_conduct/" className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">Contributor Covenant, version 2.1</a>.</p>
        </section>
      </div>
    </main>
  )
}
