// İşçi tanımları: hangi CLI, hangi model katmanları, efor nasıl iletilir.
import { chatModels, isGlobalProvider, pickTiers } from './catalog.mjs';

const opt = (flag, value) => (value ? [flag, value] : []);
// "medium" = CLI'ın kendi varsayılanı; desteklemeyebilecek CLI'lara bayrak gönderilmez.
const unlessMedium = (flag, effort) => (effort === 'medium' ? [] : [flag, effort]);

// access: işçinin izin modu. Varsayılan "read" her CLI'da açıkça salt okunur moddur; "write" yalnızca
// dosya düzenlemeye izin veren en dar moddur. Tam yetki veren bayraklar (dangerously, --auto, --allow-all) kullanılmaz.
// args({ access }) bu bayrakları prompt'tan önce yerleştirir.
//
// session: oturum sürekliliği. null → desteklenmiyor. preset: true → kimliği orkestra üretir ve CLI'a verir;
// aksi halde kimlik parse() ile çıktıdan yakalanır. args({ session: { id, resume } }) yeni oturum ya da devam.
// parse(ham çıktı) → { text, sessionId, denied }: kullanıcıya gidecek metin, yakalanan oturum, reddedilen izin.

const plain = (raw) => ({ text: raw, sessionId: null, denied: false });

// OpenCode --format json: her satır bir olay; metin "text" olaylarında, oturum her olayın sessionID alanında.
function parseOpencode(raw) {
  const events = raw.split(/\r?\n/).filter((l) => l.trim().startsWith('{'))
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const text = events.filter((e) => e.type === 'text').map((e) => e.part?.text ?? '').join('');
  // Hata olayı uzun yanıt başlıkları içerir; kullanıcıya yalnızca mesajı göster (sınıflandırma ham çıktıda yapılır).
  const errors = events.filter((e) => e.type === 'error').map((e) => `Error: ${e.error?.data?.message ?? e.error?.message ?? e.error?.name ?? 'bilinmeyen hata'}`);
  return { text: text || errors.join('\n') || raw, sessionId: events.find((e) => e.sessionID)?.sessionID ?? null, denied: false };
}

// agy --output-format json: son satır sonuç nesnesi (conversation_id, response, denied_actions).
function parseAgy(raw) {
  const result = raw.split(/\r?\n/).reverse().map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .find((o) => o && typeof o === 'object' && 'conversation_id' in o);
  if (!result) return plain(raw);
  return { text: result.response || raw, sessionId: result.conversation_id, denied: (result.denied_actions ?? []).length > 0 && !result.response };
}

