// OpenCode'a /connect (opencode auth login) ile girilmiş kimliklerin durumu.
// Sırlar (anahtar/token) asla döndürülmez; yalnızca var/yok, tür ve süre bilgisi.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function authPath(env = process.env) {
  const base = env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  return join(base, 'opencode', 'auth.json');
}

export function readAuth(env = process.env) {
  const path = authPath(env);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

export function credentialStatus(providerId, { auth = {}, catalog = {}, env = process.env, now = Date.now() } = {}) {
  const entry = auth[providerId];
  if (entry) {
    const result = { provider: providerId, configured: true, source: 'auth.json', type: entry.type ?? 'bilinmiyor' };
    if (entry.type === 'oauth' && entry.expires) {
      result.expiresAt = new Date(entry.expires).toISOString();
      // Erişim token'ı dolmuş olabilir; refresh token ile yenilenebilir, kesin sonuç için canlı test gerekir.
      result.tokenExpired = entry.expires < now;
    }
    return result;
  }
  const envVar = (catalog[providerId]?.env ?? []).find((name) => env[name]);
  if (envVar) return { provider: providerId, configured: true, source: `env:${envVar}`, type: 'api' };
  return { provider: providerId, configured: false, source: null, type: null };
}
