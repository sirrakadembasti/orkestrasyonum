import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildProfiles, verdictStats, workerStats } from '../src/profile.mjs';
import { addTask, initPlan, setTask, updatePlan } from '../src/plan.mjs';
import { createRun } from '../src/runlog.mjs';
import { buildWorkers } from '../src/workers.mjs';
import { CATALOG } from './helpers.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'orkestra.mjs');

test('istatistik: işçi başına çalışma sayısı, başarı oranı, ortalama süre, son durum', () => {
  const runs = [
    { worker: 'codex', status: 'ok', durationMs: 30_000, startedAt: '2026-11-19T10:00:00Z' },
    { worker: 'codex', status: 'ok', durationMs: 50_000, startedAt: '2026-11-19T11:00:00Z' },
    { worker: 'codex', status: 'timeout', durationMs: 180_000, startedAt: '2026-11-19T12:00:00Z' },
    { worker: 'agy', status: 'permission_denied', durationMs: 90_000, startedAt: '2026-11-19T09:00:00Z' },
    { worker: 'claude', status: 'running', startedAt: '2026-11-19T13:00:00Z' },
  ];
  const s = workerStats(runs);
  assert.deepEqual(s.codex, { runs: 3, ok: 2, successRate: 2 / 3, avgOkMs: 40_000, lastStatus: 'timeout', lastAt: '2026-11-19T12:00:00Z' });
  assert.deepEqual(s.agy, { runs: 1, ok: 0, successRate: 0, avgOkMs: null, lastStatus: 'permission_denied', lastAt: '2026-11-19T09:00:00Z' });
  assert.equal(s.claude.runs, 0, 'süren çalışma istatistiğe girmez');
  assert.equal(workerStats([]).codex, undefined);
});

test('doğrulama: başarı plandaki beyin kararından sayılır, işçinin çıkış durumundan değil', () => {
  const runs = [
    { id: 'r1', worker: 'codex', status: 'timeout' },          // işçi düştü ama beyin dalı doğrulayıp "bitti" dedi
    { id: 'r2', worker: 'opencode-free', status: 'ok' },
    { id: 'r3', worker: 'codex', status: 'ok' },               // aynı görev başka işçiye geçti: son çalışma sayılır
    { id: 'r4', worker: 'agy', status: 'ok' },
  ];
  const plan = { tasks: [
    { id: 't1', worker: 'codex', status: 'done', runs: ['r1'] },
    { id: 't2', worker: 'codex', status: 'done', runs: ['r2', 'r3'] },
    { id: 't3', worker: 'opencode-free', status: 'failed', runs: ['r2'] },
    { id: 't4', worker: 'agy', status: 'review', runs: ['r4'] },   // karar bekliyor: sayılmaz
    { id: 't5', worker: 'codex', status: 'done', runs: [] },       // işçiye gitmemiş: sayılmaz
    { id: 't6', worker: 'agy', status: 'blocked', runs: ['r4'] },  // engel işçinin sonucu değil: sayılmaz
  ] };
  assert.deepEqual(verdictStats({ plans: [plan], runs }), {
    codex: { verified: 2, closed: 2 },
    'opencode-free': { verified: 0, closed: 1 },
  });
  assert.deepEqual(verdictStats({ plans: [], runs }), {});
});

test('profil: beynin karar vermesi için yetenek, maliyet, durum ve geçmiş bir arada', () => {
  const workers = buildWorkers({ catalog: CATALOG });
  const rows = [
    { id: 'codex', state: 'unknown', billing: 'CLI aboneliği', credential: null },
    { id: 'agy', state: 'unknown', billing: 'CLI aboneliği', credential: null },
    { id: 'kimi', state: 'disabled', billing: 'x', credential: null },
  ];
  const p = Object.fromEntries(buildProfiles({ rows, workers, stats: { codex: { runs: 2, ok: 2, successRate: 1, avgOkMs: 1000 } } }).map((r) => [r.id, r]));
  assert.equal(p.codex.canWrite, true);
  assert.equal(p.codex.session, true);
  assert.ok(p.codex.notes.length > 0, 'her işçinin kısa notu var');
  assert.equal(p.codex.stats.runs, 2);
  assert.deepEqual(p.codex.models, workers.codex.models);
  assert.equal(p.agy.canWrite, false, 'agy yalnızca okuma');
  assert.equal(p.kimi.session, false);
  assert.equal(p.kimi.state, 'disabled');
  assert.equal(p.agy.stats, null, 'geçmişi olmayan işçide istatistik null');
});

test('komut satırı: profile --json çalışma geçmişini işçilere bağlar', () => {
  const home = mkdtempSync(join(tmpdir(), 'orkestra-home-'));
  const root = join(home, 'runs');
  for (const status of ['ok', 'ok', 'timeout']) {
    const r = createRun({ worker: 'codex', prompt: 'x' }, { root });
    r.finish({ status, durationMs: 1000 });
  }
  const res = spawnSync(process.execPath, [BIN, 'profile', '--json'], {
    encoding: 'utf8', env: { ...process.env, PATH: '', Path: '', ORKESTRA_HOME: home },
  });
  assert.equal(res.status, 0, res.stderr);
  const codex = JSON.parse(res.stdout).find((r) => r.id === 'codex');
  assert.equal(codex.stats.runs, 3);
  assert.equal(codex.stats.ok, 2);
  assert.equal(codex.state, 'not_installed', 'boş PATH: kurulu görünmez, gerçek CLI çağrılmaz');
  assert.equal(codex.verdicts, null, 'planı olmayan çalışmalarda doğrulama bilgisi yok');
});

test('komut satırı: profile, çalışmaların proje klasörlerindeki planlardan doğrulamaları okur', () => {
  const home = mkdtempSync(join(tmpdir(), 'orkestra-home-'));
  const root = join(home, 'runs');
  const dir = mkdtempSync(join(tmpdir(), 'orkestra-proje-'));
  initPlan(dir, 'hedef');
  for (const status of ['timeout', 'ok']) {
    const r = createRun({ worker: 'codex', prompt: 'x', dir }, { root });
    r.finish({ status, durationMs: 1000 });
    updatePlan(dir, (p) => { const t = addTask(p, { title: status }); setTask(p, t.id, { run: r.id, status: 'done' }); });
  }
  createRun({ worker: 'codex', prompt: 'x', dir: join(dir, 'silinmis') }, { root }).finish({ status: 'ok' }); // planı olmayan klasör
  const res = spawnSync(process.execPath, [BIN, 'profile', '--json'], {
    encoding: 'utf8', env: { ...process.env, PATH: '', Path: '', ORKESTRA_HOME: home },
  });
  assert.equal(res.status, 0, res.stderr);
  const codex = JSON.parse(res.stdout).find((r) => r.id === 'codex');
  assert.deepEqual(codex.verdicts, { verified: 2, closed: 2 });
  assert.equal(codex.stats.ok, 2, 'çıkış istatistiği ayrıca durur');
});
