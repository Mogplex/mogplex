"use client"

import Link from "next/link"
import { useTheme } from "next-themes"
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"

import { MogplexMark } from "@/components/brand/mogplex-mark"
import { MogplexWordmark } from "@/components/brand/mogplex-wordmark"

import "./landing-v2.css"

const GITHUB_URL = "https://github.com/webrenew/mogplex"

const platformLinks = [
  {
    label: "Control planes",
    description: "Observe and steer every agent, run, and policy from one inspectable dashboard.",
    href: "#control-planes",
    glyph: "⌁",
  },
  {
    label: "Harnesses",
    description: "Sandboxed execution rigs where agents plan, build, and test code safely.",
    href: "#harnesses",
    glyph: "◇",
  },
  {
    label: "CLI",
    description: "Trigger runs, stream logs, and inspect pipelines without leaving the terminal.",
    href: "#run",
    glyph: ">_",
  },
  {
    label: "Connectors",
    description: "Wire GitHub, Slack, and CI into the pipeline with a few lines of config.",
    href: "#enterprise",
    glyph: "↗",
  },
] as const

const harnesses = [
  {
    id: "mogplex",
    label: "Mogplex native",
    status: "VALID POLICY",
    description:
      "Full planner-to-deploy orchestration with review fan-out, durable checkpoints, and policy-aware retries.",
    bullets: [
      "Multi-agent planning",
      "Native approvals and checkpoints",
      "End-to-end trace and cost graph",
    ],
    yaml: [
      ["harness", "mogplex"],
      ["model", "fable-5"],
      ["credentials", "vault://platform/anthropic"],
      ["sandbox", "enterprise-restricted"],
      ["policy", "production-default"],
    ],
  },
  {
    id: "claude",
    label: "Claude Code",
    status: "HARNESS READY",
    description:
      "Keep the Claude Code workflow developers know while Mogplex supplies policy, identity, and observability.",
    bullets: [
      "CLAUDE.md behavior preserved",
      "Provider key stays in vault",
      "Central policy without workflow changes",
    ],
    yaml: [
      ["harness", "claude-code"],
      ["model", "claude-sonnet-4-5"],
      ["credentials", "vault://platform/anthropic"],
      ["sandbox", "enterprise-restricted"],
      ["telemetry", "full"],
    ],
  },
  {
    id: "codex",
    label: "Codex",
    status: "HARNESS READY",
    description:
      "Run Codex inside the same governed delivery system, with repo boundaries and spend visible by default.",
    bullets: [
      "Keys delivered through the vault",
      "Repo and command allowlists",
      "Unified spend and audit reporting",
    ],
    yaml: [
      ["harness", "codex"],
      ["model", "gpt-5.6-sol"],
      ["credentials", "vault://platform/openai"],
      ["sandbox", "enterprise-restricted"],
      ["telemetry", "full"],
    ],
  },
] as const

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="mpx-eyebrow">
      <span aria-hidden>+</span> {children}
    </p>
  )
}

function AccentPeriod() {
  return <span className="mpx-accent">.</span>
}

function Check({ muted = false }: { muted?: boolean }) {
  return (
    <span className={muted ? "mpx-check is-muted" : "mpx-check"} aria-hidden>
      {muted ? "" : "✓"}
    </span>
  )
}

