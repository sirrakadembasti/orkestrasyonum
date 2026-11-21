import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runWorker } from '../src/runner.mjs';
import { buildWorkers } from '../src/workers.mjs';
import { CATALOG, FAKE_CLI, fakeResolve } from './helpers.mjs';

const w = buildWorkers({ catalog: CATALOG, auth: { minimax: { type: 'api', key: 'mock' } } });
const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'orkestra.mjs');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const base = { prompt: 'p', model: 'm', effort: 'medium', access: [] };

test('oturum: her CLI yeni oturumu ve devamı kendi bayrağıyla alır', () => {
  assert.deepEqual(w.claude.args({ ...base, session: { id: 'u1', resume: false } }), ['--session-id', 'u1', '-p', 'p', '--model', 'm', '--effort', 'medium']);
  assert.deepEqual(w.claude.args({ ...base, session: { id: 'u1', resume: true } }), ['--resume', 'u1', '-p', 'p', '--model', 'm', '--effort', 'medium']);
  assert.deepEqual(w.copilot.args({ ...base, model: null, session: { id: 'u2', resume: true } }), ['--session-id', 'u2', '-p', 'p', '-s']);
  assert.deepEqual(w.codex.args({ ...base, session: { id: 'c1', resume: true } }),
    ['exec', 'resume', '--skip-git-repo-check', '-m', 'm', '-c', 'model_reasoning_effort="medium"', 'c1', 'p']);
  assert.deepEqual(w['opencode-free'].args({ ...base, model: 'big-pickle', session: { id: 'ses_1', resume: true } }),
    ['run', '-m', 'opencode/big-pickle', '--format', 'json', '--session', 'ses_1', 'p']);
  assert.deepEqual(w.agy.args({ ...base, model: null, session: { id: 'conv-1', resume: true } }),
    ['--conversation', 'conv-1', '-p', 'p', '--output-format', 'json', '--effort', 'medium']);
  assert.equal(w.kimi.session, null, 'kimi oturum devamını desteklemiyor');
});

test('oturum: Codex okuma/yazma modu devamda da geçerli olsun diye -c sandbox_mode ile verilir', () => {
  assert.deepEqual(w.codex.access, { read: ['-c', 'sandbox_mode="read-only"'], write: ['-c', 'sandbox_mode="workspace-write"'] });
});

test('ayrıştırma: oturum kimliği ve yanıt metni çıktıdan alınır', () => {
  assert.deepEqual(w.codex.parse('workdir: x\nsession id: 01a1ed0c-7541-7532-90db-fd0cbc88cca9\nPONG'),
    { text: 'workdir: x\nsession id: 01a1ed0c-7541-7532-90db-fd0cbc88cca9\nPONG', sessionId: '01a1ed0c-7541-7532-90db-fd0cbc88cca9', denied: false });
  const oc = [
    { type: 'step_start', sessionID: 'ses_A', part: { type: 'step-start' } },
    { type: 'text', sessionID: 'ses_A', part: { type: 'text', text: 'PON' } },
    { type: 'text', sessionID: 'ses_A', part: { type: 'text', text: 'G' } },
  ].map((e) => JSON.stringify(e)).join('\n');
  assert.deepEqual(w['opencode-free'].parse(oc), { text: 'PONG', sessionId: 'ses_A', denied: false });
  // Hata olayında kullanıcıya ham JSON değil, yalnızca hata mesajı gösterilir.
  const ocError = JSON.stringify({ type: 'error', sessionID: 'ses_B', error: { name: 'APIError', data: { message: 'login fail: anahtar yok', statusCode: 401, responseHeaders: { a: 'b' } } } });
  assert.deepEqual(w['opencode-free'].parse(ocError), { text: 'Error: login fail: anahtar yok', sessionId: 'ses_B', denied: false });
  assert.deepEqual(w['opencode-free'].parse('Error: This API key has expired.'), { text: 'Error: This API key has expired.', sessionId: null, denied: false },
    'JSON olmayan hata çıktısı olduğu gibi kalır');
  const agy = 'jetski: uyarı\n{"conversation_id":"conv-9","response":"PONG","denied_actions":[]}';
  assert.deepEqual(w.agy.parse(agy), { text: 'PONG', sessionId: 'conv-9', denied: false });
  const agyDenied = '{"conversation_id":"conv-9","response":"","denied_actions":[{"action":"command"}]}';
  assert.equal(w.agy.parse(agyDenied).denied, true);
});

