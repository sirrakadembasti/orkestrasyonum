import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveProjectDir, runWorker, selectModelAndEffort } from '../src/runner.mjs';
import { collectStatus } from '../src/status.mjs';
import { buildWorkers } from '../src/workers.mjs';
import { CATALOG, MOCK_KEY, fakeResolve } from './helpers.mjs';

const workers = buildWorkers({ catalog: CATALOG, auth: { minimax: { type: 'api', key: MOCK_KEY } } });
const envWith = (mode) => ({ ...process.env, FAKE_MODE: mode });
const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'orkestra.mjs');

test('proje dizini: işçi verilen klasörde çalışır', async () => {
  const project = mkdtempSync(join(tmpdir(), 'orkestra-proje-'));
  const r = await runWorker(workers.codex, { prompt: 'p', cwd: project, env: envWith('cwd'), resolve: fakeResolve });
  assert.equal(r.status, 'ok');
  assert.equal(realpathSync(r.output), realpathSync(project));
  assert.equal(r.dir, project, 'sonuç işin hangi klasörde yapıldığını söylemeli');
});

test('proje dizini: PWD de proje klasörü olur (OpenCode klasörü PWD\'den okuyor)', async () => {
  const project = mkdtempSync(join(tmpdir(), 'orkestra-proje-'));
  const r = await runWorker(workers['opencode-free'], { prompt: 'p', cwd: project, env: { ...envWith('pwd'), PWD: '/baska/klasor' }, resolve: fakeResolve });
  assert.equal(r.output, project);
});

test('proje dizini: yol doğrulanır ve mutlak yola çevrilir', () => {
  const project = mkdtempSync(join(tmpdir(), 'orkestra-proje-'));
  assert.equal(resolveProjectDir(project), project);
  assert.equal(resolveProjectDir(undefined, { base: project }), project, 'verilmezse çalışılan klasör');
  assert.throws(() => resolveProjectDir(join(project, 'yok')), /Proje dizini bulunamadı/);
  const file = join(project, 'dosya.txt');
  writeFileSync(file, 'x');
  assert.throws(() => resolveProjectDir(file), /klasör değil/);
});

