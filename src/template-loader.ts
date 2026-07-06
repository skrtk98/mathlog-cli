import fsp from "node:fs/promises";
import path from "node:path";
import { DOCS_ROOT } from "./paths.js";

const templateCache = new Map<string, Promise<string>>();

export function loadTemplate(name: string): Promise<string> {
  if (!templateCache.has(name)) {
    templateCache.set(name, fsp.readFile(path.join(DOCS_ROOT, "src", "templates", name), "utf8"));
  }
  return templateCache.get(name)!;
}
