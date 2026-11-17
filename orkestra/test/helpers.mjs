import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MOCK_KEY = 'mock-sk-orkestra-0000000000';
export const FAKE_CLI = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-cli.mjs');

const chat = (extra = {}) => ({ tool_call: true, modalities: { output: ['text'] }, cost: { input: 1, output: 2 }, ...extra });
const free = { cost: { input: 0, output: 0 } };

// models.dev biçiminde küçük bir katalog.
export const CATALOG = {
  opencode: { name: 'OpenCode', env: ['OPENCODE_API_KEY'], models: {
    'big-pickle': chat({ ...free, reasoning_options: [] }),'mimo-v2.6-flash-free': chat(free), 'kimi-k3': chat(), 'gpt-6-luna': chat(),
  } },
  'opencode-go': { name: 'OpenCode Go', env: ['OPENCODE_API_KEY'], models: {
    'kimi-k3': chat({ reasoning_options: [{ type: 'effort', values: ['max'] }] }),
    'kimi-k3.1-pro': chat(),
    'minimax-m3.1-flash': chat({ reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high', 'xhigh', 'max'] }] }),
    'beam-free': chat(free),
  } },
  minimax: { name: 'MiniMax (minimax.io)', env: ['MINIMAX_API_KEY'], api: 'https://api.minimax.io/anthropic/v1', models: {
    'MiniMax-M3': chat(), 'MiniMax-M3.1-Flash': chat(),
  } },
  'minimax-cn': { name: 'MiniMax (minimax.cn)', env: ['MINIMAX_API_KEY'], api: 'https://api.minimax.cn/anthropic/v1', models: { 'MiniMax-M3': chat() } },
  'kimi-code-plan-global': { name: 'Kimi For Coding (kimi.ai)', env: ['KIMI_API_KEY'], api: 'https://api.kimi.ai/coding/v1', models: {
    'kimi-for-coding': chat(free), 'kimi-for-coding-highspeed': chat(free), 'k3.1-pro': chat(free),
  } },
  'kimi-code-plan-cn': { name: 'Kimi For Coding (kimi.com)', env: ['KIMI_API_KEY'], api: 'https://api.kimi.com/coding/v1', models: { k3: chat() } },
  moonshotai: { name: 'Moonshot AI', env: ['MOONSHOT_API_KEY'], api: 'https://api.moonshot.ai/v1', models: { 'kimi-k3': chat(), 'kimi-k3.1-pro': chat() } },
  zhipuai: { name: 'Zhipu AI', env: ['ZHIPU_API_KEY'], api: 'https://open.bigmodel.cn/api/paas/v4', models: { 'glm-5': chat() } },
  'xiaomi-token-plan-sgp': { name: 'Xiaomi Token Plan (Singapore)', env: ['XIAOMI_API_KEY'], api: 'https://token-plan-sgp.xiaomimimo.com/v1', models: {
    'mimo-v2.6-flash': chat(free), 'mimo-v2.6-pro': chat(free), 'mimo-v2.5-tts': chat(free),
  } },
  'xiaomi-token-plan-cn': { name: 'Xiaomi Token Plan (China)', env: ['XIAOMI_API_KEY'], api: 'https://token-plan-cn.xiaomimimo.com/v1', models: { 'mimo-v2.6-pro': chat() } },
  'github-copilot': { name: 'GitHub Copilot', env: ['GITHUB_TOKEN'], models: { 'claude-haiku-4.5': chat(), 'text-embedding-3': chat() } },
};

// Mock anahtarlı geçici bir OpenCode veri klasörü (gerçek auth.json'a dokunmaz).
export function makeDataHome(auth) {
  const home = mkdtempSync(join(tmpdir(), 'orkestra-test-'));
  mkdirSync(join(home, 'opencode'), { recursive: true });
  writeFileSync(join(home, 'opencode', 'auth.json'), JSON.stringify(auth));
  return home;
}

// Sahte CLI'ı her komut adı için çözen resolver.
export const fakeResolve = () => ({ file: process.execPath, prefixArgs: [FAKE_CLI] });
