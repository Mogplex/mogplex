import { Bash } from "just-bash";

type VirtualExecResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  command: string;
};

export async function virtualExec(command: string): Promise<VirtualExecResult> {
  const bash = new Bash();

  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error("virtual_exec timed out after 5s")),
      5000
    );
  });

  try {
    const result = await Promise.race([bash.exec(command), timeoutPromise]);
    return {
      exitCode: result.exitCode,
      stdout: (result.stdout ?? "").slice(0, 10000),
      stderr: (result.stderr ?? "").slice(0, 5000),
      command,
    };
  } finally {
    clearTimeout(timeoutId!);
  }
}
