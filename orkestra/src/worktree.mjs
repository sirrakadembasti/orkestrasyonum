// Paralel yazma için işçiye özel git çalışma kopyası (worktree).
// İşçi yalnızca kendi kopyasında yazar; değişiklikleri kendi dalına commit edilir, ana klasöre dokunulmaz.
// Birleştirme otomatik değildir: hangi dalın alınacağına ana ajan ya da kullanıcı karar verir.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tryGit = (cwd, args) => { try { return git(cwd, args); } catch { return null; } };

function stamp(now) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

export function createWorktree(dir, workerId, { now = new Date(), root = join(tmpdir(), 'orkestra-worktrees') } = {}) {
  const repo = tryGit(dir, ['rev-parse', '--show-toplevel']);
  if (!repo) throw new Error(`--worktree için proje bir git deposu olmalı; ${dir} git deposu değil`);
  const base = tryGit(repo, ['rev-parse', '--verify', 'HEAD']);
  if (!base) throw new Error(`--worktree için depoda en az bir commit olmalı; ${repo} içinde henüz commit yok`);

  const id = `${workerId.replace(/[^A-Za-z0-9._-]/g, '-')}-${stamp(now)}-${randomBytes(2).toString('hex')}`;
  const branch = `orkestra/${id}`;
  const path = join(root, `${basename(repo)}-${id}`);
  mkdirSync(root, { recursive: true });
  git(repo, ['worktree', 'add', '-q', '-b', branch, path, base]);
  // Ana klasördeki commit edilmemiş değişiklikler kopyaya taşınmaz; kullanıcıya bildirilir.
  const dirty = git(repo, ['status', '--porcelain']) !== '';
  return { repo, path, branch, base, dirty };
}

export function finalizeWorktree(wt, { message }) {
  git(wt.path, ['add', '-A']);
  const files = git(wt.path, ['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
  let commit = null;
  if (files.length) {
    // Depoda kimlik tanımlı değilse commit'i orkestra adına at (kullanıcının ayarına dokunmadan).
    const identity = tryGit(wt.path, ['config', 'user.email'])
      ? [] : ['-c', 'user.name=orkestra', '-c', 'user.email=orkestra@localhost'];
    git(wt.path, [...identity, 'commit', '-q', '--no-verify', '-m', message]);
    commit = git(wt.path, ['rev-parse', 'HEAD']);
  }
  git(wt.repo, ['worktree', 'remove', '--force', wt.path]);
  if (!commit) git(wt.repo, ['branch', '-D', wt.branch]);
  return { branch: commit ? wt.branch : null, commit, files };
}
