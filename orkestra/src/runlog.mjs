// Çalışma kaydı: her işçi çalışmasının durumu (<kimlik>.json) ve canlı günlüğü (<kimlik>.log).
// Ana ajan işçi sürerken "runs" ve "watch" ile ilerlemeyi ve son çıktıdan beri geçen süreyi görebilir.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { makeId } from './ids.mjs';

export const runsRoot = (env = process.env) => join(env.ORKESTRA_HOME || join(homedir(), '.orkestra'), 'runs');

const metaPath = (root, id) => join(root, `${id}.json`);
const logPath = (root, id) => join(root, `${id}.log`);
const writeMeta = (root, meta) => writeFileSync(metaPath(root, meta.id), JSON.stringify(meta, null, 2));
const readMeta = (root, id) => JSON.parse(readFileSync(metaPath(root, id), 'utf8'));

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}

export function createRun(info, { root = runsRoot(), now = new Date(), pid = process.pid } = {}) {
  mkdirSync(root, { recursive: true });
  const id = makeId(info.worker, now);
  const meta = {
    id, worker: info.worker, model: info.model ?? null, effort: info.effort ?? null,
    dir: info.dir ?? null, access: info.access ?? null,
    prompt: String(info.prompt ?? '').slice(0, 200),
    pid, status: 'running', startedAt: now.toISOString(), lastOutputAt: null,
  };
  writeMeta(root, meta);
  writeFileSync(logPath(root, id), '');
  return {
    id,
    log: logPath(root, id),
    append(chunk) {
      appendFileSync(logPath(root, id), chunk);
      meta.lastOutputAt = new Date().toISOString();
      writeMeta(root, meta);
    },
    finish(result) {
      Object.assign(meta, {
        status: result.status, exitCode: result.exitCode ?? null, durationMs: result.durationMs ?? null,
        finishedAt: new Date().toISOString(), worktree: result.worktree ?? null,
        sessionId: result.sessionId ?? null, // --continue bu kimlikle aynı oturumda devam eder
      });
      writeMeta(root, meta);
    },
  };
}

// state: running | lost (süreç ölmüş ama kayıt bitmemiş) | işçinin bitiş durumu (ok, timeout, …)
const withState = (meta) => ({ ...meta, state: meta.status === 'running' && !alive(meta.pid) ? 'lost' : meta.status });

export function listRuns({ root = runsRoot(), limit = 20 } = {}) {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((f) => f.endsWith('.json'))
    .map((f) => { try { return withState(readMeta(root, f.slice(0, -5))); } catch { return null; } })
    .filter(Boolean)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, limit);
}

export function readRun(id, { root = runsRoot(), lines = 20 } = {}) {
  if (!existsSync(metaPath(root, id))) throw new Error(`Çalışma bulunamadı: ${id}`);
  const log = existsSync(logPath(root, id)) ? readFileSync(logPath(root, id), 'utf8') : '';
  const tail = log.split(/\r?\n/).filter((l) => l.trim()).slice(-lines);
  return { ...withState(readMeta(root, id)), log: logPath(root, id), tail };
}
