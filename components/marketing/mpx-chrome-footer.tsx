import Link from "next/link";
import { GITHUB_URL, SELF_HOSTING_URL } from "./mpx-chrome-constants";
import { ThemeMenu } from "./mpx-theme-menu";
export { ThemeMenu } from "./mpx-theme-menu";

export function MpxFooter() {
  return (
    <footer className="mpx-footer">
      <div className="mpx-footer-main">
        <div>
          <Link href="/" className="mpx-footer-brand">
            mogplex
          </Link>
          <p>
            The open-source system that builds and maintains software with
            agents.
          </p>
          <span className="mpx-system-status">
            <i /> APACHE-2.0 · PUBLIC SOURCE
          </span>
        </div>
        <nav aria-label="Footer navigation">
          <div>
            <b>PLATFORM</b>
            <Link href="/#control-planes">Control plane</Link>
            <Link href="/#harnesses">Harnesses</Link>
            <Link href="/#run">CLI</Link>
            <Link href="/#capabilities">Connectors</Link>
          </div>
          <div>
            <b>OPEN SOURCE</b>
            <Link href="/#capabilities">Security</Link>
            <a href={SELF_HOSTING_URL} target="_blank" rel="noopener noreferrer">Self-hosting</a>
            <a href="https://docs.mogplex.com">Docs</a>
          </div>
          <div>
            <b>DEVELOPERS</b>
            <a href="https://docs.mogplex.com">Docs</a>
            <a href="https://docs.mogplex.com/quickstart">Quickstart</a>
            <a href={GITHUB_URL}>GitHub</a>
            <a href={`${GITHUB_URL}/releases`}>Changelog</a>
          </div>
          <div>
            <b>COMPANY</b>
            <Link href="/company">About</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/faq">FAQ</Link>
            <a href={`${GITHUB_URL}/security/policy`}>Security</a>
          </div>
        </nav>
      </div>
      <div className="mpx-footer-bottom">
        <p>&copy; {new Date().getFullYear()} MOGPLEX INC.</p>
        <div>
          <Link href="/privacy">PRIVACY</Link>
          <Link href="/terms">TERMS</Link>
          <a href={`${GITHUB_URL}/security/policy`}>SECURITY</a>
          <ThemeMenu />
        </div>
      </div>
    </footer>
  );
}
