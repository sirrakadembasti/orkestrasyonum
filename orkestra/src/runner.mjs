// Bir işçiye görev gönderir: model/efor seçimi, süreç çalıştırma, zaman aşımı, sonuç sınıflandırma.
import { spawn as nodeSpawn, spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { classify, stripAnsi } from './classify.mjs';
import { normalizeEffort, planFor } from './effort.mjs';
import { resolveCommand } from './resolve.mjs';

export const DEFAULT_TIMEOUT_MS = 180_000;

// İhtiyaç profili katman ve efor önerir; açık verilen model/efor her zaman önceliklidir.
export function selectModelAndEffort(worker, { model, effort, need } = {}) {
  const plan = planFor(need);
  return {
    model: model ?? worker.models?.[plan.tier] ?? null,
    effort: normalizeEffort(effort ?? plan.effort),
  };
}

// İşçinin çalışacağı proje klasörü: kullanıcının verdiği yol, verilmezse çalışılan klasör.
export function resolveProjectDir(dir, { base = process.cwd() } = {}) {
  const abs = resolvePath(base, dir ?? '.');
  if (!existsSync(abs)) throw new Error(`Proje dizini bulunamadı: ${abs}`);
  if (!statSync(abs).isDirectory()) throw new Error(`Proje dizini bir klasör değil: ${abs}`);
  return abs;
}

function killTree(child) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  } else {
    child.kill('SIGKILL');
  }
}

export async function runWorker(worker, {
  prompt, model, effort, need, cwd, write = false, env = process.env,
  timeoutMs = worker.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  spawn = nodeSpawn, resolve = resolveCommand,
} = {}) {
  const chosen = selectModelAndEffort(worker, { model, effort, need });
  const base = { worker: worker.id, model: chosen.model, effort: chosen.effort, dir: cwd ?? process.cwd(), access: write ? 'yazma' : 'okuma' };
  const resolved = resolve(worker.cli, { env });
  if (!resolved) return { ...base, status: 'not_installed', output: `${worker.cli} bulunamadı`, exitCode: null, durationMs: 0 };

  const access = worker.access?.[write ? 'write' : 'read'] ?? [];
  const args = [...resolved.prefixArgs, ...worker.args({ prompt, ...chosen, access })];
  const started = Date.now();
  return new Promise((done) => {
    // Bazı CLI'lar (OpenCode) proje klasörünü süreç klasöründen değil PWD'den okuyor; ikisi aynı olmalı.
    const childEnv = cwd ? { ...env, PWD: cwd } : env;
    const child = spawn(resolved.file, args, { cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    let timedOut = false;
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
    const finish = (exitCode, extra = '') => {
      clearTimeout(timer);
      const text = stripAnsi(output + extra).trim();
      done({ ...base, status: classify({ output: text, exitCode, timedOut }), exitCode, output: text, durationMs: Date.now() - started });
    };
    child.on('error', (err) => finish(-1, `\n${err.message}`));
    child.on('close', (code) => finish(code ?? -1));
  });
}
