"use client";

import Link from "next/link";

import {
  AccentPeriod,
  Eyebrow,
  GITHUB_URL,
  SELF_HOSTING_URL,
} from "@/components/marketing/mpx-chrome";

export function EnterpriseSection() {
  return (
    <section id="open-source" className="mpx-enterprise">
      <div className="mpx-enterprise-card">
        <div className="mpx-enterprise-copy">
          <Eyebrow large>READ IT FIRST</Eyebrow>
          <h2>
            Read it before you run it
            <AccentPeriod />
          </h2>
          <p>
            Code that authenticates against your repos must be readable
            before you run it. The platform is Apache-2.0 on GitHub. Read
            it, file issues, and send patches.
          </p>
          <p>
            Need the system inside your own network? Self-host it with no
            license fee. Want shared company control or custom terms? Email{" "}
            <a href="mailto:enterprise@mogplex.com">enterprise@mogplex.com</a>{" "}
            and talk to the people who build it.
          </p>
          <div className="mpx-enterprise-actions">
            <a
              className="mpx-button is-primary"
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer noopener"
            >
              Read the code
            </a>
            <a
              className="mpx-button is-secondary"
              href={SELF_HOSTING_URL}
            >
              Self-hosting docs
            </a>
          </div>
        </div>
        <div className="mpx-connectors">
          <header>
            <p className="mpx-cap-kicker">START HERE</p>
            <span>INDIVIDUAL SELF-SERVICE</span>
          </header>
          <h3>Wire your first pipeline tonight.</h3>
          <div>
            <p>
              <small>PRICE</small>
              <b>Individual plans from $20</b>
            </p>
            <p>
              <small>CAPACITY</small>
              <b>Three visible limits</b>
            </p>
            <p>
              <small>PLATFORM</small>
              <b>github.com/mogplex/mogplex</b>
            </p>
            <p>
              <small>DOCS</small>
              <b>docs.mogplex.com/quickstart</b>
            </p>
          </div>
          <aside>
            <Link className="mpx-button is-primary" href="/signup">
              Start now
            </Link>
          </aside>
        </div>
      </div>
    </section>
  );
}
