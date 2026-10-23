/**
 * `vouch run` runtime enforcement (preview).
 *
 * The preload is plain JavaScript held as strings so it ships inside the CLI
 * bundle without extra build entries: `prepareRuntime()` writes it to a cache
 * directory and returns the Node flags that load it. Three files:
 *
 * - preload.cjs   (`--require`)  patches Module._load and globalThis.fetch
 * - register.mjs  (`--import`)   calls module.register() with hooks.mjs
 * - hooks.mjs                    ESM resolve hook for `import 'node:x'`
 *
 * Both paths share COMMON: map a builtin to a capability, find the package that
 * asked for it from the importer's path under node_modules, and compare against
 * the approved capabilities in vouch.lock.json (VOUCH_LOCK). App code outside
 * node_modules is always allowed. VOUCH_MODE=block throws, anything else warns.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CapabilityId } from '../types.js';

/** Builtins the runtime guards, and the manifest capability each one needs. */
export const BUILTIN_CAPABILITIES: Record<string, CapabilityId> = {
  net: 'network',
  http: 'network',
  https: 'network',
  http2: 'network',
  dns: 'network',
  tls: 'network',
  dgram: 'network',
  child_process: 'child_process',
  worker_threads: 'child_process',
  fs: 'filesystem',
  vm: 'eval',
};

const COMMON = String.raw`
var CAPS = ${JSON.stringify(BUILTIN_CAPABILITIES)};
var fsMod = require('fs');
var MODE = process.env.VOUCH_MODE === 'block' ? 'block' : 'warn';
var manifest = null;
function loadManifest() {
  if (manifest) return manifest;
  manifest = { packages: {} };
  var p = process.env.VOUCH_LOCK;
  if (p) {
    try { manifest = JSON.parse(fsMod.readFileSync(p, 'utf8')); } catch (e) { manifest = { packages: {} }; }
  }
  if (!manifest || typeof manifest.packages !== 'object') manifest = { packages: {} };
  return manifest;
}
function builtinName(spec) {
  if (typeof spec !== 'string') return null;
  var s = spec.indexOf('node:') === 0 ? spec.slice(5) : spec;
  var slash = s.indexOf('/');
  if (slash > 0) s = s.slice(0, slash);
  return Object.prototype.hasOwnProperty.call(CAPS, s) ? s : null;
}
function packageOf(file) {
  if (!file) return null;
  var parts = String(file).replace(/\\/g, '/').split('/');
  var i = parts.lastIndexOf('node_modules');
  if (i < 0 || i + 1 >= parts.length) return null;
  var name = parts[i + 1];
  if (name.charAt(0) === '@' && i + 2 < parts.length) name = name + '/' + parts[i + 2];
  return name || null;
}
var warned = {};
function check(builtin, file, via) {
  var pkg = packageOf(file);
  if (!pkg) return null;
  var cap = CAPS[builtin];
  var entry = loadManifest().packages[pkg];
  var approved = entry && Array.isArray(entry.capabilities) ? entry.capabilities : [];
  if (approved.indexOf(cap) >= 0) return null;
  var msg = 'vouch: package "' + pkg + '" ' + via + ' "' + builtin + '" (capability ' + cap + '), which vouch.lock.json does not approve' +
    (entry ? ' (approved: ' + (approved.join(', ') || 'none') + ')' : ' (package not in vouch.lock.json)') +
    '. Review it, then run "vouch approve ' + pkg + '".';
  if (MODE === 'block') {
    var err = new Error(msg);
    err.name = 'VouchPermissionError';
    err.code = 'ERR_VOUCH_PERMISSION';
    err.vouch = { package: pkg, builtin: builtin, capability: cap };
    return err;
  }
  var key = pkg + '|' + builtin;
  if (!warned[key]) {
    warned[key] = true;
    try { process.stderr.write('[vouch warn] ' + msg + '\n'); } catch (e) {}
  }
  return null;
}
`;

