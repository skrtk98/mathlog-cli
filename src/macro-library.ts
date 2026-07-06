import fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { DEFAULT_MACRO_PRESET_FILE, MACROS_FILE_NAME } from "./paths.js";

export type MacroPackage = {
  id: string;
  name: string;
  enabled: boolean;
};

export type MathlogMacro = {
  id: string;
  command: string;
  args: number;
  body: string;
  packageId: string;
};

export type MacroLibrary = {
  version: 1;
  packages: MacroPackage[];
  macros: MathlogMacro[];
};

export function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeMacroCommand(value: unknown): string {
  const command = String(value || "").trim();
  if (!/^\\?[A-Za-z]+$/.test(command)) {
    throw new Error("Macro command must contain only letters, with an optional leading backslash.");
  }
  return command.startsWith("\\") ? command : `\\${command}`;
}

export function normalizeMacroArgs(value: unknown): number {
  const args = Number.parseInt(String(value ?? "0"), 10);
  if (!Number.isInteger(args) || args < 0 || args > 9) {
    throw new Error("Macro argument count must be an integer from 0 to 9.");
  }
  return args;
}

export function normalizeMacroPackageId(value: unknown): string {
  return String(value || "").trim();
}

export function normalizeMacroLibrary(raw: any = {}): MacroLibrary {
  const packages: MacroPackage[] = Array.isArray(raw.packages)
    ? raw.packages
        .map((item: any) => ({
          id: String(item?.id || "").trim(),
          name: String(item?.name || "").trim(),
          enabled: item?.enabled !== false,
        }))
        .filter((item: MacroPackage) => item.id && item.name)
    : [];
  const packageIds = new Set(packages.map((item) => item.id));
  const macros: MathlogMacro[] = Array.isArray(raw.macros)
    ? raw.macros
        .map((item: any) => {
          try {
            return {
              id: String(item?.id || "").trim(),
              command: normalizeMacroCommand(item?.command),
              args: normalizeMacroArgs(item?.args),
              body: String(item?.body || "").trim(),
              packageId: normalizeMacroPackageId(item?.packageId),
            };
          } catch {
            return null;
          }
        })
        .filter((item: MathlogMacro | null): item is MathlogMacro => Boolean(item && item.id && item.body && (!item.packageId || packageIds.has(item.packageId))))
    : [];
  return { version: 1, packages, macros };
}

export function getMacrosFilePath(): string {
  return path.join(process.cwd(), MACROS_FILE_NAME);
}

export async function readMacroLibrary(): Promise<MacroLibrary> {
  try {
    const raw = JSON.parse(await fsp.readFile(getMacrosFilePath(), "utf8"));
    return normalizeMacroLibrary(raw);
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return normalizeMacroLibrary();
    }
    throw error;
  }
}

export async function writeMacroLibrary(library: MacroLibrary): Promise<MacroLibrary> {
  const normalized = normalizeMacroLibrary(library);
  await fsp.writeFile(getMacrosFilePath(), `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

export async function readDefaultMacroPreset(): Promise<MacroLibrary> {
  const raw = JSON.parse(await fsp.readFile(DEFAULT_MACRO_PRESET_FILE, "utf8"));
  return normalizeMacroLibrary(raw);
}

export function mergeMacroLibrary(base: MacroLibrary, imported: MacroLibrary): MacroLibrary {
  const packages = [...base.packages];
  for (const pkg of imported.packages) {
    const existing = packages.find((item) => item.id === pkg.id);
    if (existing) {
      existing.name = pkg.name;
      existing.enabled = pkg.enabled;
    } else {
      packages.push({ ...pkg });
    }
  }

  const macros = [...base.macros];
  for (const macro of imported.macros) {
    const existingIndex = macros.findIndex((item) => item.command === macro.command);
    if (existingIndex === -1) {
      macros.push({ ...macro });
    } else {
      macros[existingIndex] = {
        ...macros[existingIndex],
        command: macro.command,
        args: macro.args,
        body: macro.body,
        packageId: macro.packageId,
      };
    }
  }

  return normalizeMacroLibrary({ version: 1, packages, macros });
}

export function buildActiveMathJaxMacros(library: MacroLibrary): Record<string, string | [string, number]> {
  const enabledPackageIds = new Set(library.packages.filter((item) => item.enabled).map((item) => item.id));
  const macros: Record<string, string | [string, number]> = {};
  for (const macro of library.macros) {
    if (macro.packageId && !enabledPackageIds.has(macro.packageId)) {
      continue;
    }
    const commandName = macro.command.replace(/^\\/, "");
    macros[commandName] = macro.args > 0 ? [macro.body, macro.args] : macro.body;
  }
  return macros;
}
