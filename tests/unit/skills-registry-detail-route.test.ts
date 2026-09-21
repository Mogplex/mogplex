import assert from "node:assert/strict";
import test from "node:test";

const LISTING_HTML = `<html><head><title>web-design-guidelines | skills.sh</title>
<meta name="description" content="Review UI code for &quot;guidelines&quot;"></head>
<body><h1>web-design-guidelines</h1><p>1,234 weekly installs</p>
<pre><code>npx skills add vercel-labs/agent-skills --skill web-design-guidelines</code></pre>
</body></html>`;

function params(...path: string[]) {
  return { params: Promise.resolve({ path }) };
}

async function load() {
  return import("../../app/api/skills/registry/[...path]/route");
}

function page(html: string, status = 200) {
  return (async () =>
    new Response(html, { status })) as unknown as typeof fetch;
}

test("a registry skill's detail carries the SKILL.md from its source repo, not the page's install command", async () => {
  const { createRegistrySkillDetailGetHandler } = await load();
  const asked: unknown[] = [];
  const handler = createRegistrySkillDetailGetHandler({
    fetchPage: page(LISTING_HTML),
    fetchSkillMarkdown: async (input) => {
      asked.push(input);
      return {
        content:
          "# Web Interface Guidelines\n\nFetch the guidelines, then review.",
        name: "web-design-guidelines",
        description: "Review UI code for guideline compliance.",
        url: "https://raw.githubusercontent.com/vercel-labs/agent-skills/HEAD/skills/web-design-guidelines/SKILL.md",
      };
    },
  });

  const response = await handler(
    new Request(
      "http://localhost/api/skills/registry/vercel-labs/agent-skills/web-design-guidelines"
    ),
    params("vercel-labs", "agent-skills", "web-design-guidelines")
  );
  assert.equal(response.status, 200);
  const detail = await response.json();
  assert.deepEqual(asked, [
    { source: "vercel-labs/agent-skills", skillId: "web-design-guidelines" },
  ]);
  assert.equal(
    detail.content,
    "# Web Interface Guidelines\n\nFetch the guidelines, then review."
  );
  assert.equal(detail.description, "Review UI code for guideline compliance.");
  assert.equal(detail.installs, 1234);
  assert.equal(
    detail.installCommand,
    "npx skills add vercel-labs/agent-skills --skill web-design-guidelines"
  );
});

test("a registry skill without a readable SKILL.md falls back to the listing page", async () => {
  const { createRegistrySkillDetailGetHandler } = await load();
  const handler = createRegistrySkillDetailGetHandler({
    fetchPage: page(LISTING_HTML),
    fetchSkillMarkdown: async () => null,
  });
  const response = await handler(
    new Request("http://localhost/api/skills/registry/acme/skills/no-markdown"),
    params("acme", "skills", "no-markdown")
  );
  const detail = await response.json();
  assert.equal(
    detail.content,
    "npx skills add vercel-labs/agent-skills --skill web-design-guidelines"
  );
  assert.equal(detail.name, "web-design-guidelines");
});

test("a registry skill that does not exist reports the listing's status", async () => {
  const { createRegistrySkillDetailGetHandler } = await load();
  let askedForMarkdown = false;
  const handler = createRegistrySkillDetailGetHandler({
    fetchPage: page("not found", 404),
    fetchSkillMarkdown: async () => {
      askedForMarkdown = true;
      return null;
    },
  });
  const response = await handler(
    new Request("http://localhost/api/skills/registry/acme/skills/missing"),
    params("acme", "skills", "missing-skill")
  );
  assert.equal(response.status, 404);
  assert.equal(askedForMarkdown, false);
});
