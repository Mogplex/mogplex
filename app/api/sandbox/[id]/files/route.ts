import { NextResponse } from "next/server";
import { resolveSandboxPath } from "@/lib/repo-settings";
import { touchSandboxLastActive } from "@/lib/sandbox/records";
import {
  buildSandboxRouteErrorResponse,
  loadOwnedSandboxRouteContext,
} from "@/lib/sandbox/route-context";

const FILES_ROUTE_SELECT =
  "sandbox_id, root_directory, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id, repo:repos(root_directory)";

/** Read a file from the sandbox */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const path = searchParams.get("path");
  if (!path)
    return NextResponse.json({ error: "path required" }, { status: 400 });

  try {
    const sandboxData = await loadOwnedSandboxRouteContext(request, id, {
      select: FILES_ROUTE_SELECT,
    });
    if (!sandboxData.ok) return buildSandboxRouteErrorResponse(sandboxData);
    if (!sandboxData.sandbox) {
      return NextResponse.json(
        { error: "Sandbox is not ready" },
        { status: 409 }
      );
    }

    const buffer = await sandboxData.sandbox.readFileToBuffer({
      path: resolveSandboxPath(sandboxData.rootDirectory, path),
    });
    if (!buffer)
      return NextResponse.json({ error: "File not found" }, { status: 404 });

    await touchSandboxLastActive(id);

    return NextResponse.json({ path, content: buffer.toString("utf-8") });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Read failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Write a file to the sandbox */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { path, content } = await request.json();
  if (!path || content === undefined) {
    return NextResponse.json(
      { error: "path and content required" },
      { status: 400 }
    );
  }

  try {
    const sandboxData = await loadOwnedSandboxRouteContext(request, id, {
      select: FILES_ROUTE_SELECT,
      requireCapability: "tools.write_file",
    });
    if (!sandboxData.ok) return buildSandboxRouteErrorResponse(sandboxData);
    if (!sandboxData.sandbox) {
      return NextResponse.json(
        { error: "Sandbox is not ready" },
        { status: 409 }
      );
    }

    await sandboxData.sandbox.writeFiles([
      {
        path: resolveSandboxPath(sandboxData.rootDirectory, path),
        content: Buffer.from(content),
      },
    ]);

    await touchSandboxLastActive(id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Write failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** List directory contents */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { path = "." } = await request.json();

  try {
    // Directory listing runs `ls` inside the sandbox via runCommand, which
    // is the bash channel — gate the same way as exec.
    const sandboxData = await loadOwnedSandboxRouteContext(request, id, {
      select: FILES_ROUTE_SELECT,
      requireCapability: "tools.bash",
    });
    if (!sandboxData.ok) return buildSandboxRouteErrorResponse(sandboxData);
    if (!sandboxData.sandbox) {
      return NextResponse.json(
        { error: "Sandbox is not ready" },
        { status: 409 }
      );
    }

    const targetPath = resolveSandboxPath(sandboxData.rootDirectory, path);
    const result = await sandboxData.sandbox.runCommand({
      cmd: "ls",
      args: ["-la", "--group-directories-first", targetPath],
    });
    const stdout = await result.stdout();

    const lines = stdout.trim().split("\n").slice(1);
    const entries = lines
      .filter((line) => line.trim())
      .map((line) => {
        const parts = line.split(/\s+/);
        const isDir = parts[0]?.startsWith("d") || false;
        const name = parts.slice(8).join(" ");
        if (name === "." || name === "..") return null;
        return { name, isDir, size: Number.parseInt(parts[4] || "0", 10) };
      })
      .filter(Boolean);

    await touchSandboxLastActive(id);

    return NextResponse.json({ path, entries });
  } catch (err) {
    const message = err instanceof Error ? err.message : "List failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
