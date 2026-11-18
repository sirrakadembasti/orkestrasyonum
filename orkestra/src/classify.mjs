// CLI çıktısını bir duruma çevirir. Sıra önemli: daha özel kalıplar önce.
const RULES = [
  ['expired_key', /api key has expired|key (?:has )?expired|token (?:has )?expired/i],
  ['no_balance', /insufficient (?:account )?balance|top up|quota exceeded|out of credits/i],
  ['not_licensed', /not licensed|no active subscription|subscription required/i],
  ['auth_required', /not logged in|please (?:log ?in|sign in)|opening authentication page|set an auth method|run .*login/i],
  ['invalid_key', /api key not valid|invalid (?:api )?key|invalid authentication|incorrect api key|login fail|user not found|unauthorized|\b401\b|authentication failed/i],
  ['model_not_found', /model[^\n]*(?:not (?:found|exist|supported))|model_not_found/i],
];

export const STATUS_TEXT = {
  ok: 'aktif',
  expired_key: 'anahtar süresi dolmuş',
  no_balance: 'bakiye/kredi yok',
  not_licensed: 'abonelik/lisans yok',
  auth_required: 'giriş gerekli',
  invalid_key: 'geçersiz anahtar',
  model_not_found: 'model desteklenmiyor',
  timeout: 'zaman aşımı',
  not_installed: 'kurulu değil',
  not_connected: 'bağlı değil',
  disabled: 'pasif',
  permission_denied: 'izin reddedildi',
  error: 'hata',
};

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
export const stripAnsi = (text) => String(text ?? '').replace(ANSI, '');

export function classify({ output = '', exitCode = 0, timedOut = false } = {}) {
  if (timedOut) return 'timeout';
  const text = stripAnsi(output);
  for (const [status, pattern] of RULES) if (pattern.test(text)) return status;
  // Bazı CLI'lar hata basıp 0 ile çıkıyor.
  if (exitCode !== 0 || /^\s*Error:/m.test(text)) return 'error';
  return 'ok';
}
