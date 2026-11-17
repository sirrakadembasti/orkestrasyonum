// Çalışma ve worktree kimlikleri: "<işçi>-<YYYYMMDD-HHMMSS>-<4 hex>", dosya ve dal adına uygun.
import { randomBytes } from 'node:crypto';

export function makeId(workerId, now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `${workerId.replace(/[^A-Za-z0-9._-]/g, '-')}-${stamp}-${randomBytes(2).toString('hex')}`;
}
