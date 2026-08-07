// Pure SVG icon components for marketing chrome.
// Extracted from mpx-chrome.tsx for module size compliance.

export function ArrowRight({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 12h15M13 6l6 6-6 6" />
    </svg>
  );
}

export function GithubGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2C6.477 2 2 6.484 2 12.021c0 4.428 2.865 8.184 6.839 9.504.5.092.682-.217.682-.483 0-.237-.009-.866-.014-1.7-2.782.605-3.369-1.343-3.369-1.343-.455-1.157-1.11-1.465-1.11-1.465-.908-.621.069-.608.069-.608 1.004.071 1.532 1.032 1.532 1.032.892 1.53 2.341 1.088 2.91.832.091-.647.349-1.088.635-1.338-2.221-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.987 1.029-2.687-.103-.253-.446-1.269.098-2.647 0 0 .84-.269 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.58 9.58 0 0 1 2.504.337c1.909-1.295 2.748-1.026 2.748-1.026.546 1.378.203 2.394.1 2.647.64.7 1.028 1.594 1.028 2.687 0 3.848-2.337 4.695-4.566 4.943.359.31.678.921.678 1.856 0 1.34-.012 2.421-.012 2.751 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.021C22 6.484 17.523 2 12 2Z" />
    </svg>
  );
}

export function StarGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="m12 2.8 2.8 5.7 6.3.9-4.6 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2-4.6-4.4 6.3-.9L12 2.8Z" />
    </svg>
  );
}

export function SunIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2v2.2M12 19.8V22M4.93 4.93l1.56 1.56M17.51 17.51l1.56 1.56M2 12h2.2M19.8 12H22M4.93 19.07l1.56-1.56M17.51 6.49l1.56-1.56" />
    </svg>
  );
}

export function MoonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5 8.6 8.6 0 1 0 20.5 15.2Z" />
    </svg>
  );
}

export function SystemIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="M8 21h8M12 18v3" />
    </svg>
  );
}
