#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const keepArtifacts = process.env.HEADLESS_CODER_KEEP_SMOKE_TMP === '1';
const packages = [
  { name: '@headless-coder-sdk/core', dir: 'packages/core' },
  { name: '@headless-coder-sdk/codex-adapter', dir: 'packages/codex-adapter' },
  { name: '@headless-coder-sdk/claude-adapter', dir: 'packages/claude-adapter' },
  { name: '@headless-coder-sdk/gemini-adapter', dir: 'packages/gemini-adapter' },
];

function run(command, args, { cwd = rootDir, capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    encoding: capture ? 'utf8' : undefined,
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
  return capture ? result.stdout : '';
}

function packWorkspace(pkg, packsDir) {
  const workspacePath = `./${pkg.dir}`;
  const output = run('npm', ['pack', workspacePath, '--pack-destination', packsDir], {
    capture: true,
  });
  const filename =
    output
      ?.split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .reverse()
      .find(line => line.endsWith('.tgz')) ?? '';
  if (!filename) {
    throw new Error(`Unable to determine tarball path for ${pkg.name}`);
  }
  return path.join(packsDir, filename);
}

function writeSmokeFiles(projectDir) {
  const cjs = `
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const core = require('@headless-coder-sdk/core');
const codex = require('@headless-coder-sdk/codex-adapter');
const claude = require('@headless-coder-sdk/claude-adapter');
const gemini = require('@headless-coder-sdk/gemini-adapter');

assert.equal(typeof core.createCoder, 'function');
assert.equal(typeof codex.createAdapter, 'function');
assert.equal(typeof claude.createAdapter, 'function');
assert.equal(typeof gemini.createAdapter, 'function');

const codexPkg = path.dirname(require.resolve('@headless-coder-sdk/codex-adapter/package.json'));
const workerPath = path.join(codexPkg, 'dist', 'worker.js');
assert.ok(fs.existsSync(workerPath), 'codex worker.js must stay adjacent to the adapter entry point');

console.log('[smoke] CommonJS imports succeeded');
`.trimStart();

  const esm = `
import assert from 'node:assert/strict';
import { registerAdapter, clearRegisteredAdapters } from '@headless-coder-sdk/core';
import { CODER_NAME as CLAUDE, createAdapter as createClaude } from '@headless-coder-sdk/claude-adapter';
import { CODER_NAME as GEMINI, createAdapter as createGemini } from '@headless-coder-sdk/gemini-adapter';

assert.equal(typeof registerAdapter, 'function');
registerAdapter(createClaude);
registerAdapter(createGemini);
clearRegisteredAdapters();

console.log('[smoke] ESM imports succeeded');
`.trimStart();

  fs.writeFileSync(
    path.join(projectDir, 'smoke.cjs'),
    cjs,
    'utf8',
  );
  fs.writeFileSync(
    path.join(projectDir, 'smoke.mjs'),
    esm,
    'utf8',
  );
}

function main() {
  console.log('[smoke] Building targeted workspaces');
  for (const pkg of packages) {
    run('npm', ['run', 'build', '--workspace', pkg.name]);
  }

  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'headless-coder-smoke-'));
  const packsDir = path.join(tmpBase, 'packs');
  const projectDir = path.join(tmpBase, 'project');
  fs.mkdirSync(packsDir);
  fs.mkdirSync(projectDir);

  try {
    console.log('[smoke] Packing workspaces');
    const tarballs = packages.map(pkg => packWorkspace(pkg, packsDir));

    const pkgJson = {
      name: 'headless-coder-smoke',
      version: '0.0.0',
      private: true,
      type: 'commonjs',
    };
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify(pkgJson, null, 2));

    console.log('[smoke] Installing tarballs in isolated project');
    run('npm', ['install', '--omit=dev', ...tarballs], { cwd: projectDir });

    writeSmokeFiles(projectDir);

    console.log('[smoke] Running CommonJS example');
    run('node', ['smoke.cjs'], { cwd: projectDir });

    console.log('[smoke] Running ESM example');
    run('node', ['smoke.mjs'], { cwd: projectDir });

    console.log('[smoke] All checks passed');
  } finally {
    if (keepArtifacts) {
      console.log(`[smoke] Artifacts retained at ${tmpBase}`);
    } else {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  }
}

main();
