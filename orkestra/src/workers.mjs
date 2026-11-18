// İşçi tanımları: hangi CLI, hangi model katmanları, efor nasıl iletilir.
import { chatModels, isGlobalProvider, pickTiers } from './catalog.mjs';

const opt = (flag, value) => (value ? [flag, value] : []);
// "medium" = CLI'ın kendi varsayılanı; desteklemeyebilecek CLI'lara bayrak gönderilmez.
const unlessMedium = (flag, effort) => (effort === 'medium' ? [] : [flag, effort]);

// access: işçinin izin modu. Varsayılan "read" her CLI'da açıkça salt okunur moddur; "write" yalnızca
// dosya düzenlemeye izin veren en dar moddur. Tam yetki veren bayraklar (dangerously, --auto, --allow-all) kullanılmaz.
// args({ access }) bu bayrakları prompt'tan önce yerleştirir.
export const CLI_WORKERS = {
  claude: {
    label: 'Claude Code', cli: 'claude', billing: 'CLI aboneliği',
    models: { fast: 'haiku', normal: 'sonnet', deep: 'opus' },
    access: { read: ['--permission-mode', 'plan'], write: ['--permission-mode', 'acceptEdits'] },
    args: ({ prompt, model, effort, access = [] }) => [...access, '-p', prompt, ...opt('--model', model), '--effort', effort],
  },
  codex: {
    label: 'Codex (ChatGPT)', cli: 'codex', billing: 'CLI aboneliği',
    models: { fast: 'gpt-5.6-luna', normal: 'gpt-6-luna', deep: 'gpt-6-luna' },
    access: { read: ['-s', 'read-only'], write: ['-s', 'workspace-write'] }, // workspace-write: yalnızca proje klasörü
    args: ({ prompt, model, effort, access = [] }) => [
      'exec', '--skip-git-repo-check', ...opt('-m', model),
      '-c', `model_reasoning_effort="${effort}"`, ...access, prompt,
    ],
  },
  agy: {
    label: 'Antigravity (agy)', cli: 'agy', billing: 'CLI aboneliği', timeoutMs: 300_000,
    models: { fast: null, normal: null, deep: null }, // agy kendi varsayılan modelini seçer
    // write: null → yalnızca okuma işçisi. accept-edits düzenlemeye izin veriyor ama agy düzenlerken komut da istiyor;
    // etkileşimsiz modda bu izin otomatik reddedilip iş boş bitiyor. Komut izinleri yalnızca tam komut metniyle
    // tanımlanabildiği için dar bir yazma modu kurulamıyor (canlı test, 2026-11-18).
    access: { read: ['--mode', 'plan'], write: null },
    args: ({ prompt, model, effort, access = [] }) => [...access, '-p', prompt, ...opt('--model', model), '--effort', effort],
  },
  kimi: {
    label: 'Kimi Code CLI', cli: 'kimi', billing: 'CLI ayarına bağlı (Moonshot API ya da Kimi aboneliği)',
    models: { fast: null, normal: null, deep: null }, // null → config.toml'daki default_model
    // Kimi'de yalnızca-düzenleme modu yok; --yolo rutin düzenleme ve komutları çalıştırır, riskli işleri yine sorar.
    access: { read: ['--plan'], write: ['--yolo'] },
    args: ({ prompt, model, access = [] }) => [...access, '-p', prompt, ...opt('-m', model)], // efor bayrağı yok
  },
  copilot: {
    label: 'GitHub Copilot CLI', cli: 'copilot', billing: 'CLI aboneliği (AI kredisi)',
    models: { fast: null, normal: null, deep: null }, // null → Copilot kendisi seçer
    access: { read: ['--deny-tool=write'], write: ['--allow-tool=write'] },
    // "auto" model (model verilmediğinde) efor ayarını reddeder; efor yalnızca açık modelle gönderilir.
    args: ({ prompt, model, effort, access = [] }) => [
      ...access, '-p', prompt, '-s', ...opt('--model', model), ...(model ? unlessMedium('--reasoning-effort', effort) : []),
    ],
  },
};

// OpenCode: "plan" ajanı dosya düzenlemez; varsayılan "build" ajanı düzenler.
const OPENCODE_ACCESS = { read: ['--agent', 'plan'], write: [] };

// efforts: model → desteklenen efor listesi (katalogdan). Model desteklemiyorsa --variant gönderilmez;
// katalogda olmayan model için kullanıcının isteği olduğu gibi iletilir.
const opencodeArgs = (provider, efforts = {}) => ({ prompt, model, effort, access = [] }) => {
  if (!model) throw new Error(`${provider} için model seçilemedi`);
  const supported = efforts[model];
  const variant = effort !== 'medium' && (!supported || supported.includes(effort)) ? ['--variant', effort] : [];
  return ['run', '-m', `${provider}/${model}`, ...variant, ...access, prompt];
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
    ['opencode-go', 'opencode-go', 'OpenCode Go', 'abonelik', chatModels(catalog['opencode-go']).filter((m) => !m.free)],
    ['opencode-zen', 'opencode', 'OpenCode Zen', 'token (kredi)', own.filter((m) => !m.free)],
    ['opencode-free', 'opencode', 'OpenCode ücretsiz', 'ücretsiz', own.filter((m) => m.free)],
  ];
  for (const [id, provider, label, billing, models] of defs) {
    const ids = models.map((m) => m.id);
    workers[id] = {
      id, kind: 'opencode', cli: 'opencode', provider, label, billing,
      authProvider: provider, availableModels: ids,
      models: tiersFor(id, ids, overrides[id]),
      access: OPENCODE_ACCESS,
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
      billing: billingOf(info), authProvider: provider, availableModels: modelIds,
      models: tiersFor(provider, modelIds, overrides[id]),
      access: OPENCODE_ACCESS,
      args: opencodeArgs(provider, effortMap(models)),
    };
  }
  return workers;
}
