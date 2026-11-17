import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { makeId } from '../src/ids.mjs';
import { runWorker } from '../src/runner.mjs';
import { createRun, listRuns, readRun } from '../src/runlog.mjs';
import { buildWorkers } from '../src/workers.mjs';
import { CATALOG, FAKE_CLI, fakeResolve } from './helpers.mjs';

const workers = buildWorkers({ catalog: CATALOG });
const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'orkestra.mjs');
const home = () => mkdtempSync(join(tmpdir(), 'orkestra-home-'));

test('kimlik: işçi adı + zaman + rastgele ek, dosya adına uygun', () => {
  const id = makeId('opencode:minimax', new Date(2026, 10, 18, 9, 5, 7));
  assert.match(id, /^opencode-minimax-20261118-090507-[0-9a-f]{4}$/);
  assert.notEqual(makeId('codex'), makeId('codex'));
});

test('kayıt: çalışma başlar, çıktı eklenir, biter', () => {
  const root = home();
  const run = createRun({ worker: 'codex', model: 'gpt-6-luna', effort: 'medium', dir: 'D:/proje', access: 'okuma', prompt: 'incele' }, { root });
  let info = readRun(run.id, { root });
  assert.equal(info.status, 'running');
  assert.equal(info.pid, process.pid);
  assert.equal(info.lastOutputAt, null);

  run.append('satır 1\n');
  run.append('satır 2\n');
  info = readRun(run.id, { root });
  assert.ok(info.lastOutputAt, 'çıktı zamanı kaydedilmeli');
  assert.deepEqual(info.tail, ['satır 1', 'satır 2']);

  run.finish({ status: 'ok', exitCode: 0, durationMs: 1234 });
  info = readRun(run.id, { root });
  assert.equal(info.status, 'ok');
  assert.equal(info.durationMs, 1234);
  assert.ok(info.finishedAt);
});

test('kayıt: liste en yeni önce; süreci ölmüş "çalışıyor" kaydı kayıp sayılır', () => {
  const root = home();
  const eski = createRun({ worker: 'claude', prompt: 'a' }, { root, now: new Date(2026, 0, 1) });
  const yeni = createRun({ worker: 'codex', prompt: 'b' }, { root, now: new Date(2026, 0, 2) });
  // Ölmüş bir süreci taklit et: kayıt "running" ama pid yaşamıyor.
  const olu = createRun({ worker: 'agy', prompt: 'c' }, { root, now: new Date(2025, 0, 1), pid: 2 ** 22 + 12345 });
  const runs = listRuns({ root });
  assert.deepEqual(runs.map((r) => r.id), [yeni.id, eski.id, olu.id]);
  assert.equal(runs.find((r) => r.id === eski.id).state, 'running');
  assert.equal(runs.find((r) => r.id === olu.id).state, 'lost');
});

test('kayıt: kuyruk yalnızca son N satırı verir, olmayan kimlik hata verir', () => {
  const root = home();
  const run = createRun({ worker: 'codex', prompt: 'x' }, { root });
  for (let i = 1; i <= 50; i++) run.append(`satır ${i}\n`);
  assert.deepEqual(readRun(run.id, { root, lines: 3 }).tail, ['satır 48', 'satır 49', 'satır 50']);
  assert.throws(() => readRun('yok-boyle-bir-kimlik', { root }), /Çalışma bulunamadı/);
});

test('çalıştırıcı: çıktı süreç bitmeden parça parça iletilir', async () => {
  const seen = [];
  const r = await runWorker(workers.codex, {
    prompt: 'p', env: { ...process.env, FAKE_MODE: 'chunks' }, resolve: fakeResolve,
    onOutput: (chunk) => seen.push({ chunk: String(chunk), at: Date.now() }),
  });
  assert.equal(r.status, 'ok');
  assert.ok(seen.length >= 2, `en az iki parça gelmeli, gelen: ${seen.length}`);
  assert.ok(seen.at(-1).at - seen[0].at >= 300, 'ilk parça işçi bitmeden gelmeli');
});

// Uçtan uca: PATH'teki sahte "codex" (Windows .cmd shim'i) sahte CLI'a işaret eder; gerçek AI'a ulaşılamaz.
test('komut satırı: run kaydı oluşturur, runs listeler, watch gösterir', { skip: process.platform !== 'win32' && 'shim testi Windows için' }, () => {
  const bin = mkdtempSync(join(tmpdir(), 'orkestra-bin-'));
  // Gerçek npm shim'leri gibi hedef .js; ESM olarak yüklensin diye klasöre type: module.
  copyFileSync(FAKE_CLI, join(bin, 'fake.js'));
  writeFileSync(join(bin, 'package.json'), '{"type":"module"}');
  writeFileSync(join(bin, 'codex.cmd'), '@echo off\r\nnode "%dp0%\\fake.js" %*\r\n');
  const root = home();
  const project = mkdtempSync(join(tmpdir(), 'orkestra-proje-'));
  mkdirSync(project, { recursive: true });
  const env = { ...process.env, PATH: bin, Path: bin, ORKESTRA_HOME: root, FAKE_MODE: 'chunks' };
  const cli = (...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env });

  const run = cli('run', 'codex', '--dir', project, '--stream', '--', 'görev');
  assert.equal(run.status, 0, run.stderr);
  const id = run.stderr.match(/\[izleme\] kimlik: (\S+)/)?.[1];
  assert.ok(id, `kimlik stderr'de olmalı:\n${run.stderr}`);
  assert.match(run.stdout, /adım 1: dosyalar okunuyor[\s\S]*adım 3: bitti/);

  const runs = cli('runs');
  assert.equal(runs.status, 0, runs.stderr);
  assert.match(runs.stdout, new RegExp(`${id}.*codex.*bitti \\(başarılı\\)`));

  const watch = cli('watch', id);
  assert.equal(watch.status, 0, watch.stderr);
  assert.match(watch.stdout, /adım 3: bitti/);
  assert.match(watch.stdout, /bitti \(başarılı\)/);
  assert.match(watch.stdout, /bitiş: .* önce/, 'biten işte "son çıktıdan beri" değil bitiş zamanı gösterilir');
  assert.doesNotMatch(watch.stdout, /son çıktıdan beri/);
  assert.match(watch.stdout, new RegExp(project.replace(/\\/g, '\\\\')));
});
