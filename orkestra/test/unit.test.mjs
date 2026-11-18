import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { chatModels, isGlobalProvider, pickTiers } from '../src/catalog.mjs';
import { classify } from '../src/classify.mjs';
import { authPath, credentialStatus, readAuth } from '../src/credentials.mjs';
import { DEFAULT_EFFORT, normalizeEffort, planFor } from '../src/effort.mjs';
import { resolveCommand } from '../src/resolve.mjs';
import { buildWorkers } from '../src/workers.mjs';
import { CATALOG, MOCK_KEY, makeDataHome } from './helpers.mjs';

test('efor: varsayılan normal (medium), takma adlar ve geçersiz değer', () => {
  assert.equal(DEFAULT_EFFORT, 'medium');
  assert.equal(normalizeEffort(undefined), 'medium');
  assert.equal(normalizeEffort('normal'), 'medium');
  assert.equal(normalizeEffort('YÜKSEK'), 'high');
  assert.equal(normalizeEffort('max'), 'max');
  assert.throws(() => normalizeEffort('ultra'), /Geçersiz efor/);
  assert.deepEqual(planFor(), { tier: 'normal', effort: 'medium' });
  assert.deepEqual(planFor('derin'), { tier: 'deep', effort: 'high' });
  assert.throws(() => planFor('acil'), /Geçersiz ihtiyaç/);
});

test('katalog: Çinli sağlayıcıların yalnızca global sürümü', () => {
  const globals = Object.entries(CATALOG).filter(([id, p]) => isGlobalProvider(id, p)).map(([id]) => id);
  for (const cn of ['minimax-cn', 'kimi-code-plan-cn', 'xiaomi-token-plan-cn', 'zhipuai']) assert.ok(!globals.includes(cn), cn);
  for (const g of ['minimax', 'kimi-code-plan-global', 'moonshotai', 'xiaomi-token-plan-sgp']) assert.ok(globals.includes(g), g);
});

test('katalog: sohbet dışı modeller elenir, katmanlar seçilir', () => {
  const ids = chatModels(CATALOG['xiaomi-token-plan-sgp']).map((m) => m.id);
  assert.deepEqual(ids, ['mimo-v2.6-flash', 'mimo-v2.6-pro']);
  assert.deepEqual(pickTiers(['a-flash', 'b', 'c-pro']), { fast: 'a-flash', normal: 'b', deep: 'c-pro' });
  assert.deepEqual(pickTiers([]), { fast: null, normal: null, deep: null });
  const dated = { models: {
    eski: { release_date: '2024-05-13' }, yeni: { release_date: '2026-10-26' }, 'yeni-flash': { release_date: '2026-09-01' },
  } };
  assert.deepEqual(chatModels(dated).map((m) => m.id), ['yeni', 'yeni-flash', 'eski']);
  assert.deepEqual(pickTiers(chatModels(dated).map((m) => m.id)), { fast: 'yeni-flash', normal: 'yeni', deep: 'yeni' });
});

test('kimlik: mock anahtar auth.json ve ortam değişkeninden okunur, sır sızmaz', () => {
  const home = makeDataHome({
    minimax: { type: 'api', key: MOCK_KEY },
    google: { type: 'oauth', access: MOCK_KEY, refresh: MOCK_KEY, expires: Date.parse('2026-02-13T00:00:00Z') },
  });
  const env = { XDG_DATA_HOME: home, MOONSHOT_API_KEY: MOCK_KEY };
  assert.equal(authPath(env), join(home, 'opencode', 'auth.json'));
  const auth = readAuth(env);
  const now = Date.parse('2026-11-17T00:00:00Z');

  const minimax = credentialStatus('minimax', { auth, catalog: CATALOG, env, now });
  assert.deepEqual(minimax, { provider: 'minimax', configured: true, source: 'auth.json', type: 'api' });
  const moonshot = credentialStatus('moonshotai', { auth, catalog: CATALOG, env, now });
  assert.equal(moonshot.source, 'env:MOONSHOT_API_KEY');
  const google = credentialStatus('google', { auth, catalog: CATALOG, env, now });
  assert.equal(google.tokenExpired, true);
  assert.equal(credentialStatus('kimi-code-plan-global', { auth, catalog: CATALOG, env, now }).configured, false);

  assert.ok(!JSON.stringify([minimax, moonshot, google]).includes(MOCK_KEY), 'anahtar çıktıya sızmamalı');
});

test('kimlik: bozuk veya olmayan auth.json boş kabul edilir', () => {
  assert.deepEqual(readAuth({ XDG_DATA_HOME: join(makeDataHome({}), 'yok') }), {});
});

