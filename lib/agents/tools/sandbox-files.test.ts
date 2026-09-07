import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createEditFile,
  createSandboxListFiles,
  createSandboxReadFile,
  createWriteFile,
} from "./sandbox-files";

type Executable = {
  execute: (input: Record<string, unknown>) => Promise<unknown>;
};

const originalFetch = global.fetch;
const originalSecret = process.env.INTERNAL_API_SECRET;

type FakeFs = Map<string, string>;

/** Emulates /api/sandbox/{id}/files: GET reads, PUT writes, POST lists. */
function serveSandboxFiles(fs: FakeFs, calls: string[] = []) {
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url.pathname}${url.search}`);
    if (!url.pathname.endsWith("/files")) {
      return Response.json({ error: "unexpected" }, { status: 500 });
    }
    if (method === "GET") {
      const path = url.searchParams.get("path") ?? "";
      const content = fs.get(path);
      if (content === undefined)
        return Response.json({ error: "File not found" }, { status: 404 });
      return Response.json({ path, content });
    }
    if (method === "PUT") {
      const body = JSON.parse(String(init?.body)) as {
        path: string;
        content: string;
      };
      fs.set(body.path, body.content);
      return Response.json({ ok: true });
    }
    const body = JSON.parse(String(init?.body)) as { path: string };
    const prefix = body.path === "." ? "" : `${body.path.replace(/\/$/, "")}/`;
    const entries = [...fs.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length))
      .filter(Boolean)
      .map((rest) => {
        const [name, ...more] = rest.split("/");
        return { name, isDir: more.length > 0, size: 3 };
      });
    return Response.json({ path: body.path, entries });
  }) as typeof fetch;
  return calls;
}

beforeEach(() => {
  process.env.INTERNAL_API_SECRET = "internal-secret";
});

afterEach(() => {
  global.fetch = originalFetch;
  if (originalSecret === undefined) delete process.env.INTERNAL_API_SECRET;
  else process.env.INTERNAL_API_SECRET = originalSecret;
});

describe("sandbox read_file", () => {
  it("reads from the selected sandbox with line numbers and a window", async () => {
    serveSandboxFiles(new Map([["src/a.ts", "one\ntwo\nthree\nfour\n"]]));
    const tool = createSandboxReadFile(
      "user-1",
      "sandbox-1"
    ) as unknown as Executable;
    await expect(
      tool.execute({ path: "src/a.ts", offset: 2, limit: 2 })
    ).resolves.toEqual({
      path: "src/a.ts",
      content: "2\ttwo\n3\tthree",
      startLine: 2,
      endLine: 3,
      totalLines: 4,
      truncated: true,
      sandboxId: "sandbox-1",
    });
  });

  it("reports a missing file instead of an HTTP status", async () => {
    serveSandboxFiles(new Map());
    const tool = createSandboxReadFile(
      "user-1",
      "sandbox-1"
    ) as unknown as Executable;
    await expect(tool.execute({ path: "nope.ts" })).resolves.toEqual({
      error: "File not found: nope.ts",
      reason: "file_not_found",
      path: "nope.ts",
    });
  });

  it("refuses to read while the sandbox is still starting", async () => {
    const tool = createSandboxReadFile("user-1", {
      sandboxId: null,
      status: "pending",
    }) as unknown as Executable;
    await expect(tool.execute({ path: "a.ts" })).resolves.toMatchObject({
      reason: "sandbox_pending",
    });
  });
});

describe("sandbox list_files", () => {
  it("lists a directory from the sandbox in the GitHub tool's shape", async () => {
    serveSandboxFiles(
      new Map([
        ["src/a.ts", "a"],
        ["src/lib/b.ts", "b"],
      ])
    );
    const tool = createSandboxListFiles(
      "user-1",
      "sandbox-1"
    ) as unknown as Executable;
    await expect(tool.execute({ path: "src" })).resolves.toEqual({
      path: "src",
      files: [
        { name: "a.ts", type: "file", size: 3 },
        { name: "lib", type: "dir", size: 3 },
      ],
      sandboxId: "sandbox-1",
    });
  });
});

describe("edit_file", () => {
  it("replaces a unique match and returns the diff", async () => {
    const fs: FakeFs = new Map([["src/a.ts", "const b = 2;\nconst c = 3;\n"]]);
    serveSandboxFiles(fs);
    const tool = createEditFile("user-1", "sandbox-1") as unknown as Executable;
    const result = (await tool.execute({
      path: "src/a.ts",
      old_string: "const b = 2;",
      new_string: "const b = 4;",
    })) as { ok: boolean; replacements: number; diff: string };
    expect(result.ok).toBe(true);
    expect(result.replacements).toBe(1);
    expect(result.diff).toContain("-const b = 2;");
    expect(result.diff).toContain("+const b = 4;");
    expect(fs.get("src/a.ts")).toBe("const b = 4;\nconst c = 3;\n");
  });

  it("rejects an ambiguous match unless replace_all is set", async () => {
    const fs: FakeFs = new Map([["a.ts", "x\nx\n"]]);
    serveSandboxFiles(fs);
    const tool = createEditFile("user-1", "sandbox-1") as unknown as Executable;
    await expect(
      tool.execute({ path: "a.ts", old_string: "x", new_string: "y" })
    ).resolves.toMatchObject({ reason: "ambiguous_match", matches: 2 });
    expect(fs.get("a.ts")).toBe("x\nx\n");

    await expect(
      tool.execute({
        path: "a.ts",
        old_string: "x",
        new_string: "y",
        replace_all: true,
      })
    ).resolves.toMatchObject({ ok: true, replacements: 2 });
    expect(fs.get("a.ts")).toBe("y\ny\n");
  });

  it("reports when the old text is not in the file", async () => {
    serveSandboxFiles(new Map([["a.ts", "hello\n"]]));
    const tool = createEditFile("user-1", "sandbox-1") as unknown as Executable;
    await expect(
      tool.execute({ path: "a.ts", old_string: "missing", new_string: "y" })
    ).resolves.toMatchObject({ reason: "no_match" });
  });

  it("refuses an edit that changes nothing", async () => {
    serveSandboxFiles(new Map([["a.ts", "hello\n"]]));
    const tool = createEditFile("user-1", "sandbox-1") as unknown as Executable;
    await expect(
      tool.execute({ path: "a.ts", old_string: "hello", new_string: "hello" })
    ).resolves.toMatchObject({ reason: "no_change" });
  });
});

describe("write_file", () => {
  it("returns a creation diff for a new file", async () => {
    const fs: FakeFs = new Map();
    serveSandboxFiles(fs);
    const tool = createWriteFile(
      "user-1",
      "sandbox-1"
    ) as unknown as Executable;
    const result = (await tool.execute({
      path: "src/new.ts",
      content: "export {};\n",
    })) as { ok: boolean; created: boolean; diff: string };
    expect(result.ok).toBe(true);
    expect(result.created).toBe(true);
    expect(result.diff).toContain("--- /dev/null");
    expect(fs.get("src/new.ts")).toBe("export {};\n");
  });

  it("returns a modification diff for an existing file", async () => {
    const fs: FakeFs = new Map([["a.ts", "old\n"]]);
    serveSandboxFiles(fs);
    const tool = createWriteFile(
      "user-1",
      "sandbox-1"
    ) as unknown as Executable;
    const result = (await tool.execute({
      path: "a.ts",
      content: "new\n",
    })) as { created: boolean; diff: string };
    expect(result.created).toBe(false);
    expect(result.diff).toContain("-old");
    expect(result.diff).toContain("+new");
  });

  it("still requires a selected sandbox", async () => {
    const tool = createWriteFile("user-1") as unknown as Executable;
    await expect(tool.execute({ path: "a.ts", content: "x" })).resolves.toEqual(
      {
        error: "Select a sandbox first.",
        reason: "sandbox_not_selected",
      }
    );
  });
});
