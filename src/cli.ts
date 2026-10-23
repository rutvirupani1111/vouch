#!/usr/bin/env node
import { main } from './cli/main.js';

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(`vouch: ${(err as Error)?.message ?? String(err)}\n`);
    process.exitCode = 2;
  },
);
