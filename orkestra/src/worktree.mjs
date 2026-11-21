// Paralel yazma için işçiye özel git çalışma kopyası (worktree).
// İşçi yalnızca kendi kopyasında yazar; değişiklikleri kendi dalına commit edilir, ana klasöre dokunulmaz.
// Birleştirme otomatik değildir: hangi dalın alınacağına ana ajan ya da kullanıcı karar verir.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { makeId } from './ids.mjs';

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tryGit = (cwd, args) => { try { return git(cwd, args); } catch { return null; } };

export function createWorktree(dir, workerId, { now = new Date(), root = join(tmpdir(), 'orkestra-worktrees') } = {}) {
  const repo = tryGit(dir, ['rev-parse', '--show-toplevel']);
  if (!repo) throw new Error(`--worktree için proje bir git deposu olmalı; ${dir} git deposu değil`);
  const base = tryGit(repo, ['rev-parse', '--verify', 'HEAD']);
  if (!base) throw new Error(`--worktree için depoda en az bir commit olmalı; ${repo} içinde henüz commit yok`);

  const branch = `orkestra/${makeId(workerId, now)}`;
  const path = worktreePath(repo, branch, root);
  mkdirSync(root, { recursive: true });
  git(repo, ['worktree', 'add', '-q', '-b', branch, path, base]);
  return { repo, path, branch, base, dirty: isDirty(repo), existing: false };
}

// --continue + --worktree: işçinin dalı, önceki kopyanın yolunda yeniden açılır. Yol aynı kalır, çünkü bazı CLI'ların
// oturumu çalıştığı klasöre bağlıdır (claude) ve işçinin hafızasındaki dosya yolları geçerli kalmalıdır.
// Dal silinmişse (önceki çalışma bir şey değiştirmemişti) aynı adla güncel HEAD'den açılır.
export function reopenWorktree(dir, branch, { root = join(tmpdir(), 'orkestra-worktrees') } = {}) {
  const repo = tryGit(dir, ['rev-parse', '--show-toplevel']);
  if (!repo) throw new Error(`--worktree için proje bir git deposu olmalı; ${dir} git deposu değil`);
  const path = worktreePath(repo, branch, root);
  const existing = tryGit(repo, ['rev-parse', '--verify', '-q', `refs/heads/${branch}`]);
  tryGit(repo, ['worktree', 'prune']); // silinmiş eski kopyanın kaydı kalmışsa yol yeniden kullanılabilsin
  if (git(repo, ['worktree', 'list', '--porcelain']).split('\n').includes(`branch refs/heads/${branch}`)) {
    throw new Error(`${branch} dalı başka bir yerde checkout edilmiş; devam için önce o klasörde başka bir dala geç`);
  }
  mkdirSync(root, { recursive: true });
  git(repo, ['worktree', 'add', '-q', ...(existing ? [path, branch] : ['-b', branch, path, 'HEAD'])]);
  return { repo, path, branch, base: git(path, ['rev-parse', 'HEAD']), dirty: isDirty(repo), existing: Boolean(existing) };
}

const worktreePath = (repo, branch, root) => join(root, `${basename(repo)}-${branch.replace(/^orkestra\//, '')}`);
// Ana klasördeki commit edilmemiş değişiklikler kopyaya taşınmaz; kullanıcıya bildirilir.
const isDirty = (repo) => git(repo, ['status', '--porcelain']) !== '';

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
  // Boş kalan dal yalnızca bu çalışmada açıldıysa silinir; devam edilen dalın önceki commit'leri korunur.
  const keep = Boolean(commit) || wt.existing;
  if (!keep) git(wt.repo, ['branch', '-D', wt.branch]);
  return { branch: keep ? wt.branch : null, commit, files };
}
