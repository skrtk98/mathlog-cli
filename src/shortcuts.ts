import { exec, spawn } from "node:child_process";
import process from "node:process";

function printShortcutError(message: string): void {
  console.error("");
  console.error(`  ${message}`);
  console.error("");
}

function shellEscape(value: string): string {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function runDetachedShell(command: string, target: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const shellCommand = `${command} ${shellEscape(target)}`;
    const child = spawn("/bin/bash", ["-lc", shellCommand], {
      detached: true,
      stdio: "ignore",
    });

    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function execShellCommand(command: string, target: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const shellCommand = `${command} ${shellEscape(target)}`;
    const child = exec(shellCommand, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });

    child.once("error", reject);
  });
}

function resolveOpenCommand(): string {
  return process.env.MATHLOG_PREVIEW_OPENER || process.env.BROWSER || "xdg-open";
}

function resolveEditorCommand(): string {
  return (
    process.env.MATHLOG_PREVIEW_EDITOR ||
    process.env.VISUAL ||
    process.env.EDITOR ||
    (process.env.TERM_PROGRAM === "vscode" ? "code" : "") ||
    ""
  );
}

async function openPreview(url: string): Promise<void> {
  const normalizedUrl = url.replace("127.0.0.1", "localhost");
  await runDetachedShell(resolveOpenCommand(), normalizedUrl);
}

async function openEditor(inputFile: string): Promise<void> {
  const editorCommand = resolveEditorCommand();
  if (!editorCommand) {
    throw new Error("No editor configured. Set MATHLOG_PREVIEW_EDITOR, VISUAL, or EDITOR.");
  }
  await execShellCommand(editorCommand, inputFile);
}

export type ShortcutBinding = {
  interactive: boolean;
  dispose(): void;
};

export function bindServeShortcuts({
  contentRoot,
  url,
  onQuit,
  onRestart,
}: {
  contentRoot: string;
  url: string;
  onQuit(): Promise<void>;
  onRestart(): Promise<void>;
}): ShortcutBinding {
  const forceShortcuts = process.env.MATHLOG_PREVIEW_FORCE_SHORTCUTS === "1";
  if (!process.stdin.isTTY && !forceShortcuts) {
    return {
      interactive: false,
      dispose() {},
    };
  }

  const previousRawMode = Boolean(process.stdin.isRaw);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  process.stdin.setRawMode?.(true);

  let disposed = false;
  let running = Promise.resolve();

  const runShortcut = (action: () => Promise<void>) => {
    running = running
      .catch(() => {})
      .then(action)
      .catch((error) => {
        printShortcutError(`shortcut failed: ${error.message}`);
      });
  };

  const handleShortcut = (str: string) => {
    if (disposed) {
      return;
    }
    if (str === "\u0003") {
      runShortcut(onQuit);
      return;
    }

    switch (str) {
      case "r":
        runShortcut(onRestart);
        break;
      case "o":
        runShortcut(async () => {
          await openPreview(url);
        });
        break;
      case "e":
        runShortcut(async () => {
          await openEditor(contentRoot);
        });
        break;
      case "q":
        runShortcut(onQuit);
        break;
      default:
        break;
    }
  };

  const onData = (chunk: string | Buffer) => {
    for (const char of String(chunk)) {
      handleShortcut(char);
    }
  };

  process.stdin.on("data", onData);

  return {
    interactive: true,
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      process.stdin.off("data", onData);
      process.stdin.setRawMode?.(previousRawMode);
      process.stdin.pause();
    },
  };
}
