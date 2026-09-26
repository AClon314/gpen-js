/** 宿主提供的命令执行器（通常是 child_process.execFile）。 */
export type ShellCommandRunner = (
  command: string,
  args: readonly string[],
) => void | PromiseLike<void>;

/** 目标平台的命令方言。 */
export type SymlinkPlatform = "posix" | "windows";

/** 建符号链接的选项（执行器 + 平台）。 */
export interface SymlinkOptions {
  /** Host-provided command runner, usually backed by child_process.execFile. */
  run?: ShellCommandRunner;
  platform?: SymlinkPlatform;
}

function runningOnWindows(): boolean {
  return typeof process !== "undefined" && process.platform === "win32";
}

/** 按平台给出建符号链接的命令与参数。 */
export function symlinkCommand(
  target: string,
  linkPath: string,
  platform: SymlinkPlatform = runningOnWindows() ? "windows" : "posix",
): { command: string; args: readonly string[] } {
  if (!target) throw new TypeError("A symlink target is required");
  if (!linkPath) throw new TypeError("A symlink path is required");

  return platform === "windows"
    ? { command: "cmd", args: ["/c", "mklink", linkPath, target] }
    : { command: "ln", args: ["-s", target, linkPath] };
}

/**
 * Create a symbolic link through a host-provided shell runner. Keeping the
 * runner injectable lets the same package work in browser, VS Code web/ssh,
 * and desktop extension hosts without importing Node's child_process module
 * into browser bundles.
 */
export async function createSymlink(
  target: string,
  linkPath: string,
  options: SymlinkOptions = {},
): Promise<void> {
  if (!options.run) {
    throw new Error("A shell command runner is required to create a symlink");
  }
  const { command, args } = symlinkCommand(target, linkPath, options.platform);
  await options.run(command, args);
}