export const CLI_WORKERS = {
  claude: {
    label: 'Claude Code', cli: 'claude', billing: 'CLI aboneliği',
    notes: 'Genel amaçlı: kod yazma, inceleme, plan, uzun bağlam',
    models: { fast: 'haiku', normal: 'sonnet', deep: 'opus' },
    access: { read: ['--permission-mode', 'plan'], write: ['--permission-mode', 'acceptEdits'] },
    session: { preset: true }, // yeni: --session-id <uuid>, devam: --resume <uuid>
    parse: plain,
    args: ({ prompt, model, effort, access = [], session }) => [
      ...access, ...(session ? [session.resume ? '--resume' : '--session-id', session.id] : []),
      '-p', prompt, ...opt('--model', model), '--effort', effort,
    ],
  },
  codex: {
    label: 'Codex (ChatGPT)', cli: 'codex', billing: 'CLI aboneliği',
    notes: 'Kod yazma, hata ayıklama, inceleme; yazma yalnızca proje klasörüne',
    models: { fast: 'gpt-5.6-luna', normal: 'gpt-6-luna', deep: 'gpt-6-luna' },
    // -s yerine -c sandbox_mode: "exec resume" -s kabul etmiyor; böylece okuma/yazma kuralı devamda da aynı kalır.
    access: { read: ['-c', 'sandbox_mode="read-only"'], write: ['-c', 'sandbox_mode="workspace-write"'] },
    session: { preset: false }, // kimlik çıktıdaki "session id: <uuid>" satırından
    parse: (raw) => ({ ...plain(raw), sessionId: raw.match(/session id:\s*([0-9a-f-]{36})/i)?.[1] ?? null }),
    args: ({ prompt, model, effort, access = [], session }) => [
      'exec', ...(session?.resume ? ['resume'] : []), '--skip-git-repo-check', ...opt('-m', model),
      '-c', `model_reasoning_effort="${effort}"`, ...access, ...(session?.resume ? [session.id] : []), prompt,
    ],
  },
  agy: {
    label: 'Antigravity (agy)', cli: 'agy', billing: 'CLI aboneliği', timeoutMs: 300_000,
    notes: 'Gemini/Google modelleri; yalnızca okuma (inceleme, analiz, plan); açılışı 50-170 sn',
    models: { fast: null, normal: null, deep: null }, // agy kendi varsayılan modelini seçer
    // write: null → yalnızca okuma işçisi. accept-edits düzenlemeye izin veriyor ama agy düzenlerken komut da istiyor;
    // etkileşimsiz modda bu izin otomatik reddedilip iş boş bitiyor. Komut izinleri yalnızca tam komut metniyle
    // tanımlanabildiği için dar bir yazma modu kurulamıyor (canlı test, 2026-11-18).
    access: { read: ['--mode', 'plan'], write: null },
    session: { preset: false }, // kimlik JSON sonucundaki conversation_id
    parse: parseAgy,
    args: ({ prompt, model, effort, access = [], session }) => [
      ...access, ...(session?.resume ? ['--conversation', session.id] : []),
      '-p', prompt, '--output-format', 'json', ...opt('--model', model), '--effort', effort,
    ],
  },
  kimi: {
    label: 'Kimi Code CLI', cli: 'kimi', billing: 'CLI ayarına bağlı (Moonshot API ya da Kimi aboneliği)',
    notes: 'Kimi modelleri; oturum devamı yok; yazma modu rutin komutları da çalıştırır',
    models: { fast: null, normal: null, deep: null }, // null → config.toml'daki default_model
    // Kimi'de yalnızca-düzenleme modu yok; --yolo rutin düzenleme ve komutları çalıştırır, riskli işleri yine sorar.
    access: { read: ['--plan'], write: ['--yolo'] },
    session: null, // yalnızca "son oturum" (-c) var; kimlikle devam yok
    parse: plain,
    args: ({ prompt, model, access = [] }) => [...access, '-p', prompt, ...opt('-m', model)], // efor bayrağı yok
  },
  copilot: {
    label: 'GitHub Copilot CLI', cli: 'copilot', billing: 'CLI aboneliği (AI kredisi)',
    notes: 'GitHub bağlamı; her çağrı AI kredisi harcar; okuma modu yavaş olabilir',
    models: { fast: null, normal: null, deep: null }, // null → Copilot kendisi seçer
    access: { read: ['--deny-tool=write'], write: ['--allow-tool=write'] },
    session: { preset: true }, // --session-id hem yeni oturumun kimliğini belirler hem devam ettirir
    parse: plain,
    // "auto" model (model verilmediğinde) efor ayarını reddeder; efor yalnızca açık modelle gönderilir.
    args: ({ prompt, model, effort, access = [], session }) => [
      ...access, ...(session ? ['--session-id', session.id] : []),
      '-p', prompt, '-s', ...opt('--model', model), ...(model ? unlessMedium('--reasoning-effort', effort) : []),
    ],
  },
};

// OpenCode: "plan" ajanı dosya düzenlemez; varsayılan "build" ajanı düzenler.
const OPENCODE_ACCESS = { read: ['--agent', 'plan'], write: [] };

// efforts: model → desteklenen efor listesi (katalogdan). Model desteklemiyorsa --variant gönderilmez;
// katalogda olmayan model için kullanıcının isteği olduğu gibi iletilir.
// --format json: oturum kimliği yalnızca JSON olaylarında var; metin parseOpencode ile çıkarılır.
const opencodeArgs = (provider, efforts = {}) => ({ prompt, model, effort, access = [], session }) => {
  if (!model) throw new Error(`${provider} için model seçilemedi`);
  const supported = efforts[model];
  const variant = effort !== 'medium' && (!supported || supported.includes(effort)) ? ['--variant', effort] : [];
  return ['run', '-m', `${provider}/${model}`, ...variant, '--format', 'json',
    ...(session?.resume ? ['--session', session.id] : []), ...access, prompt];
};
const effortMap = (models) => Object.fromEntries(models.map((m) => [m.id, m.efforts]));

// Sık kullanılan sağlayıcılar için bilinen iyi varsayılanlar; katalogda yoksa sezgisel seçime düşer.
export const PREFERRED_MODELS = {
  'opencode-go': { fast: 'minimax-m3.1-flash', normal: 'kimi-k3', deep: 'kimi-k3.1-pro' },
  'opencode-free': { fast: 'mimo-v2.6-flash-free', normal: 'big-pickle', deep: 'big-pickle' },
  minimax: { fast: 'MiniMax-M3.1-Flash', normal: 'MiniMax-M3', deep: 'MiniMax-M3' },
  'minimax-coding-plan': { fast: 'MiniMax-M3.1-Flash', normal: 'MiniMax-M3', deep: 'MiniMax-M3' },
  'kimi-code-plan-global': { fast: 'kimi-for-coding-highspeed', normal: 'kimi-for-coding', deep: 'k3.1-pro' },
  moonshotai: { fast: 'kimi-k3.1-pro-highspeed', normal: 'kimi-k3', deep: 'kimi-k3.1-pro' },
  xiaomi: { fast: 'mimo-v2.6-flash', normal: 'mimo-v2.6-pro', deep: 'mimo-v2.6-pro' },
  'xiaomi-token-plan-sgp': { fast: 'mimo-v2.6-flash', normal: 'mimo-v2.6-pro', deep: 'mimo-v2.6-pro' },
  'xiaomi-token-plan-ams': { fast: 'mimo-v2.6-flash', normal: 'mimo-v2.6-pro', deep: 'mimo-v2.6-pro' },
};

