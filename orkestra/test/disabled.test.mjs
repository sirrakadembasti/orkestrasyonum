import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { collectStatus } from '../src/status.mjs';
import { buildWorkers } from '../src/workers.mjs';
import { CATALOG } from './helpers.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'orkestra.mjs');

test('pasif işçi: durumda "disabled" görünür ve test edilmez', async () => {
  const workers = buildWorkers({ catalog: CATALOG });
  const context = { env: {}, catalog: CATALOG, auth: {}, workers, disabled: new Set(['kimi']) };
  const probed = [];
  const run = async (w) => { probed.push(w.id); return { status: 'ok', model: null, effort: 'low', durationMs: 1, output: '' }; };
  const rows = await collectStatus({ probe: true, context, run, resolve: () => ({ file: 'x', prefixArgs: [] }) });
  const kimi = rows.find((r) => r.id === 'kimi');
  assert.equal(kimi.state, 'disabled');
  assert.ok(!probed.includes('kimi'), 'pasif işçiye test gönderilmemeli');
  assert.equal(rows.find((r) => r.id === 'codex').state, 'ok', 'diğer işçiler etkilenmez');
});

// Komut satırı: ayar dosyası ORKESTRA_CONFIG ile verilir; boş PATH ile hiçbir gerçek CLI'a ulaşılamaz.
function cli(config, ...args) {
  const dir = mkdtempSync(join(tmpdir(), 'orkestra-ayar-'));
  const file = join(dir, 'orkestra.config.json');
  writeFileSync(file, JSON.stringify(config));
  const env = { ...process.env, PATH: '', Path: '', ORKESTRA_CONFIG: file, ORKESTRA_HOME: dir };
  return spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env });
}

test('komut satırı: pasif işçi run ile çalıştırılamaz', () => {
  const project = mkdtempSync(join(tmpdir(), 'orkestra-proje-'));
  const r = cli({ disabled: ['kimi'] }, 'run', 'kimi', '--dir', project, '--', 'merhaba');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /kimi pasif/);
  assert.match(r.stderr, /disabled/);
});

test('komut satırı: status pasif işçiyi "pasif" gösterir', () => {
  const r = cli({ disabled: ['kimi'] }, 'status', '--only', 'kimi,codex');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /kimi\s.*pasif/);
  assert.doesNotMatch(r.stdout, /codex\s.*pasif/);
});

test('komut satırı: bilinmeyen işçi adı ayarda uyarı verir', () => {
  const r = cli({ disabled: ['kimi-yanlis'] }, 'status', '--only', 'codex');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /bilinmeyen işçi.*kimi-yanlis/);
});