test('sınıflandırma: bugün görülen gerçek hata metinleri', () => {
  const cases = {
    'Error: This API key has expired. Create a new API key in OpenCode Console': 'expired_key',
    'Error: Insufficient balance. This request is pay-as-you-go': 'no_balance',
    'Error: Insufficient account balance': 'no_balance',
    'Error: Forbidden: unauthorized: not licensed to use Copilot': 'not_licensed',
    'Error: login fail: Please carry the API secret key': 'invalid_key',
    'Error: API key not valid. Please pass a valid API key.': 'invalid_key',
    'Error: User not found.': 'invalid_key',
    'Error: Invalid Authentication': 'invalid_key',
    "The 'gpt-6.1-sol' model is not supported when using Codex": 'model_not_found',
    'Opening authentication page in your browser. Do you want to continue? [Y/n]:': 'auth_required',
    'PONG': 'ok',
  };
  for (const [output, expected] of Object.entries(cases)) assert.equal(classify({ output }), expected, output);
  assert.equal(classify({ output: 'çöktü', exitCode: 1 }), 'error');
  assert.equal(classify({ output: '\x1b[91mError: \x1b[0mbilinmeyen' }), 'error');
  assert.equal(classify({ output: '', timedOut: true }), 'timeout');
});

test('çözümleme: exe, .cmd→exe, .cmd→js, bulunamadı', () => {
  const files = {
    'C:\\a\\copilot.exe': '',
    'C:\\b\\opencode.cmd': '@echo off\r\n"%dp0%\\node_modules\\opencode-ai\\bin\\opencode.exe"   %*',
    // Gerçek npm shim'i: önce "%dp0%\node.exe" geçer, asıl hedef en sondadır.
    'C:\\b\\codex.cmd': 'IF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n)\r\nx & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*',
  };
  const opts = { env: { PATH: 'C:\\a;C:\\b' }, platform: 'win32', exists: (p) => p in files, read: (p) => files[p], nodePath: 'NODE' };
  assert.deepEqual(resolveCommand('copilot', opts), { file: 'C:\\a\\copilot.exe', prefixArgs: [] });
  assert.deepEqual(resolveCommand('opencode', opts), { file: join('C:\\b', 'node_modules\\opencode-ai\\bin\\opencode.exe'), prefixArgs: [] });
  assert.deepEqual(resolveCommand('codex', opts), { file: 'NODE', prefixArgs: [join('C:\\b', 'node_modules\\@openai\\codex\\bin\\codex.js')] });
  assert.equal(resolveCommand('yok', opts), null);
});

test('işçiler: OpenCode Go / Zen / ücretsiz ayrı işçiler, bağlı global sağlayıcılar eklenir', () => {
  const auth = { minimax: { type: 'api', key: MOCK_KEY }, 'minimax-cn': { type: 'api', key: MOCK_KEY }, 'opencode-go': { type: 'api', key: MOCK_KEY } };
  const w = buildWorkers({ catalog: CATALOG, auth, env: { XIAOMI_API_KEY: MOCK_KEY } });

  assert.equal(w['opencode-go'].provider, 'opencode-go');
  assert.equal(w['opencode-go'].billing, 'abonelik');
  assert.deepEqual(w['opencode-go'].models, { fast: 'minimax-m3.1-flash', normal: 'kimi-k3', deep: 'kimi-k3.1-pro' });
  assert.ok(!w['opencode-go'].availableModels.includes('beam-free'));
  assert.deepEqual(w['opencode-zen'].availableModels, ['kimi-k3', 'gpt-6-luna']);
  assert.deepEqual(w['opencode-free'].availableModels, ['big-pickle', 'mimo-v2.6-flash-free']);
  assert.equal(w['opencode-free'].models.normal, 'big-pickle');

  assert.ok(w['opencode:minimax'], 'auth.json ile bağlı');
  assert.ok(w['opencode:xiaomi-token-plan-sgp'], 'ortam değişkeniyle bağlı');
  assert.equal(w['opencode:kimi-code-plan-global'].billing, 'abonelik');
  assert.deepEqual(w['opencode:kimi-code-plan-global'].models, { fast: 'kimi-for-coding-highspeed', normal: 'kimi-for-coding', deep: 'k3.1-pro' });
  for (const cn of ['minimax-cn', 'kimi-code-plan-cn', 'xiaomi-token-plan-cn', 'zhipuai']) assert.ok(!w[`opencode:${cn}`], cn);
  assert.ok(!w['opencode:opencode-go'], 'Go ayrı işçi, connect listesine girmez');
});

test('işçiler: kullanıcı model ayarı önceliklidir', () => {
  const w = buildWorkers({ catalog: CATALOG, overrides: { codex: { deep: 'gpt-x' }, 'opencode:minimax': { normal: 'MiniMax-M2' } } });
  assert.equal(w.codex.models.deep, 'gpt-x');
  assert.equal(w.codex.models.normal, 'gpt-6-luna');
  assert.equal(w['opencode:minimax'].models.normal, 'MiniMax-M2');
});

