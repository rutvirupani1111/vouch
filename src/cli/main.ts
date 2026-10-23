import { spawn } from 'node:child_process';
import { basename, join, resolve } from 'node:path';
import { analyzeLocked } from '../analyze.js';
import { makeUi, renderCheck, renderReport, type Ui } from '../format.js';
import {
  MANIFEST_FILE,
  approve,
  checkManifest,
  initManifest,
  lockedPackages,
  readManifest,
  resolveLockfile,
  writeManifest,
} from '../manifest.js';
import { reportPackage } from '../report.js';
import { prepareRuntime, runtimeEnv, type RunMode } from '../runtime/preload.js';
import type { FetchLike } from '../types.js';

export const VERSION = '0.1.0';

const HELP = `vouch ${VERSION}: know an npm package is safe before you install it

Usage
  vouch report <pkg>[@version]   what it can do, provenance, source match, trust score
  vouch init                     analyse every lockfile package, write vouch.lock.json
  vouch check                    fail (exit 1) on new packages or newly gained capabilities
  vouch approve <pkg>[@version]  accept the current capabilities of a package
  vouch run [--mode warn|block] -- <cmd>   run Node with runtime capability enforcement (preview)

Options
  --json                    machine-readable output (report, check)
  --format pretty|json|markdown   output format for check (default pretty)
  --dir <path>              project directory (default .)
  --lockfile <path>         lockfile to read (default: autodetect)
  --cache-dir <path>        cache directory (default: OS cache dir, or VOUCH_CACHE_DIR)
  --concurrency <n>         parallel downloads (default 8)
  --mode warn|block         vouch run: warn (default) or throw VouchPermissionError
  -h, --help / -v, --version

Environment
  GITHUB_TOKEN              raises GitHub rate limits for source downloads
  NO_COLOR / FORCE_COLOR    colour control

Exit codes: 0 ok, 1 policy failure or low grade (report: F), 2 usage or runtime error.`;

export interface CliIo {
  out(s: string): void;
  err(s: string): void;
  ui?: Ui;
  fetch?: FetchLike;
  cwd?: string;
}

interface Parsed {
  cmd?: string;
  args: string[];
  flags: Record<string, string | boolean>;
}

const VALUE_FLAGS = new Set(['format', 'dir', 'lockfile', 'cache-dir', 'concurrency', 'mode']);

export function parseArgs(argv: string[]): Parsed {
  const p: Parsed = { args: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '-h') p.flags.help = true;
    else if (a === '-v') p.flags.version = true;
    else if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=', 2) as [string, string | undefined];
      if (VALUE_FLAGS.has(k)) {
        const val = v ?? argv[++i];
        if (val === undefined) throw new UsageError(`--${k} needs a value`);
        p.flags[k] = val;
      } else p.flags[k] = true;
    } else if (!p.cmd) p.cmd = a;
    else p.args.push(a);
  }
  return p;
}

class UsageError extends Error {}

/** `name`, `name@1.2.3`, `@scope/name@^1` */
export function parseSpec(s: string): { name: string; version: string } {
  const at = s.lastIndexOf('@');
  if (at > 0) return { name: s.slice(0, at), version: s.slice(at + 1) || 'latest' };
  return { name: s, version: 'latest' };
}

