import path from "node:path";
import { fileURLToPath } from "node:url";

export const MAIN_FILE = fileURLToPath(import.meta.url);
export const SRC_DIR = path.dirname(MAIN_FILE);
export const DOCS_ROOT = path.resolve(SRC_DIR, "..");
export const DEFAULT_CONTENT_DIR = "public";
export const DEFAULT_HOST = "localhost";
export const DEFAULT_PORT = 3141;
export const CONFIG_FILE_NAME = "mathlog.config.json";
export const MACROS_FILE_NAME = "mathlog.macros.json";
export const DEFAULT_MACRO_PRESET_FILE = path.join(DOCS_ROOT, "presets", "mathlog-default-macros.json");
export const MATHJAX_DIST_DIR = path.join(DOCS_ROOT, "node_modules", "mathjax-full", "es5");
