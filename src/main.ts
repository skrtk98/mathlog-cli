#!/usr/bin/env node

import { main } from "./preview-cli.js";

main().catch(async (error) => {
  const { printFatalError } = await import("./preview-cli.js");
  await printFatalError(error);
  process.exit(1);
});