const PRELOAD_CJS = String.raw`'use strict';
(function () {
  if (global.__vouchRuntime) return;
  global.__vouchRuntime = true;
  ${COMMON}
  var Module = require('module');
  var origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    var b = builtinName(request);
    if (b && parent && parent.filename) {
      var err = check(b, parent.filename, 'required');
      if (err) {
        Error.captureStackTrace && Error.captureStackTrace(err, Module._load);
        throw err;
      }
    }
    return origLoad.apply(this, arguments);
  };
  if (typeof globalThis.fetch === 'function') {
    var origFetch = globalThis.fetch;
    var fetchWarned = {};
    var patched = function fetch() {
      try {
        var stack = String(new Error().stack || '').split('\n').slice(2);
        for (var i = 0; i < stack.length; i++) {
          var m = /\(?((?:file:\/\/)?[^()\s]*node_modules[^()\s]*?)(?::\d+){1,2}\)?\s*$/.exec(stack[i]);
          if (!m) continue;
          var file = m[1].indexOf('file://') === 0 ? require('url').fileURLToPath(m[1]) : m[1];
          var pkg = packageOf(file);
          if (!pkg) continue;
          var entry = loadManifest().packages[pkg];
          var approved = entry && Array.isArray(entry.capabilities) ? entry.capabilities : [];
          if (approved.indexOf('network') < 0 && !fetchWarned[pkg]) {
            fetchWarned[pkg] = true;
            process.stderr.write('[vouch warn] vouch: package "' + pkg + '" called fetch() (capability network), which vouch.lock.json does not approve. fetch() is checked best effort and never blocked.\n');
          }
          break;
        }
      } catch (e) {}
      return origFetch.apply(this, arguments);
    };
    try { globalThis.fetch = patched; } catch (e) {}
  }
})();
`;

const HOOKS_MJS = String.raw`import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
${COMMON}
export async function resolve(specifier, context, next) {
  const b = builtinName(specifier);
  if (b && context.parentURL && context.parentURL.startsWith('file:')) {
    let file;
    try { file = fileURLToPath(context.parentURL); } catch { file = null; }
    const err = file && check(b, file, 'imported');
    if (err) throw err;
  }
  return next(specifier, context);
}
`;

const REGISTER_MJS = String.raw`import * as mod from 'node:module';
if (typeof mod.register === 'function') mod.register('./hooks.mjs', import.meta.url);
`;

export interface RuntimeFiles {
  dir: string;
  preload: string;
  register: string;
  hooks: string;
}

/** Writes the preload files (once per content hash) and returns their paths. */
export function prepareRuntime(baseDir: string = join(tmpdir(), 'vouch-runtime')): RuntimeFiles {
  const hash = createHash('sha256').update(PRELOAD_CJS).update(HOOKS_MJS).update(REGISTER_MJS).digest('hex').slice(0, 12);
  const dir = join(baseDir, hash);
  mkdirSync(dir, { recursive: true });
  const files = { preload: join(dir, 'preload.cjs'), register: join(dir, 'register.mjs'), hooks: join(dir, 'hooks.mjs') };
  const contents: Record<string, string> = { [files.preload]: PRELOAD_CJS, [files.register]: REGISTER_MJS, [files.hooks]: HOOKS_MJS };
  for (const [path, body] of Object.entries(contents)) {
    if (!existsSync(path) || readFileSync(path, 'utf8') !== body) writeFileSync(path, body);
  }
  return { dir, ...files };
}

/** Node flags that load the runtime: `--require` for CJS, `--import` for the ESM hooks. */
export function runtimeNodeFlags(f: RuntimeFiles): string[] {
  return ['--require', f.preload, '--import', pathToFileURL(f.register).href];
}

export type RunMode = 'warn' | 'block';

/** Environment for a child process run under vouch: NODE_OPTIONS carries the flags so `npm start` etc. work too. */
export function runtimeEnv(f: RuntimeFiles, lockPath: string, mode: RunMode, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const q = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const flags = `--require ${q(f.preload)} --import ${q(pathToFileURL(f.register).href)}`;
  return {
    ...base,
    VOUCH_LOCK: lockPath,
    VOUCH_MODE: mode,
    NODE_OPTIONS: [base.NODE_OPTIONS, flags].filter(Boolean).join(' '),
  };
}
