import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { main } from '../src/cli/main.js';
import { prepareRuntime, runtimeEnv, runtimeNodeFlags, type RuntimeFiles } from '../src/runtime/preload.js';
import { tempDir } from './helpers.js';

let tmp: ReturnType<typeof tempDir>;
let rt: RuntimeFiles;

function write(rel: string, body: string) {
  const p = join(tmp.dir, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, body);
}

function runNode(entry: string, mode: 'warn' | 'block') {
  const env = { ...process.env, VOUCH_LOCK: join(tmp.dir, 'vouch.lock.json'), VOUCH_MODE: mode, NODE_OPTIONS: '' };
  const r = spawnSync(process.execPath, [...runtimeNodeFlags(rt), entry], { cwd: tmp.dir, env, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

beforeAll(() => {
  tmp = tempDir('runtime');
  rt = prepareRuntime(join(tmp.dir, '.runtime'));
  writeFileSync(
    join(tmp.dir, 'vouch.lock.json'),
    JSON.stringify({
      vouch: 1,
      packages: {
        'good-net': { versions: ['1.0.0'], capabilities: ['network'], installScripts: {}, risk: 0 },
        'bad-spawn': { versions: ['1.0.0'], capabilities: ['filesystem'], installScripts: {}, risk: 0 },
        '@scope/esm-bad': { versions: ['1.0.0'], capabilities: [], installScripts: {}, risk: 0 },
      },
    }),
  );
  write('node_modules/good-net/index.js', "require('node:http'); module.exports = 'good';\n");
  write('node_modules/bad-spawn/index.js', "require('child_process'); module.exports = 'bad';\n");
  write('node_modules/bad-spawn/fetcher.js', "module.exports = () => fetch('http://127.0.0.1:9/').catch(() => {});\n");
  write('node_modules/@scope/esm-bad/package.json', JSON.stringify({ name: '@scope/esm-bad', type: 'module', main: 'index.js' }));
  write('node_modules/@scope/esm-bad/index.js', "import 'node:child_process';\nexport default 'esm';\n");
  write(
    'app.cjs',
    [
      "require('child_process');",
      "console.log('app ok');",
      "console.log(require('good-net'));",
      "try { console.log(require('bad-spawn')); } catch (e) { console.log('caught ' + e.name + ' ' + e.code); console.error(e.message); }",
      "require('bad-spawn/fetcher')();",
    ].join('\n'),
  );
  write('strict.cjs', "require('bad-spawn');\nconsole.log('unreachable in block mode');\n");
  write('app.mjs', "import 'node:child_process';\nconsole.log('app ok');\nconst m = await import('@scope/esm-bad');\nconsole.log(m.default);\n");
});

afterAll(() => tmp.cleanup());

describe('vouch run runtime', () => {
  it('block mode: approved package works, unapproved one throws VouchPermissionError, app code is free', () => {
    const r = runNode('app.cjs', 'block');
    expect(r.out).toContain('app ok');
    expect(r.out).toContain('good');
    expect(r.out).toContain('caught VouchPermissionError ERR_VOUCH_PERMISSION');
    expect(r.err).toContain('package "bad-spawn" required "child_process" (capability child_process)');
    expect(r.err).toContain('approved: filesystem');
  });

  it('warn mode: everything runs, a warning is printed once per package and builtin', () => {
    const r = runNode('app.cjs', 'warn');
    expect(r.code).toBe(0);
    expect(r.out).toContain('bad');
    expect(r.out).not.toContain('caught');
    expect(r.err.match(/\[vouch warn\].*bad-spawn" required "child_process/g)?.length).toBe(1);
    expect(r.err).not.toContain('good-net');
  });

  it('warns (never blocks) when a package without network calls fetch()', () => {
    const r = runNode('app.cjs', 'block');
    expect(r.err).toContain('package "bad-spawn" called fetch() (capability network)');
  });

  it('ESM: a scoped package importing node:child_process is blocked, app import is allowed', () => {
    const r = runNode('app.mjs', 'block');
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('app ok');
    expect(r.out).not.toContain('esm');
    expect(r.err).toContain('package "@scope/esm-bad" imported "child_process"');
    expect(r.err).toContain('VouchPermissionError');
  });

  it('ESM warn mode lets the import through with a warning', () => {
    const r = runNode('app.mjs', 'warn');
    expect(r.code).toBe(0);
    expect(r.out).toContain('esm');
    expect(r.err).toContain('[vouch warn]');
  });

  it('runtimeEnv carries the flags through NODE_OPTIONS', () => {
    const lock = join(tmp.dir, 'vouch.lock.json');
    const env = runtimeEnv(rt, lock, 'block', { PATH: process.env.PATH ?? '' });
    const r = spawnSync(process.execPath, ['app.cjs'], { cwd: tmp.dir, env, encoding: 'utf8' });
    expect(env.VOUCH_MODE).toBe('block');
    expect(r.stdout).toContain('caught VouchPermissionError');
  });

  it('vouch run: the CLI exits non-zero in block mode and 0 in warn mode', async () => {
    let err = '';
    const io = { out: () => {}, err: (s: string) => (err += s), cwd: tmp.dir };
    expect(await main(['run', '--mode', 'block', '--', 'node', 'strict.cjs'], io)).not.toBe(0);
    expect(await main(['run', '--', 'node', 'strict.cjs'], io)).toBe(0);
    expect(await main(['run', '--mode', 'nope', '--', 'node', 'strict.cjs'], io)).toBe(2);
    expect(err).toContain('unknown --mode nope');
    expect(await main(['run', '--dir', 'node_modules', '--', 'node', 'strict.cjs'], io)).toBe(2);
    expect(err).toContain('vouch.lock.json not found');
    expect(await main(['run'], io)).toBe(2);
  });
});