// The timeline intentionally derives several visible states from one phase.
// eslint-disable-next-line complexity
function LiveRunMockup() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const mockupRef = useRef<HTMLDivElement>(null)
  const [phase, setPhase] = useState(0)

  useEffect(() => {
    const wrap = wrapRef.current
    const mockup = mockupRef.current
    if (!wrap || !mockup) return

    const resize = () => {
      const scale = Math.min(1, wrap.clientWidth / 920)
      mockup.style.transform = `scale(${scale})`
      wrap.style.height = `${660 * scale}px`
    }
    const observer = new ResizeObserver(resize)
    observer.observe(wrap)
    resize()
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const reducedMotionTimer = setTimeout(() => setPhase(5), 0)
      return () => clearTimeout(reducedMotionTimer)
    }

    let cancelled = false
    let timers: ReturnType<typeof setTimeout>[] = []
    const run = () => {
      setPhase(0)
      const sequence = [
        [3600, 1],
        [4700, 2],
        [6200, 3],
        [7500, 4],
        [8800, 5],
      ] as const
      timers = sequence.map(([delay, next]) =>
        setTimeout(() => {
          if (!cancelled) setPhase(next)
        }, delay),
      )
      timers.push(
        setTimeout(() => {
          if (!cancelled) run()
        }, 14_500),
      )
    }
    run()
    return () => {
      cancelled = true
      timers.forEach(clearTimeout)
    }
  }, [])

  const implementDone = phase >= 1
  const filesVisible = phase >= 2
  const reviewsRunning = phase === 2
  const reviewsDone = phase >= 3
  const deployRunning = phase === 4
  const deployDone = phase >= 5

  return (
    <div className="mpx-run-scale-wrap" ref={wrapRef}>
      <div className="mpx-run-ui" ref={mockupRef} data-phase={phase}>
        <aside className="mpx-run-rail" aria-label="Run navigation">
          <MogplexMark className="mpx-run-mark" />
          {[
            ["⌁", "Pipelines"],
            ["▦", "Workspaces"],
            [">_", "Terminal"],
            ["▧", "Artifacts"],
            ["⚙", "Settings"],
          ].map(([glyph, label], index) => (
            <button key={label} type="button" aria-label={label} data-active={index === 0}>
              {glyph}
            </button>
          ))}
          <span className="mpx-avatar">MA<i /></span>
        </aside>

        <aside className="mpx-run-plan">
          <strong className="mpx-accent">RUN 4821</strong>
          <p className="mpx-run-commit">main · a1b2c3d</p>
          <div className="mpx-intent-card">
            <small>INTENT</small>
            <p>Add rate limiting to public API endpoints</p>
            <span>#4821</span>
          </div>
          <small className="mpx-plan-label">AGENT PLAN</small>
          <div className="mpx-plan-steps">
            <div><i>◇</i><span><b>PLANNER</b><small>Break down and sequence the work</small></span><Check /></div>
            <div><i>&lt;/&gt;</i><span><b>IMPLEMENT</b><small>Write code and add tests</small></span>{implementDone ? <Check /> : <span className="mpx-spinner" />}</div>
            <div><i>◎</i><span><b>REVIEW</b><small>Assess changes and request updates</small></span>{reviewsDone ? <Check /> : <Check muted />}</div>
            <div><i>↗</i><span><b>DEPLOY</b><small>Merge, build, and roll out safely</small></span>{deployDone ? <Check /> : <Check muted />}</div>
          </div>
          <button className="mpx-full-log" type="button">View full run log <span>→</span></button>
        </aside>

        <section className="mpx-run-canvas" aria-label="Animated agent run 4821">
          <div className="mpx-run-topbar">
            <span className={reviewsDone ? "mpx-top-check is-visible" : "mpx-top-check"}>
              <Check /> Checks passed
            </span>
            <div>
              <span className={filesVisible ? "mpx-files-pill is-visible" : "mpx-files-pill"}>
                3 files changed <b>+142</b> <em>−18</em>
              </span>
              <button type="button">View changes</button>
              <button type="button" aria-label="Run settings">⚙</button>
            </div>
          </div>

          <div className="mpx-run-graph">
            <svg viewBox="0 0 600 392" preserveAspectRatio="none" aria-hidden>
              <path d="M300 80V96" />
              <path d="M300 188V205H115V222" />
              <path d="M300 205H485V222" />
              <path d="M115 302V321H300V322" />
              <path d="M485 302V321H300" />
              <path className="is-dashed" d="M385 142H458V84" />
              <circle cx="300" cy="205" r="3" />
              <circle cx="300" cy="321" r="3" />
            </svg>

            <div className="mpx-agent-node is-planner">
              <header><span>◇</span><small>PLANNER</small><Check /></header>
              <p>Analyzed codebase and dependencies</p><time>1.2s</time>
            </div>
            <div className="mpx-agent-node is-implement">
              <header><span>&lt;/&gt;</span><small>IMPLEMENT</small>{implementDone ? <Check /> : <span className="mpx-live-dot" />}</header>
              <p>Create rate limiter middleware and tests</p>
              <div className="mpx-node-status"><span>{implementDone ? "Completed" : "Running"}</span><time>{implementDone ? "18s" : "13s"}</time></div>
              <div className="mpx-progress"><i /></div>
            </div>
            <div className="mpx-agent-node is-review-left">
              <header><span>◎</span><small>REVIEW</small>{reviewsDone ? <Check /> : reviewsRunning ? <span className="mpx-live-dot" /> : <Check muted />}</header>
              <p>Security review</p><time>{reviewsDone ? "Checks passed" : reviewsRunning ? "Running checks…" : "Queued"}</time>
            </div>
            <div className="mpx-agent-node is-review-right">
              <header><span>◎</span><small>REVIEW</small>{reviewsDone ? <Check /> : reviewsRunning ? <span className="mpx-live-dot" /> : <Check muted />}</header>
              <p>Code quality review</p><time>{reviewsDone ? "Checks passed" : reviewsRunning ? "Running checks…" : "Queued"}</time>
            </div>
            <div className="mpx-agent-node is-deploy">
              <header><span>↗</span><small>DEPLOY</small>{deployDone ? <Check /> : deployRunning ? <span className="mpx-live-dot" /> : <Check muted />}</header>
              <p>Staging deployment</p><time>{deployDone ? "Live" : deployRunning ? "Deploying…" : "Queued"}</time>
            </div>

            <div className={filesVisible ? "mpx-file-card is-visible" : "mpx-file-card"}>
              <strong>3 files changed</strong>
              <p><span>middleware/rate_limit.py</span><b>+78</b><em>−2</em></p>
              <p><span>tests/test_rate_limit.py</span><b>+45</b><em>−0</em></p>
              <p><span>app/api/routes.py</span><b>+19</b><em>−16</em></p>
            </div>
          </div>

          <div className="mpx-terminal">
            <header><b>TERMINAL</b><span>LOGS</span><span>EVENTS</span><small>Shell · zsh</small></header>
            <div>
              <p><i>$</i> mogplex run 4821</p>
              <p><time>10:25:02</time> <b>PASS</b> planner.completed <span>Analyzed codebase and dependencies</span></p>
              <p className={implementDone ? "is-visible" : ""}><time>10:25:20</time> <b>PASS</b> agent.implement.completed <span>(+142 −18)</span></p>
              <p className={reviewsDone ? "is-visible" : ""}><time>10:25:28</time> <b>PASS</b> review.completed <span>Security and quality checks passed</span></p>
              <p className={deployRunning || deployDone ? "is-visible" : ""}><time>10:25:29</time> <b>RUN</b> deploy.staging <span>{deployDone ? "Deployment live" : "Deployment in progress"}</span></p>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

function BlueprintOverlay() {
  return (
    <div className="mpx-blueprint" aria-hidden>
      <i className="mpx-cross is-nw" /><i className="mpx-cross is-ne" />
      <i className="mpx-cross is-sw" /><i className="mpx-cross is-se" />
      <span>021</span>
    </div>
  )
}

function ThemeMenu() {
  const { theme, setTheme } = useTheme()
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  )
  const current = mounted ? theme ?? "system" : "system"

  return (
    <details className="mpx-theme-menu">
      <summary aria-label="Choose color theme">◐ <span>{current}</span></summary>
      <div role="menu" aria-label="Color theme">
        {(["light", "system", "dark"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="menuitemradio"
            aria-checked={current === option}
            onClick={(event) => {
              setTheme(option)
              event.currentTarget.closest("details")?.removeAttribute("open")
            }}
          >
            <span>{option}</span>{current === option ? "✓" : ""}
          </button>
        ))}
      </div>
    </details>
  )
}