export async function main(argv: string[], io: CliIo = defaultIo()): Promise<number> {
  let p: Parsed;
  const dashdash = argv.indexOf('--');
  const command = dashdash >= 0 ? argv.slice(dashdash + 1) : [];
  if (dashdash >= 0) argv = argv.slice(0, dashdash);
  try {
    p = parseArgs(argv);
  } catch (err) {
    io.err(`vouch: ${(err as Error).message}\n`);
    return 2;
  }
  if (p.flags.version) {
    io.out(`${VERSION}\n`);
    return 0;
  }
  if (p.flags.help || !p.cmd || p.cmd === 'help') {
    io.out(HELP + '\n');
    return p.cmd || p.flags.help ? 0 : 2;
  }
  const ui = io.ui ?? makeUi();
  const dir = resolve(io.cwd ?? process.cwd(), String(p.flags.dir ?? '.'));
  const opts = {
    cacheDir: typeof p.flags['cache-dir'] === 'string' ? p.flags['cache-dir'] : undefined,
    fetch: io.fetch,
    githubToken: process.env.GITHUB_TOKEN,
    concurrency: Number(p.flags.concurrency ?? 8) || 8,
  };
  const manifestPath = join(dir, MANIFEST_FILE);
  const lockfile = () => resolveLockfile(dir, typeof p.flags.lockfile === 'string' ? resolve(dir, p.flags.lockfile) : undefined);
  const progress = (done: number, total: number, name: string) => {
    if (process.stderr.isTTY && !io.fetch) process.stderr.write(`\r\u001b[2K  analysing ${done}/${total} ${name}`);
    if (done === total && process.stderr.isTTY && !io.fetch) process.stderr.write('\r\u001b[2K');
  };

  try {
    switch (p.cmd) {
      case 'report': {
        const target = p.args[0];
        if (!target) throw new UsageError('report needs a package, e.g. vouch report chalk');
        const r = await reportPackage(parseSpec(target), opts);
        io.out(p.flags.json ? JSON.stringify(r, null, 2) + '\n' : renderReport(r, ui) + '\n');
        return r.grade === 'F' ? 1 : 0;
      }
      case 'init': {
        const pkgs = lockedPackages(lockfile());
        const { manifest, errors } = await initManifest(pkgs, { ...opts, onProgress: progress });
        writeManifest(manifestPath, manifest);
        const n = Object.keys(manifest.packages).length;
        io.out(`  ${ui.s.green(ui.u ? '✔' : '+')} wrote ${MANIFEST_FILE}: ${n} packages approved as they are today\n`);
        for (const e of errors) io.err(`  could not analyse ${e.name}@${e.version}: ${e.message}\n`);
        return errors.length ? 2 : 0;
      }
      case 'check': {
        const manifest = readManifest(manifestPath);
        if (!manifest) throw new UsageError(`${MANIFEST_FILE} not found in ${dir}; run vouch init first`);
        const format = p.flags.json ? 'json' : String(p.flags.format ?? 'pretty');
        if (format !== 'pretty' && format !== 'json' && format !== 'markdown') throw new UsageError(`unknown --format ${format}`);
        const r = await checkManifest(manifest, lockedPackages(lockfile()), { ...opts, onProgress: progress });
        io.out(renderCheck(r, format, ui));
        return r.violations.length ? 1 : r.errors.length ? 2 : 0;
      }
      case 'approve': {
        if (p.args.length === 0) throw new UsageError('approve needs a package, e.g. vouch approve chalk');
        const manifest = readManifest(manifestPath);
        if (!manifest) throw new UsageError(`${MANIFEST_FILE} not found in ${dir}; run vouch init first`);
        let locked: ReturnType<typeof lockedPackages> = [];
        try {
          locked = lockedPackages(lockfile());
        } catch {
          /* approving by explicit spec works without a lockfile */
        }
        for (const arg of p.args) {
          const spec = parseSpec(arg);
          const targets = locked.filter((l) => l.name === spec.name && (spec.version === 'latest' || l.version === spec.version));
          if (targets.length === 0) targets.push(spec);
          for (const t of targets) {
            const a = await analyzeLocked(t, opts);
            approve(manifest, a);
            io.out(`  ${ui.s.green(ui.u ? '✔' : '+')} approved ${a.name}@${a.version}: ${a.capabilities.map((c) => c.id).join(', ') || 'no capabilities'}\n`);
          }
        }
        writeManifest(manifestPath, manifest);
        return 0;
      }
      case 'run': {
        const cmd = [...p.args, ...command];
        if (cmd.length === 0) throw new UsageError('run needs a command, e.g. vouch run -- node app.js');
        const mode = String(p.flags.mode ?? 'warn');
        if (mode !== 'warn' && mode !== 'block') throw new UsageError(`unknown --mode ${mode} (warn or block)`);
        if (!readManifest(manifestPath)) throw new UsageError(`${MANIFEST_FILE} not found in ${dir}; run vouch init first`);
        return await runEnforced(cmd, runtimeEnv(prepareRuntime(), manifestPath, mode as RunMode), dir);
      }
      default:
        throw new UsageError(`unknown command "${p.cmd}"; see vouch --help`);
    }
  } catch (err) {
    io.err(`vouch: ${(err as Error).message}\n`);
    return 2;
  }
}

/** Spawns the command with the runtime preload in NODE_OPTIONS; resolves with its exit code. */
function runEnforced(cmd: string[], env: NodeJS.ProcessEnv, cwd: string): Promise<number> {
  const [bin, ...rest] = cmd as [string, ...string[]];
  const exe = /^node(\.exe)?$/i.test(basename(bin)) ? process.execPath : bin;
  return new Promise((done) => {
    const child = spawn(exe, rest, { stdio: 'inherit', env, cwd, shell: exe !== process.execPath && process.platform === 'win32' });
    child.on('error', (err) => {
      process.stderr.write(`vouch: could not start ${bin}: ${err.message}
`);
      done(2);
    });
    child.on('exit', (code, signal) => done(code ?? (signal ? 1 : 0)));
  });
}

function defaultIo(): CliIo {
  return { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) };
}
