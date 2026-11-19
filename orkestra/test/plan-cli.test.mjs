import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readPlan } from '../src/plan.mjs';
import { FAKE_CLI } from './helpers.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'orkestra.mjs');

// PATH'te yalnızca sahte "codex" var; gerçek bir AI CLI'ına ulaşılamaz.
function setup({ extraPath = '' } = {}) {
  const bin = mkdtempSync(join(tmpdir(), 'orkestra-bin-'));
  const path = bin + extraPath;
  copyFileSync(FAKE_CLI, join(bin, 'fake.js'));
  writeFileSync(join(bin, 'package.json'), '{"type":"module"}');
  writeFileSync(join(bin, 'codex.cmd'), '@echo off\r\nnode "%dp0%\\fake.js" %*\r\n');
  const home = mkdtempSync(join(tmpdir(), 'orkestra-home-'));
  const dir = mkdtempSync(join(tmpdir(), 'orkestra-proje-'));
  const cli = (mode, ...args) => spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8', env: { ...process.env, PATH: path, Path: path, ORKESTRA_HOME: home, FAKE_MODE: mode },
  });
  return { dir, cli };
}

const winOnly = { skip: process.platform !== 'win32' && 'shim testi Windows için' };

test('komut satırı: plan init, add, set ve show', winOnly, () => {
  const { dir, cli } = setup();
  assert.equal(cli('ok', 'plan', 'init', '--dir', dir, '--', 'Giriş sayfası').status, 0);
  assert.equal(cli('ok', 'plan', 'add', '--dir', dir, '--worker', 'codex', '--', 'API yaz').status, 0);
  const add2 = cli('ok', 'plan', 'add', '--dir', dir, '--depends', 't1', '--', 'Test yaz');
  assert.equal(add2.status, 0, add2.stderr);
  assert.match(add2.stdout, /t2/);

  const show = cli('ok', 'plan', 'show', '--dir', dir);
  assert.equal(show.status, 0, show.stderr);
  assert.match(show.stdout, /Giriş sayfası/);
  assert.match(show.stdout, /t1.*yapılacak.*codex.*API yaz/);
  assert.match(show.stdout, /hazır: t1/);

  const set = cli('ok', 'plan', 'set', 't1', '--dir', dir, '--status', 'done', '--note', 'doğrulandı');
  assert.equal(set.status, 0, set.stderr);
  const json = JSON.parse(cli('ok', 'plan', 'show', '--dir', dir, '--json').stdout);
  assert.equal(json.plan.tasks[0].status, 'done');
  assert.deepEqual(json.ready.map((t) => t.id), ['t2']);

  assert.match(cli('ok', 'plan', 'set', 't1', '--dir', dir, '--status', 'olmaz').stderr, /geçersiz durum/);
  assert.match(cli('ok', 'plan', 'init', '--dir', dir, '--', 'x').stderr, /plan zaten var/);
});

test('komut satırı: run --task görevi başlatır, işçi bitince "doğrulanacak" yapar', winOnly, () => {
  const { dir, cli } = setup();
  cli('ok', 'plan', 'init', '--dir', dir, '--', 'hedef');
  cli('ok', 'plan', 'add', '--dir', dir, '--', 'API yaz');
  cli('ok', 'plan', 'add', '--dir', dir, '--', 'Hatalı iş');

  const ok = cli('session', 'run', 'codex', '--dir', dir, '--task', 't1', '--', 'API yaz');
  assert.equal(ok.status, 0, ok.stderr);
  const runId = ok.stderr.match(/\[izleme\] kimlik: (\S+)/)[1];
  let t1 = readPlan(dir).tasks[0];
  assert.equal(t1.status, 'review', 'başarılı işçi sonucu beyin doğrulayana kadar "review"');
  assert.deepEqual(t1.runs, [runId]);
  assert.deepEqual(t1.history.map((h) => h.status), ['doing', 'review']);
  assert.equal(t1.worker, 'codex', 'görevi alan işçi kaydedilir');

  const bad = cli('invalid', 'run', 'codex', '--dir', dir, '--task', 't2', '--', 'x');
  assert.equal(bad.status, 1);
  const t2 = readPlan(dir).tasks[1];
  assert.equal(t2.status, 'failed');
  assert.match(t2.history.at(-1).note, /geçersiz anahtar/);

  // --continue ile aynı göreve devam: önceki çalışmanın klasöründeki plan kullanılır.
  const cont = cli('session', 'run', 'codex', '--continue', runId, '--task', 't1', '--', 'devam');
  assert.equal(cont.status, 0, cont.stderr);
  t1 = readPlan(dir).tasks[0];
  assert.equal(t1.runs.length, 2);
});

test('komut satırı: worktree işçisi hatayla bitse de dalı plana yazılır (iş kaybolmasın)', winOnly, () => {
  // worktree için orkestra git'i de bulmalı (sahte CLI'lar yine tek AI CLI'ı).
  const gitDir = dirname(spawnSync('where', ['git'], { encoding: 'utf8' }).stdout.split(/\r?\n/)[0]);
  const { dir, cli } = setup({ extraPath: `;${gitDir}` });
  const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  git('init', '-q');
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'ilk');
  cli('ok', 'plan', 'init', '--dir', dir, '--', 'hedef');
  cli('ok', 'plan', 'add', '--dir', dir, '--', 'iş');
  const r = cli('write-fail', 'run', 'codex', '--dir', dir, '--write', '--worktree', '--task', 't1', '--', 'x');
  assert.equal(r.status, 1, r.stderr);
  const t1 = readPlan(dir).tasks[0];
  assert.equal(t1.status, 'failed');
  assert.match(t1.branch ?? '', /^orkestra\/codex-/, 'başarısız görevin dalı da kaydedilmeli');
  assert.equal(git('rev-parse', '--verify', '-q', t1.branch).status, 0, 'dal gerçekten var olmalı');
});

test('komut satırı: bilinmeyen görev ya da plan yoksa işçi başlatılmaz', winOnly, () => {
  const { dir, cli } = setup();
  const noPlan = cli('ok', 'run', 'codex', '--dir', dir, '--task', 't1', '--', 'x');
  assert.equal(noPlan.status, 2);
  assert.match(noPlan.stderr, /plan yok/);
  assert.doesNotMatch(noPlan.stderr, /\[izleme\]/);
  cli('ok', 'plan', 'init', '--dir', dir, '--', 'hedef');
  const unknown = cli('ok', 'run', 'codex', '--dir', dir, '--task', 't5', '--', 'x');
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /bilinmeyen görev: t5/);
  assert.doesNotMatch(unknown.stderr, /\[izleme\]/);
});