export function MarketingLandingPage() {
  const [platformOpen, setPlatformOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [activeHarness, setActiveHarness] = useState(0)
  const platformButtonRef = useRef<HTMLButtonElement>(null)
  const harnessRefs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => {
    document.body.classList.toggle("mpx-menu-open", mobileOpen)
    return () => document.body.classList.remove("mpx-menu-open")
  }, [mobileOpen])

  const onHarnessKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
    event.preventDefault()
    const last = harnesses.length - 1
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? last
        : event.key === "ArrowRight"
          ? (index + 1) % harnesses.length
          : (index - 1 + harnesses.length) % harnesses.length
    setActiveHarness(next)
    harnessRefs.current[next]?.focus()
  }

  const harness = harnesses[activeHarness]

  return (
    <div className="mpx-landing">
      <BlueprintOverlay />

      <header className="mpx-header">
        <nav className="mpx-nav" aria-label="Primary navigation">
          <Link href="/" className="mpx-brand" aria-label="Mogplex home">
            <MogplexWordmark height={24} />
          </Link>

          <div className="mpx-nav-links">
            <div
              className="mpx-platform-wrap"
              onMouseEnter={() => setPlatformOpen(true)}
              onMouseLeave={() => setPlatformOpen(false)}
              onFocus={() => setPlatformOpen(true)}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return
                setPlatformOpen(false)
                platformButtonRef.current?.focus()
              }}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setPlatformOpen(false)
              }}
            >
              <button
                ref={platformButtonRef}
                type="button"
                aria-haspopup="true"
                aria-expanded={platformOpen}
                aria-controls="platform-menu"
                onClick={(event) => {
                  setPlatformOpen((open) => (event.detail === 0 ? !open : true))
                }}
              >
                Platform <span>⌄</span>
              </button>
              <div id="platform-menu" className="mpx-platform-menu" hidden={!platformOpen}>
                <Eyebrow>PLATFORM · ONE PIPELINE, EVERY SURFACE</Eyebrow>
                <div>
                  {platformLinks.map((item) => (
                    <a key={item.label} href={item.href} onClick={() => setPlatformOpen(false)}>
                      <i>{item.glyph}</i><span><b>{item.label}</b><small>{item.description}</small></span><em>→</em>
                    </a>
                  ))}
                </div>
              </div>
            </div>
            <a href="#capabilities">Enterprise</a>
            <a href="https://docs.mogplex.com">Developers</a>
            <Link href="/faq">Company</Link>
            <a href="https://docs.mogplex.com">Docs</a>
          </div>

          <span className="mpx-control-stamp">CONTROL PLANE v0.9.14</span>
          <a className="mpx-live-link" href="#run">View a live run</a>
          <a className="mpx-github-pill" href={GITHUB_URL} target="_blank" rel="noreferrer noopener" aria-label="View Mogplex on GitHub">
            GitHub ↗
          </a>
          <Link className="mpx-button is-primary is-small" href="/signup">Start building</Link>
          <button
            type="button"
            className="mpx-mobile-toggle"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
            onClick={() => setMobileOpen((open) => !open)}
          ><span /><span /></button>
        </nav>
        <nav id="mobile-nav" className="mpx-mobile-nav" hidden={!mobileOpen} aria-label="Mobile navigation">
          <a href="#capabilities" onClick={() => setMobileOpen(false)}>Enterprise</a>
          <a href="#harnesses" onClick={() => setMobileOpen(false)}>Harnesses</a>
          <a href="https://docs.mogplex.com" onClick={() => setMobileOpen(false)}>Docs</a>
          <a href={GITHUB_URL} onClick={() => setMobileOpen(false)}>GitHub</a>
          <Link href="/signup" onClick={() => setMobileOpen(false)}>Start building</Link>
        </nav>
      </header>

      <main>
        <section className="mpx-hero" data-testid="landing-hero">
          <div className="mpx-hero-copy">
            <Eyebrow>OPEN-SOURCE AGENTIC SOFTWARE FACTORY</Eyebrow>
            <h1>The open-source agentic software factory<AccentPeriod /></h1>
            <p>Mogplex coordinates agents that plan, build, review, and ship code through one inspectable pipeline.</p>
            <div className="mpx-hero-actions">
              <a className="mpx-button is-primary" href={GITHUB_URL} target="_blank" rel="noreferrer noopener" data-testid="landing-primary-cta">View on GitHub <span>↗</span></a>
              <a className="mpx-button is-secondary" href="#run">See how it works <span>↓</span></a>
            </div>
            <div className="mpx-hero-stamps">
              <span>+ MOGPLEX SYSTEMS</span>
              <span>+ INTENT → REVIEWED → RUNNING CODE</span>
              <span>+ CONTROLLED. OBSERVABLE. AGENTIC.</span>
            </div>
          </div>
          <div id="run" className="mpx-hero-run">
            <LiveRunMockup />
          </div>
        </section>

        <section className="mpx-proof" aria-label="Enterprise defaults">
          <Eyebrow>GOVERNED BY DEFAULT</Eyebrow>
          {[
            ["○", "Zero training data"],
            ["⌘", "Bring your own keys"],
            ["▣", "Policy-bound sandboxes"],
            ["⌁", "Cost-attributed traces"],
          ].map(([icon, label]) => <div key={label}><i>{icon}</i><span>{label}</span></div>)}
        </section>

        <section id="capabilities" className="mpx-capabilities">
          <div className="mpx-section-intro">
            <div><Eyebrow>ENTERPRISE CONTROL PLANE</Eyebrow><h2>Move at agent speed. <span>Keep enterprise control<AccentPeriod /></span></h2></div>
            <p>Standardize how every agent accesses models, code, credentials, and infrastructure, without slowing down the teams doing the work.</p>
          </div>

          <div className="mpx-cap-grid">
            <article className="mpx-cap is-zdr">
              <div><Eyebrow>ZERO DATA RETENTION</Eyebrow><span className="mpx-default-pill">DEFAULT ON</span></div>
              <h3>Your code is never model training data<AccentPeriod /></h3>
              <div className="mpx-zdr-flow">
                <div><small>01 · INGRESS</small><b>Encrypted context</b><span>TLS 1.3</span></div><i>→</i>
                <div><small>02 · EXECUTION</small><b>Ephemeral runtime</b><span>Isolated</span></div><i>→</i>
                <div><small>03 · EGRESS</small><b>Policy-filtered output</b><span>Secrets redacted</span></div>
              </div>
            </article>

            <article className="mpx-cap is-byok">
              <Eyebrow>BRING YOUR OWN KEYS</Eyebrow>
              <h3>Your providers. Your contracts. Your keys<AccentPeriod /></h3>
              <div className="mpx-vault"><small>VAULT://PLATFORM/PRODUCTION</small>{["Anthropic", "OpenAI", "AWS Bedrock"].map((provider, index) => <p key={provider}><span>{provider}</span><b>{index === 2 ? "AVAILABLE" : "CONNECTED"}</b></p>)}</div>
            </article>

            <article id="control-planes" className="mpx-cap is-observe">
              <Eyebrow>OBSERVABILITY</Eyebrow>
              <h3>Trace every decision down to the dollar<AccentPeriod /></h3>
              <div className="mpx-trace"><small>RUN 4821 · 43.1s</small>{[
                ["PLANNER", "1.2s", "8%"], ["IMPLEMENT", "18.0s", "46%"], ["SECURITY", "2.1s", "24%"], ["QUALITY", "2.8s", "31%"], ["DEPLOY", "22.0s", "64%"],
              ].map(([label, time, width]) => <p key={label}><span>{label}</span><i style={{ width }} /><time>{time}</time></p>)}</div>
              <div className="mpx-stats"><p><small>TOKENS</small><b>84.2k</b></p><p><small>COST</small><b>$2.18</b></p><p><small>TOOLS</small><b>37</b></p></div>
              <div className="mpx-chips"><span>OTEL EXPORT</span><span>LIVE REPLAY</span><span>COST ATTRIBUTION</span></div>
            </article>

            <article className="mpx-cap is-sandbox">
              <Eyebrow>SANDBOX POLICY</Eyebrow><h3>Define exactly where agents can go<AccentPeriod /></h3>
              <div className="mpx-policy">{[["Network egress", "ALLOWLIST"], ["Filesystem", "WORKSPACE ONLY"], ["Secrets", "SCOPED"], ["Max runtime", "20 MIN"]].map(([key, value]) => <p key={key}><span>{key}</span><b>{value}</b></p>)}</div>
            </article>

            <article className="mpx-cap is-small-cap"><Eyebrow>MULTI-HARNESS</Eyebrow><h3>One factory. Every harness<AccentPeriod /></h3><div className="mpx-harness-stack"><i>M</i><i>CC</i><i>CX</i></div><a href="#harnesses">Explore harnesses →</a></article>
            <article className="mpx-cap is-small-cap"><Eyebrow>TEAM CONTROLS</Eyebrow><h3>Budgets and models, set once<AccentPeriod /></h3><div className="mpx-budget"><p><span>JULY SPEND</span><b>$18,420 / $25,000</b></p><i><span /></i></div><div className="mpx-models"><span>GPT 5.6 SOL ✓</span><span>FABLE 5 ✓</span><span>KIMI K3 ✓</span></div></article>
            <article className="mpx-cap is-small-cap"><Eyebrow>ROLE-BASED ACCESS</Eyebrow><h3>The right access at every step<AccentPeriod /></h3><div className="mpx-rbac"><small><span>ROLE</span><b>RUN</b><b>SHIP</b><b>ADMIN</b></small>{[["Developer", "●", "○", "○"], ["Release lead", "●", "●", "○"], ["Platform admin", "●", "●", "●"]].map((row) => <p key={row[0]}>{row.map((cell, index) => index === 0 ? <span key={cell}>{cell}</span> : <b key={`${cell}-${index}`}>{cell}</b>)}</p>)}</div></article>
          </div>
        </section>

        <section id="harnesses" className="mpx-harnesses">
          <div className="mpx-harness-inner">
            <Eyebrow>MULTI-HARNESS ORCHESTRATION</Eyebrow>
            <h2>Any harness. <span>Same factory<AccentPeriod /></span></h2>
            <p className="mpx-harness-lede">Bring the coding agent your team already trusts. Mogplex gives every harness the same controls, telemetry, and delivery path.</p>
            <div className="mpx-harness-tabs" role="tablist" aria-label="Harness options">
              {harnesses.map((item, index) => (
                <button
                  key={item.id}
                  ref={(node) => { harnessRefs.current[index] = node }}
                  type="button"
                  role="tab"
                  id={`harness-tab-${item.id}`}
                  aria-selected={index === activeHarness}
                  aria-controls={`harness-panel-${item.id}`}
                  tabIndex={index === activeHarness ? 0 : -1}
                  onClick={() => setActiveHarness(index)}
                  onKeyDown={(event) => onHarnessKeyDown(event, index)}
                >{item.label}</button>
              ))}
            </div>
            <div className="mpx-harness-panel" role="tabpanel" id={`harness-panel-${harness.id}`} aria-labelledby={`harness-tab-${harness.id}`}>
              <div className="mpx-code-panel"><header><span>MOGPLEX.YAML</span><b>{harness.status}</b></header><pre>{harness.yaml.map(([key, value]) => <code key={key}><span>{key}:</span> {value}{"\n"}</code>)}</pre></div>
              <div className="mpx-harness-copy"><Eyebrow>{harness.label}</Eyebrow><h3>{harness.description}</h3><ul>{harness.bullets.map((bullet) => <li key={bullet}><Check />{bullet}</li>)}</ul></div>
            </div>
          </div>
        </section>

        <section id="enterprise" className="mpx-enterprise">
          <div className="mpx-enterprise-card">
            <div className="mpx-enterprise-copy">
              <Eyebrow>BUILT FOR YOUR ENVIRONMENT</Eyebrow>
              <h2>Standardize agents across the enterprise<AccentPeriod /></h2>
              <p>Put one governed delivery system under every team and every coding harness, while keeping the infrastructure choices you already made.</p>
              <div className="mpx-enterprise-actions"><a className="mpx-button is-primary" href="mailto:enterprise@mogplex.com">Talk to enterprise →</a><a className="mpx-button is-secondary" href="#capabilities">Review controls</a></div>
              <div className="mpx-enterprise-tiles">{["SSO/SAML + SCIM", "VPC or self-hosted", "Immutable audit export", "Enterprise SLA"].map((item) => <span key={item}>{item}</span>)}</div>
            </div>
            <div className="mpx-connectors">
              <Eyebrow>CONNECTORS</Eyebrow>
              <div>{[["SOURCE", "GitHub · GitLab"], ["IDENTITY", "Okta · Entra ID"], ["SECRETS", "Vault · KMS"], ["TELEMETRY", "OTel · Datadog"], ["WORKFLOW", "Slack · Jira"], ["DELIVERY", "CI · Kubernetes"]].map(([label, value]) => <p key={label}><small>{label}</small><b>{value}</b></p>)}</div>
              <aside><b>POLICY SYNCED</b><p>Every connector inherits workspace RBAC, secret scopes, audit rules, and data controls automatically.</p></aside>
            </div>
          </div>
        </section>
      </main>

      <footer className="mpx-footer">
        <div className="mpx-footer-main">
          <div><MogplexWordmark height={26} /><p>The open-source control plane for building, governing, and scaling agentic software delivery.</p><span className="mpx-system-status"><i /> ALL SYSTEMS OPERATIONAL</span></div>
          <nav aria-label="Footer navigation">
            <div><b>PLATFORM</b><a href="#control-planes">Control planes</a><a href="#harnesses">Harnesses</a><a href="#run">CLI</a><a href="#enterprise">Connectors</a></div>
            <div><b>ENTERPRISE</b><a href="#capabilities">Security</a><a href="#capabilities">Governance</a><a href="#enterprise">Deployment</a><a href="mailto:enterprise@mogplex.com">Contact</a></div>
            <div><b>DEVELOPERS</b><a href="https://docs.mogplex.com">Docs</a><a href="https://docs.mogplex.com/quickstart">Quickstart</a><a href={GITHUB_URL}>GitHub</a><Link href="/workflows">Workflows</Link></div>
            <div><b>COMPANY</b><Link href="/faq">About</Link><Link href="/conduct">Conduct</Link><a href="https://docs.mogplex.com/security">Security</a><Link href="/privacy">Privacy</Link></div>
          </nav>
        </div>
        <div className="mpx-footer-bottom"><span>© 2026 MOGPLEX SYSTEMS. APACHE-2.0.</span><div><Link href="/privacy">PRIVACY</Link><Link href="/terms">TERMS</Link><a href="https://docs.mogplex.com/security">SECURITY</a></div><ThemeMenu /></div>
      </footer>
    </div>
  )
}