test('komutlar: her CLI model ve eforu kendi bayrağıyla alır', () => {
  const w = buildWorkers({ catalog: CATALOG });
  const p = 'görev';
  assert.deepEqual(w.claude.args({ prompt: p, model: 'opus', effort: 'high' }), ['-p', p, '--model', 'opus', '--effort', 'high']);
  assert.deepEqual(w.codex.args({ prompt: p, model: 'gpt-6-luna', effort: 'medium' }),
    ['exec', '--skip-git-repo-check', '-m', 'gpt-6-luna', '-c', 'model_reasoning_effort="medium"', p]);
  assert.deepEqual(w.agy.args({ prompt: p, model: null, effort: 'low' }), ['-p', p, '--effort', 'low']);
  // Kimi Code CLI'ın efor bayrağı yok; model verilmezse config.toml varsayılanı kullanılır.
  assert.deepEqual(w.kimi.args({ prompt: p, model: null, effort: 'high' }), ['-p', p]);
  assert.deepEqual(w.kimi.args({ prompt: p, model: 'kimi-k2.6', effort: 'medium' }), ['-p', p, '-m', 'kimi-k2.6']);
  assert.deepEqual(w.copilot.args({ prompt: p, model: null, effort: 'medium' }), ['-p', p, '-s']);
  assert.deepEqual(w.copilot.args({ prompt: p, model: null, effort: 'low' }), ['-p', p, '-s'], 'auto model efor kabul etmez');
  assert.deepEqual(w.copilot.args({ prompt: p, model: 'gpt-5-mini', effort: 'high' }), ['-p', p, '-s', '--model', 'gpt-5-mini', '--reasoning-effort', 'high']);
  assert.deepEqual(w['opencode-go'].args({ prompt: p, model: 'kimi-k3', effort: 'medium' }), ['run', '-m', 'opencode-go/kimi-k3', p]);
  assert.deepEqual(w['opencode:minimax'].args({ prompt: p, model: 'MiniMax-M3', effort: 'max' }), ['run', '-m', 'minimax/MiniMax-M3', '--variant', 'max', p]);
  assert.throws(() => w['opencode-go'].args({ prompt: p, model: null, effort: 'medium' }), /model seçilemedi/);
  // --variant yalnızca modelin katalogda desteklediği eforlar için gönderilir.
  assert.deepEqual(w['opencode-go'].args({ prompt: p, model: 'kimi-k3', effort: 'low' }), ['run', '-m', 'opencode-go/kimi-k3', p], 'kimi-k3 yalnızca max destekler');
  assert.deepEqual(w['opencode-go'].args({ prompt: p, model: 'kimi-k3', effort: 'max' }), ['run', '-m', 'opencode-go/kimi-k3', '--variant', 'max', p]);
  assert.deepEqual(w['opencode-free'].args({ prompt: p, model: 'big-pickle', effort: 'high' }), ['run', '-m', 'opencode/big-pickle', p], 'efor seçeneği yok');
  assert.deepEqual(w['opencode-go'].args({ prompt: p, model: 'katalogda-yok', effort: 'high' }), ['run', '-m', 'opencode-go/katalogda-yok', '--variant', 'high', p], 'bilinmeyen model: kullanıcının isteği iletilir');
});

test('erişim: her işçinin açık okuma ve en dar yazma modu var', () => {
  const w = buildWorkers({ catalog: CATALOG, auth: { minimax: { type: 'api', key: MOCK_KEY } } });
  const expected = {
    claude: { read: ['--permission-mode', 'plan'], write: ['--permission-mode', 'acceptEdits'] },
    codex: { read: ['-s', 'read-only'], write: ['-s', 'workspace-write'] },
    copilot: { read: ['--deny-tool=write'], write: ['--allow-tool=write'] },
    // agy etkileşimsiz modda dar bir yazma izni sunmuyor (canlı testte accept-edits komut izni bekleyip boş döndü).
    agy: { read: ['--mode', 'plan'], write: null },
    kimi: { read: ['--plan'], write: ['--yolo'] },
    'opencode-go': { read: ['--agent', 'plan'], write: [] },
    'opencode-free': { read: ['--agent', 'plan'], write: [] },
    'opencode:minimax': { read: ['--agent', 'plan'], write: [] },
  };
  for (const [id, access] of Object.entries(expected)) assert.deepEqual(w[id].access, access, id);
  for (const worker of Object.values(w)) {
    assert.ok(worker.access, `${worker.id} erişim tanımı yok`);
    assert.doesNotMatch(JSON.stringify(worker.access), /dangerously|--auto|--allow-all|danger-full-access|bypass/, worker.id);
  }
  // Erişim bayrakları prompt'tan önce yerleşir.
  assert.deepEqual(w.codex.args({ prompt: 'p', model: 'm', effort: 'medium', access: ['-s', 'read-only'] }),
    ['exec', '--skip-git-repo-check', '-m', 'm', '-c', 'model_reasoning_effort="medium"', '-s', 'read-only', 'p']);
});
