// OpenCode'un models.dev önbelleğinden sağlayıcı ve model bilgisi.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function catalogPath(env = process.env) {
  const base = env.XDG_CACHE_HOME || join(homedir(), '.cache');
  return join(base, 'opencode', 'models.json');
}

export function loadCatalog(path = catalogPath()) {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8'));
}

// Çinli sağlayıcıların yalnızca global sürümleri: "-cn" kimlikli ve .cn alan adlı uç noktalar elenir.
export function isGlobalProvider(id, provider = {}) {
  if (/-cn$/i.test(id)) return false;
  if (provider.api) {
    try {
      if (new URL(provider.api).hostname.endsWith('.cn')) return false;
    } catch { /* geçersiz URL: alan adına bakılamaz */ }
  }
  return true;
}

const NON_CHAT = /embed|tts|voice|image|realtime|live|lyria|computer-use|deep-research/i;

// Orkestrasyonda kullanılabilecek sohbet modelleri (araç çağırabilen, metin üreten), en yeni önce.
export function chatModels(provider = {}) {
  return Object.entries(provider.models ?? {})
    .filter(([id, m]) => !NON_CHAT.test(id)
      && m.tool_call !== false
      && (m.modalities?.output ?? ['text']).includes('text'))
    .sort(([, a], [, b]) => (b.release_date ?? '').localeCompare(a.release_date ?? ''))
    .map(([id, m]) => ({ id, free: m.cost?.input === 0 && m.cost?.output === 0, efforts: supportedEfforts(m) }));
}

// Katalogda efor bilgisi varsa desteklenen değerler ([] = efor ayarı yok); bilgi yoksa undefined.
function supportedEfforts(model) {
  if (!Array.isArray(model.reasoning_options)) return undefined;
  return model.reasoning_options.find((o) => o.type === 'effort')?.values ?? [];
}

const FAST = /flash|mini|lite|haiku|highspeed|nano|turbo/i;
const DEEP = /pro|max|opus|ultra/i;

// Model listesinden hızlı / normal / derin katmanlarını sezgisel seçer.
export function pickTiers(ids) {
  if (!ids.length) return { fast: null, normal: null, deep: null };
  const fast = ids.find((id) => FAST.test(id)) ?? ids[0];
  const deep = ids.find((id) => DEEP.test(id) && !FAST.test(id)) ?? null;
  const normal = ids.find((id) => !FAST.test(id) && !DEEP.test(id)) ?? deep ?? ids[0];
  return { fast, normal, deep: deep ?? normal };
}
