// Gerçek opencode CLI + gerçek sağlayıcı uç noktaları, ama yalnızca MOCK anahtarlarla ve
// geçici bir veri klasöründe (kullanıcının auth.json dosyasına dokunulmaz).
// Çalıştırmak için: ORKESTRA_INTEGRATION=1 npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadCatalog } from '../src/catalog.mjs';
import { readAuth } from '../src/credentials.mjs';
import { resolveCommand } from '../src/resolve.mjs';
import { collectStatus } from '../src/status.mjs';
import { buildWorkers } from '../src/workers.mjs';
import { MOCK_KEY, makeDataHome } from './helpers.mjs';

const enabled = process.env.ORKESTRA_INTEGRATION === '1' && resolveCommand('opencode');

test('entegrasyon: mock anahtarlar gerçek opencode ile tanınır ve reddedilir', { skip: !enabled && 'ORKESTRA_INTEGRATION=1 değil veya opencode yok', timeout: 400_000 }, async () => {
  const dataHome = makeDataHome({ minimax: { type: 'api', key: MOCK_KEY } });
  const env = { ...process.env, XDG_DATA_HOME: dataHome, MOONSHOT_API_KEY: MOCK_KEY };
  for (const name of ['MINIMAX_API_KEY', 'KIMI_API_KEY', 'XIAOMI_API_KEY']) delete env[name];

  const catalog = loadCatalog();
  const auth = readAuth(env);
  assert.deepEqual(Object.keys(auth), ['minimax'], 'yalnızca mock kimlik okunmalı');
  const workers = buildWorkers({ catalog, auth, env });
  const context = { env, catalog, auth, workers };

  const only = ['opencode:minimax', 'opencode:moonshotai', 'opencode:kimi-code-plan-global', 'opencode-go'];
  const rows = await collectStatus({ probe: true, only, context, timeoutMs: 150_000 });
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  console.log(rows.map((r) => `${r.id}: ${r.state} — ${r.probe?.output?.split('\n').pop() ?? ''}`).join('\n'));

  assert.equal(byId['opencode:minimax'].credential.source, 'auth.json');
  assert.equal(byId['opencode:moonshotai'].credential.source, 'env:MOONSHOT_API_KEY');
  for (const id of ['opencode:minimax', 'opencode:moonshotai']) {
    assert.ok(['invalid_key', 'auth_required'].includes(byId[id].state), `${id} mock anahtarı reddetmeli, durum: ${byId[id].state}`);
  }
  assert.equal(byId['opencode:kimi-code-plan-global'].state, 'not_connected');
  assert.equal(byId['opencode-go'].state, 'not_connected', 'geçici klasörde Go anahtarı yok');
  assert.ok(!JSON.stringify(rows).includes(MOCK_KEY), 'anahtar çıktıya sızmamalı');
});
