import { resolveSandboxPath } from "@/lib/repo-settings";
import type { Sandbox } from "@vercel/sandbox";
import type { RuntimeStrategy } from "./types";

async function readTextFile(sandbox: Sandbox, path: string) {
  const buffer = await sandbox.readFileToBuffer({ path });
  return buffer ? buffer.toString("utf-8") : "";
}

/** Priority-ordered lockfile → package manager mapping. */
const PM_DETECTION = [
  { file: "uv.lock", pm: "uv" },
  { file: "poetry.lock", pm: "poetry" },
  { file: "Pipfile", pm: "pipenv" },
  { file: "pyproject.toml", pm: "pip" },
  { file: "requirements.txt", pm: "pip" },
] as const;

/** Known Python web frameworks → dev command templates. */
const FRAMEWORK_MAP: Readonly<
  Record<string, { name: string; command: string; port: number }>
> = {
  fastapi: {
    name: "FastAPI",
    command: "uvicorn {entry}:app --reload --host 0.0.0.0 --port 8000",
    port: 8000,
  },
  uvicorn: {
    name: "FastAPI",
    command: "uvicorn {entry}:app --reload --host 0.0.0.0 --port 8000",
    port: 8000,
  },
  flask: {
    name: "Flask",
    command: "flask run --host=0.0.0.0 --port 5000",
    port: 5000,
  },
  django: {
    name: "Django",
    command: "python manage.py runserver 0.0.0.0:8000",
    port: 8000,
  },
  streamlit: {
    name: "Streamlit",
    command: "streamlit run app.py --server.port 8501 --server.address 0.0.0.0",
    port: 8501,
  },
};

export const pythonStrategy: RuntimeStrategy = {
  id: "python3.13",
  name: "Python 3.13",
  defaultPort: 8000,
  defaultPorts: [8000, 5000, 8501],

  async detect(sandbox, rootDir) {
    for (const { file, pm } of PM_DETECTION) {
      const exists = await sandbox.readFile({
        path: resolveSandboxPath(rootDir, file),
      });
      if (exists) {
        const { framework, entry } = await detectPythonFramework(
          sandbox,
          rootDir
        );
        return {
          runtime: "python3.13",
          packageManager: pm,
          framework,
          frameworkEntry: entry,
        };
      }
    }
    return null;
  },

  buildInstallCommand(pm) {
    switch (pm) {
      case "uv":
        return "uv sync";
      case "poetry":
        return "poetry install";
      case "pipenv":
        return "pipenv install";
      default:
        return "pip install -r requirements.txt";
    }
  },

  buildDevCommand(_pm, framework, frameworkEntry) {
    if (!framework) return "python -m http.server 8000";
    const match = FRAMEWORK_MAP[framework];
    if (!match) return "python -m http.server 8000";
    return match.command.replace("{entry}", frameworkEntry || "main");
  },
};

async function detectPythonFramework(
  sandbox: Sandbox,
  rootDir?: string | null
): Promise<{ framework?: string; entry?: string }> {
  const sources: string[] = [];

  try {
    const req = await readTextFile(
      sandbox,
      resolveSandboxPath(rootDir, "requirements.txt")
    );
    if (req) sources.push(req);
  } catch {
    /* missing */
  }

  try {
    const pyproject = await readTextFile(
      sandbox,
      resolveSandboxPath(rootDir, "pyproject.toml")
    );
    if (pyproject) sources.push(pyproject);
  } catch {
    /* missing */
  }

  const combined = sources.join("\n").toLowerCase();

  for (const key of ["fastapi", "uvicorn", "flask", "django", "streamlit"]) {
    if (combined.includes(key)) {
      let entry: string | undefined;
      if (key === "fastapi" || key === "uvicorn") {
        entry = await resolveFastApiEntry(sandbox, rootDir);
      }
      return { framework: key, entry };
    }
  }

  return {};
}

/** Scan common locations for `app = FastAPI()` to resolve the module path. */
async function resolveFastApiEntry(
  sandbox: Sandbox,
  rootDir?: string | null
): Promise<string> {
  const candidates = ["main.py", "app.py", "src/main.py", "app/main.py"];

  for (const candidate of candidates) {
    try {
      const content = await readTextFile(
        sandbox,
        resolveSandboxPath(rootDir, candidate)
      );
      if (!content) continue;
      // Check non-comment lines for common FastAPI app variable patterns
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("#")) continue;
        if (/^(app|api|application)\s*=\s*FastAPI\s*\(/.test(trimmed)) {
          return candidate.replace(/\.py$/, "").replace(/\//g, ".");
        }
      }
    } catch {
      /* missing */
    }
  }

  return "main";
}
