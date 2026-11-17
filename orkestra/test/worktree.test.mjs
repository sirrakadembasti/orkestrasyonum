import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runWorker } from '../src/runner.mjs';
import { buildWorkers } from '../src/workers.mjs';
import { createWorktree, finalizeWorktree } from '../src/worktree.mjs';
import { CATALOG, fakeResolve } from './helpers.mjs';

const workers = buildWorkers({ catalog: CATALOG });
const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'orkestra.mjs');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

// Kimliği yalnızca test komutlarına verilen, tek commit'li geçici bir depo.
function makeRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'orkestra-repo-'));
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'app.js'), 'export const x = 1;\n');
  git(repo, 'add', '-A');
  git(repo, '-c', 'user.name=test', '-c', 'user.email=test@localhost', 'commit', '-q', '-m', 'ilk');
  return repo;
}
const fileOnBranch = (repo, branch, file) => git(repo, 'show', `${branch}:${file}`);
const branchExists = (repo, branch) => git(repo, 'branch', '--list', branch) !== '';

test('worktree: işçiye özel dal ve ayrı çalışma kopyası açılır', () => {
  const repo = makeRepo();
  const wt = createWorktree(repo, 'opencode:minimax');
  try {
    assert.match(wt.branch, /^orkestra\/opencode-minimax-\d{8}-\d{6}-[0-9a-f]{4}$/);
    assert.ok(existsSync(join(wt.path, 'app.js')), 'çalışma kopyası proje dosyalarını içerir');
    assert.notEqual(wt.path, repo);
    assert.equal(wt.base, git(repo, 'rev-parse', 'HEAD'));
    assert.ok(branchExists(repo, wt.branch));
  } finally {
    finalizeWorktree(wt, { message: 'yok' });
  }
});

test('worktree: değişiklik dala commit edilir, ana klasöre dokunulmaz, kopya silinir', () => {
  const repo = makeRepo();
  const wt = createWorktree(repo, 'codex');
  writeFileSync(join(wt.path, 'yeni.txt'), 'işçi yazdı\n');
  const r = finalizeWorktree(wt, { message: 'orkestra: codex' });
  assert.ok(r.commit, 'commit oluşmalı');
  assert.deepEqual(r.files, ['yeni.txt']);
  assert.equal(fileOnBranch(repo, wt.branch, 'yeni.txt'), 'işçi yazdı');
  assert.ok(!existsSync(join(repo, 'yeni.txt')), 'ana klasör değişmemeli');
  assert.ok(!existsSync(wt.path), 'geçici çalışma kopyası silinmeli');
  assert.equal(git(repo, 'status', '--porcelain'), '');
});

test('worktree: değişiklik yoksa dal da silinir', () => {
  const repo = makeRepo();
  const wt = createWorktree(repo, 'claude');
  const r = finalizeWorktree(wt, { message: 'x' });
  assert.equal(r.commit, null);
  assert.deepEqual(r.files, []);
  assert.ok(!branchExists(repo, wt.branch));
  assert.ok(!existsSync(wt.path));
});

test('worktree: git deposu olmayan ya da commit\'siz klasör reddedilir', () => {
  const plain = mkdtempSync(join(tmpdir(), 'orkestra-duz-'));
  assert.throws(() => createWorktree(plain, 'codex'), /git deposu değil/);
  const empty = mkdtempSync(join(tmpdir(), 'orkestra-bos-'));
  git(empty, 'init', '-q');
  assert.throws(() => createWorktree(empty, 'codex'), /henüz commit yok/);
});

test('worktree: ana klasördeki commit edilmemiş değişiklikler bildirilir', () => {
  const repo = makeRepo();
  writeFileSync(join(repo, 'app.js'), 'export const x = 2;\n');
  const wt = createWorktree(repo, 'codex');
  try {
    assert.equal(wt.dirty, true);
    // core.autocrlf açıksa git satır sonlarını CRLF'ye çevirir; içerik karşılaştırması satır sonundan bağımsız.
    assert.equal(readFileSync(join(wt.path, 'app.js'), 'utf8').replace(/\r\n/g, '\n'), 'export const x = 1;\n', 'kopya son commit\'ten açılır');
  } finally {
    finalizeWorktree(wt, { message: 'x' }); // test başarısız olsa da kopya temizlenir
  }
});

test('paralel yazma: iki işçi aynı dosyaya aynı anda yazar, birbirini ezmez', async () => {
  const repo = makeRepo();
  const run = async (id, content) => {
    const wt = createWorktree(repo, id);
    const res = await runWorker(workers[id], {
      prompt: 'p', cwd: wt.path, write: true, resolve: fakeResolve,
      env: { ...process.env, FAKE_MODE: 'write', FAKE_FILE: 'ortak.txt', FAKE_CONTENT: content },
    });
    return { res, fin: finalizeWorktree(wt, { message: `orkestra: ${id}` }), branch: wt.branch };
  };
  const [a, b] = await Promise.all([run('codex', 'codex yazdı'), run('claude', 'claude yazdı')]);
  assert.equal(a.res.status, 'ok');
  assert.equal(b.res.status, 'ok');
  assert.equal(fileOnBranch(repo, a.branch, 'ortak.txt'), 'codex yazdı');
  assert.equal(fileOnBranch(repo, b.branch, 'ortak.txt'), 'claude yazdı');
  assert.ok(!existsSync(join(repo, 'ortak.txt')), 'ana klasör değişmemeli');
});

test('komut satırı: --worktree yalnızca --write ve --dir ile kabul edilir', () => {
  const repo = makeRepo();
  // Boş PATH: test hiçbir koşulda gerçek bir AI CLI'ına ulaşamaz.
  const env = { ...process.env, PATH: '', Path: '' };
  const noWrite = spawnSync(process.execPath, [BIN, 'run', 'codex', '--dir', repo, '--worktree', '--', 'x'], { encoding: 'utf8', env });
  assert.equal(noWrite.status, 2);
  assert.match(noWrite.stderr, /--worktree yalnızca --write ile/);
});