// /connect ile bağlanabilecek, takip edilen global sağlayıcılar (bağlı olmasalar da durumda gösterilir).
export const WATCHLIST = [
  'minimax', 'minimax-coding-plan',
  'kimi-code-plan-global', 'moonshotai',
  'xiaomi', 'xiaomi-token-plan-sgp', 'xiaomi-token-plan-ams',
  'alibaba', 'alibaba-coding-plan', 'zai', 'zai-coding-plan', 'deepseek',
  'openai', 'anthropic', 'google', 'github-copilot', 'openrouter',
];

// OpenCode'un kendi sağlayıcıları ayrı işçilerdir; /connect listesine girmez.
const OPENCODE_OWN = new Set(['opencode', 'opencode-go']);

// Öncelik: kullanıcı ayarı (her zaman) > bilinen varsayılan (katalogda varsa) > sezgisel seçim.
function tiersFor(preferredKey, ids, override = {}) {
  const auto = pickTiers(ids);
  const preferred = PREFERRED_MODELS[preferredKey] ?? {};
  const known = new Set(ids);
  const pick = (tier) => override[tier]
    ?? (preferred[tier] && (known.has(preferred[tier]) || !ids.length) ? preferred[tier] : auto[tier]);
  return { fast: pick('fast'), normal: pick('normal'), deep: pick('deep') };
}

const billingOf = (provider) => (/coding plan|token plan|for coding/i.test(provider?.name ?? '') ? 'abonelik' : 'token (API)');

export function buildWorkers({ catalog = {}, auth = {}, env = process.env, overrides = {} } = {}) {
  const workers = {};
  for (const [id, w] of Object.entries(CLI_WORKERS)) {
    workers[id] = { id, kind: 'cli', ...w, models: { ...w.models, ...overrides[id] } };
  }

  // OpenCode'un kendi modelleri, faturalama türüne göre üç ayrı işçi.
  const own = chatModels(catalog.opencode);
  const defs = [
    ['opencode-go', 'opencode-go', 'OpenCode Go', 'abonelik', chatModels(catalog['opencode-go']).filter((m) => !m.free),
      'Abonelikle Kimi, MiMo, MiniMax, Qwen, GLM, DeepSeek modelleri'],
    ['opencode-zen', 'opencode', 'OpenCode Zen', 'token (kredi)', own.filter((m) => !m.free),
      'Zen\'in ücretli modelleri; kredi gerekir'],
    ['opencode-free', 'opencode', 'OpenCode ücretsiz', 'ücretsiz', own.filter((m) => m.free),
      'Zen\'in sınırlı ücretsiz modelleri; basit işler ve denemeler'],
  ];
  for (const [id, provider, label, billing, models, notes] of defs) {
    const ids = models.map((m) => m.id);
    workers[id] = {
      id, kind: 'opencode', cli: 'opencode', provider, label, billing, notes,
      authProvider: provider, availableModels: ids,
      models: tiersFor(id, ids, overrides[id]),
      access: OPENCODE_ACCESS,
      session: { preset: false }, // kimlik JSON olaylarındaki sessionID
      parse: parseOpencode,
      args: opencodeArgs(provider, effortMap(models)),
    };
  }

  // /connect ile girilmiş (veya ortam değişkeni olan) global sağlayıcılar + takip listesi.
  const connected = Object.keys(auth).filter((p) => !OPENCODE_OWN.has(p));
  const envConnected = Object.entries(catalog)
    .filter(([, p]) => (p.env ?? []).some((name) => env[name]))
    .map(([id]) => id);
  const ids = new Set([...WATCHLIST, ...connected, ...envConnected]);
  for (const provider of ids) {
    const info = catalog[provider];
    if (!info || OPENCODE_OWN.has(provider) || !isGlobalProvider(provider, info)) continue;
    const models = chatModels(info);
    const modelIds = models.map((m) => m.id);
    const id = `opencode:${provider}`;
    workers[id] = {
      id, kind: 'opencode-connect', cli: 'opencode', provider, label: info.name,
      billing: billingOf(info), notes: `${info.name} modelleri (OpenCode /connect ile)`,
      authProvider: provider, availableModels: modelIds,
      models: tiersFor(provider, modelIds, overrides[id]),
      access: OPENCODE_ACCESS,
      session: { preset: false }, // kimlik JSON olaylarındaki sessionID
      parse: parseOpencode,
      args: opencodeArgs(provider, effortMap(models)),
    };
  }
  return workers;
}