test('çalıştırıcı: Claude/Copilot için oturum kimliğini orkestra üretir ve devamda aynısını verir', async () => {
  const env = { ...process.env, FAKE_MODE: 'echo' };
  const first = await runWorker(w.claude, { prompt: 'p', env, resolve: fakeResolve });
  assert.match(first.sessionId, UUID);
  assert.deepEqual(JSON.parse(first.output).slice(0, 2), ['--permission-mode', 'plan']);
  assert.ok(JSON.parse(first.output).includes(first.sessionId));
  const next = await runWorker(w.claude, { prompt: 'p', session: first.sessionId, env, resolve: fakeResolve });
  assert.equal(next.sessionId, first.sessionId);
  assert.ok(JSON.parse(next.output).join(' ').includes(`--resume ${first.sessionId}`));
});

test('çalıştırıcı: Codex/OpenCode/agy için oturum kimliği çıktıdan yakalanır', async () => {
  const codex = await runWorker(w.codex, { prompt: 'p', env: { ...process.env, FAKE_MODE: 'session' }, resolve: fakeResolve });
  assert.equal(codex.sessionId, '11111111-2222-4333-8444-555555555555');
  const oc = await runWorker(w['opencode-free'], { prompt: 'p', env: { ...process.env, FAKE_MODE: 'echo-session' }, resolve: fakeResolve });
  assert.equal(oc.sessionId, 'ses_test');
  assert.ok(JSON.parse(oc.output).includes('--format'), 'metin JSON olaydan çıkarılır');
});

test('çalıştırıcı: agy izin reddi yüzünden boş dönerse "permission_denied" olur', async () => {
  const r = await runWorker(w.agy, { prompt: 'p', env: { ...process.env, FAKE_MODE: 'agy-denied' }, resolve: fakeResolve });
  assert.equal(r.status, 'permission_denied');
  assert.equal(r.sessionId, 'conv-1');
});

test('çalıştırıcı: oturum desteklemeyen işçide devam istenirse işçi başlatılmadan reddedilir', async () => {
  let spawned = false;
  await assert.rejects(runWorker(w.kimi, { prompt: 'p', session: 'x', spawn: () => { spawned = true; }, resolve: fakeResolve }),
    /kimi oturum devamını desteklemiyor/);
  assert.equal(spawned, false);
});

// Uçtan uca: PATH'teki sahte "codex" shim'i; gerçek AI'a ulaşılamaz.
test('komut satırı: --continue önceki çalışmanın oturumunda ve klasöründe devam eder', { skip: process.platform !== 'win32' && 'shim testi Windows için' }, () => {
  const bin = mkdtempSync(join(tmpdir(), 'orkestra-bin-'));
  copyFileSync(FAKE_CLI, join(bin, 'fake.js'));
  writeFileSync(join(bin, 'package.json'), '{"type":"module"}');
  writeFileSync(join(bin, 'codex.cmd'), '@echo off\r\nnode "%dp0%\\fake.js" %*\r\n');
  const home = mkdtempSync(join(tmpdir(), 'orkestra-home-'));
  const project = mkdtempSync(join(tmpdir(), 'orkestra-proje-'));
  const cli = (mode, ...args) => spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8', env: { ...process.env, PATH: bin, Path: bin, ORKESTRA_HOME: home, FAKE_MODE: mode },
  });

  const first = cli('session', 'run', 'codex', '--dir', project, '--', 'ilk görev');
  assert.equal(first.status, 0, first.stderr);
  const id = first.stderr.match(/\[izleme\] kimlik: (\S+)/)[1];
  assert.match(first.stderr, /oturum: 11111111-2222-4333-8444-555555555555/);

  const next = cli('echo', 'run', 'codex', '--continue', id, '--', 'devam et');
  assert.equal(next.status, 0, next.stderr);
  const args = JSON.parse(next.stdout.trim());
  assert.deepEqual(args.slice(0, 2), ['exec', 'resume']);
  assert.ok(args.includes('11111111-2222-4333-8444-555555555555'));
  assert.match(next.stderr, new RegExp(project.replace(/\\/g, '\\\\')), 'önceki çalışmanın klasöründe çalışır');

  assert.match(cli('echo', 'run', 'claude', '--continue', id, '--', 'x').stderr, /farklı bir işçiye ait/);
  assert.match(cli('echo', 'run', 'codex', '--continue', 'olmayan-kimlik', '--', 'x').stderr, /Çalışma bulunamadı/);
  assert.match(cli('echo', 'run', 'codex', '--continue', id, '--write', '--worktree', '--', 'x').stderr, /worktree'de değildi/, 'G-8');
});