test('komut satırı: olmayan proje dizini işçi çalıştırılmadan reddedilir', () => {
  const missing = join(tmpdir(), 'orkestra-olmayan-klasor-xyz');
  const r = spawnSync(process.execPath, [BIN, 'run', 'claude', '--dir', missing, '--', 'merhaba'], { encoding: 'utf8', env: { ...process.env, PATH: '', Path: '' } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Proje dizini bulunamadı/);
});

test('seçim: varsayılan normal model + medium; ihtiyaç ve açık değerler', () => {
  assert.deepEqual(selectModelAndEffort(workers.claude), { model: 'sonnet', effort: 'medium' });
  assert.deepEqual(selectModelAndEffort(workers.claude, { need: 'hizli' }), { model: 'haiku', effort: 'low' });
  assert.deepEqual(selectModelAndEffort(workers.claude, { need: 'derin', effort: 'max' }), { model: 'opus', effort: 'max' });
  assert.deepEqual(selectModelAndEffort(workers['opencode-go'], { model: 'glm-5.3' }), { model: 'glm-5.3', effort: 'medium' });
  assert.deepEqual(selectModelAndEffort(workers.copilot), { model: null, effort: 'medium' });
});

test('çalıştırma: prompt kabuk olmadan bozulmadan iletilir', async () => {
  const prompt = 'a "tırnak" & b | c > d %PATH% $HOME `x`';
  const r = await runWorker(workers['opencode:minimax'], { prompt, effort: 'high', env: envWith('echo'), resolve: fakeResolve });
  assert.equal(r.status, 'ok');
  assert.deepEqual(JSON.parse(r.output), ['run', '-m', 'minimax/MiniMax-M3', '--variant', 'high', '--format', 'json', '--agent', 'plan', prompt]);
});

test('erişim: varsayılan salt okunur, write: true yazma modunu açar', async () => {
  const read = await runWorker(workers.codex, { prompt: 'p', env: envWith('echo'), resolve: fakeResolve });
  assert.equal(read.access, 'okuma');
  assert.ok(JSON.parse(read.output).join(' ').includes('sandbox_mode="read-only"'));
  const write = await runWorker(workers.codex, { prompt: 'p', write: true, env: envWith('echo'), resolve: fakeResolve });
  assert.equal(write.access, 'yazma');
  assert.ok(JSON.parse(write.output).join(' ').includes('sandbox_mode="workspace-write"'));
});

test('erişim: yazma modu olmayan işçiye --write verilirse işçi başlatılmadan reddedilir', async () => {
  let spawned = false;
  const spawn = () => { spawned = true; throw new Error('başlatılmamalıydı'); };
  await assert.rejects(runWorker(workers.agy, { prompt: 'p', write: true, spawn, resolve: fakeResolve }), /agy etkileşimsiz modda dosya yazamıyor/);
  assert.equal(spawned, false);
});

test('komut satırı: yazma modu olmayan işçi --write ile reddedilir, kayıt ve worktree açılmaz', () => {
  const project = mkdtempSync(join(tmpdir(), 'orkestra-proje-'));
  const home = mkdtempSync(join(tmpdir(), 'orkestra-home-'));
  const r = spawnSync(process.execPath, [BIN, 'run', 'agy', '--dir', project, '--write', '--', 'merhaba'],
    { encoding: 'utf8', env: { ...process.env, PATH: '', Path: '', ORKESTRA_HOME: home } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /agy etkileşimsiz modda dosya yazamıyor/);
  assert.doesNotMatch(r.stderr, /\[izleme\]/, 'reddedilen iş için çalışma kaydı açılmamalı');
});

test('komut satırı: --write açık bir --dir olmadan reddedilir', () => {
  const r = spawnSync(process.execPath, [BIN, 'run', 'codex', '--write', '--', 'merhaba'], { encoding: 'utf8', env: { ...process.env, PATH: '', Path: '' } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--write için --dir ile proje klasörünü açıkça ver/);
});

test('çalıştırma: başarılı, süresi dolmuş, geçersiz anahtar', async () => {
  const ok = await runWorker(workers.codex, { prompt: 'p', env: envWith('ok'), resolve: fakeResolve });
  assert.equal(ok.status, 'ok');
  assert.equal(ok.output, 'PONG');
  const expired = await runWorker(workers['opencode-go'], { prompt: 'p', env: envWith('expired'), resolve: fakeResolve });
  assert.equal(expired.status, 'expired_key');
  assert.ok(!expired.output.includes('\x1b['), 'ANSI temizlenmeli');
  const invalid = await runWorker(workers['opencode:minimax'], { prompt: 'p', env: envWith('invalid'), resolve: fakeResolve });
  assert.equal(invalid.status, 'invalid_key');
  assert.equal(invalid.exitCode, 1);
});

test('sınıflandırma: işçinin araç çıktısındaki kimlik hatası benzeri metin işçiyi başarısız saymaz', async () => {
  const codex = await runWorker(workers.codex, { prompt: 'p', env: envWith('codex-tool-noise'), resolve: fakeResolve });
  assert.equal(codex.status, 'ok');
  assert.equal(codex.output, 'Testler geçti.', 'Codex cevabı yalnızca son mesaj (stdout) olmalı');
  assert.equal(codex.sessionId, '11111111-2222-4333-8444-555555555555');
  const oc = await runWorker(workers['opencode-free'], { prompt: 'p', env: envWith('opencode-tool-noise'), resolve: fakeResolve });
  assert.equal(oc.status, 'ok');
  assert.equal(oc.output, 'Testler geçti.');
  const ocErr = await runWorker(workers['opencode-free'], { prompt: 'p', env: envWith('opencode-text-then-error'), resolve: fakeResolve });
  assert.equal(ocErr.status, 'expired_key', 'metinden sonra gelen hata olayı kaybolmamalı');
});

test('sınıflandırma: başarılı cevapta anlatılan HTTP 401 işçiyi "geçersiz anahtar" saymaz', async () => {
  const r = await runWorker(workers.codex, { prompt: 'p', env: envWith('codex-answer-401'), resolve: fakeResolve });
  assert.equal(r.status, 'ok');
});

test('çalıştırma: zaman aşımı süreci öldürür', async () => {
  const r = await runWorker(workers.agy, { prompt: 'p', env: envWith('sleep'), resolve: fakeResolve, timeoutMs: 1500 });
  assert.equal(r.status, 'timeout');
  assert.ok(r.durationMs < 10_000);
});

test('çalıştırma: kurulu olmayan CLI', async () => {
  const r = await runWorker(workers.claude, { prompt: 'p', resolve: () => null });
  assert.equal(r.status, 'not_installed');
});

test('durum: aynı CLI sırayla, farklı CLI\'lar paralel test edilir', async () => {
  const auth = { minimax: { type: 'api', key: MOCK_KEY }, 'opencode-go': { type: 'api', key: MOCK_KEY } };
  const ws = buildWorkers({ catalog: CATALOG, auth });
  const context = { env: {}, catalog: CATALOG, auth, workers: ws };
  const active = {};
  const peak = {};
  const run = async (w) => {
    active[w.cli] = (active[w.cli] ?? 0) + 1;
    peak[w.cli] = Math.max(peak[w.cli] ?? 0, active[w.cli]);
    await new Promise((r) => setTimeout(r, 20));
    active[w.cli]--;
    return { status: 'ok', model: null, effort: 'low', durationMs: 20, output: '' };
  };
  await collectStatus({ probe: true, concurrency: 8, context, run, resolve: () => ({ file: 'x', prefixArgs: [] }) });
  assert.equal(peak.opencode, 1, 'opencode süreçleri çakışmamalı');
  assert.ok(Object.keys(peak).length >= 4, 'farklı CLI\'lar yine de test edilir');
});

test('durum: bağlı olmayanlar test edilmez, bağlılar test edilir, anahtar sızmaz', async () => {
  const context = { env: { FAKE_MODE: 'ok' }, catalog: CATALOG, auth: { minimax: { type: 'api', key: MOCK_KEY } }, workers };
  const probed = [];
  const run = async (w, opts) => { probed.push(w.id); return { status: w.id === 'opencode:minimax' ? 'invalid_key' : 'ok', model: 'm', effort: opts.need === 'hizli' ? 'low' : '?', durationMs: 1, output: '' }; };
  const rows = await collectStatus({ probe: true, context, run, resolve: () => ({ file: 'x', prefixArgs: [] }) });
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

  assert.equal(byId['opencode:minimax'].state, 'invalid_key');
  assert.equal(byId['opencode:kimi-code-plan-global'].state, 'not_connected');
  assert.equal(byId['opencode-go'].state, 'not_connected');
  assert.equal(byId['opencode-free'].state, 'ok', 'ücretsiz modeller kimlik istemez');
  assert.equal(byId.claude.state, 'ok');
  assert.equal(byId.claude.probe.effort, 'low', 'test hızlı profille yapılır');
  assert.ok(!probed.includes('opencode:kimi-code-plan-global'));
  assert.ok(!JSON.stringify(rows).includes(MOCK_KEY));
});
