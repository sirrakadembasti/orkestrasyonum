// Bir işçiye görev gönderir: model/efor seçimi, süreç çalıştırma, zaman aşımı, sonuç sınıflandırma.
import { spawn as nodeSpawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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

// Yazma modu tanımlı olmayan (write: null) işçiler yalnızca okuma işi alabilir.
export function assertCanWrite(worker) {
  if (worker.access?.write === null) {
    throw new Error(`${worker.id} etkileşimsiz modda dosya yazamıyor (yalnızca okuma işçisi); yazma için başka bir işçi seç`);
  }
}

export async function runWorker(worker, {
  prompt, model, effort, need, cwd, write = false, env = process.env,
  timeoutMs = worker.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  onOutput = () => {}, // işçi sürerken gelen her çıktı parçası (izleme için)
  session, // devam edilecek oturum kimliği (yoksa yeni oturum)
  spawn = nodeSpawn, resolve = resolveCommand,
} = {}) {
  if (write) assertCanWrite(worker);
  if (session && !worker.session) throw new Error(`${worker.id} oturum devamını desteklemiyor`);
  const chosen = selectModelAndEffort(worker, { model, effort, need });
  const base = { worker: worker.id, model: chosen.model, effort: chosen.effort, dir: cwd ?? process.cwd(), access: write ? 'yazma' : 'okuma' };
  const resolved = resolve(worker.cli, { env });
  if (!resolved) return { ...base, status: 'not_installed', output: `${worker.cli} bulunamadı`, exitCode: null, durationMs: 0 };

  // preset: kimliği orkestra üretir (Claude, Copilot); diğerlerinde yeni oturumun kimliği çıktıdan yakalanır.
  const sess = session ? { id: session, resume: true }
    : worker.session?.preset ? { id: randomUUID(), resume: false } : null;
  const access = worker.access?.[write ? 'write' : 'read'] ?? [];
  const args = [...resolved.prefixArgs, ...worker.args({ prompt, ...chosen, access, session: sess })];
  const started = Date.now();
  return new Promise((done) => {
    // Bazı CLI'lar (OpenCode) proje klasörünü süreç klasöründen değil PWD'den okuyor; ikisi aynı olmalı.
    const childEnv = cwd ? { ...env, PWD: cwd } : env;
    const child = spawn(resolved.file, args, { cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    let timedOut = false;
    const collect = (d) => { output += d; onOutput(stripAnsi(d)); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
    const finish = (exitCode, extra = '') => {
      clearTimeout(timer);
      const raw = stripAnsi(output + extra).trim();
      const parsed = (worker.parse ?? ((r) => ({ text: r, sessionId: null, denied: false })))(raw);
      // Hata kalıpları ham çıktıda aranır; JSON'dan çıkarılan metin yalnızca kullanıcıya gösterilir.
      let status = classify({ output: raw, exitCode, timedOut });
      if (status === 'ok' && parsed.denied) status = 'permission_denied';
      done({
        ...base, status, exitCode, output: parsed.text.trim(), durationMs: Date.now() - started,
        sessionId: parsed.sessionId ?? sess?.id ?? null,
      });
    };
    child.on('error', (err) => finish(-1, `\n${err.message}`));
    child.on('close', (code) => finish(code ?? -1));
  });
}
