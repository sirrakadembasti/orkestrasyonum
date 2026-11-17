// Tüm işçilerin kurulum, kimlik ve (isteğe bağlı) canlı etkinlik durumu.
import { loadCatalog, catalogPath } from './catalog.mjs';
import { credentialStatus, readAuth } from './credentials.mjs';
import { resolveCommand } from './resolve.mjs';
import { runWorker } from './runner.mjs';
import { buildWorkers } from './workers.mjs';

export const PROBE_PROMPT = 'Sadece PONG yaz';

export function loadContext({ env = process.env, overrides = {} } = {}) {
  const catalog = loadCatalog(catalogPath(env));
  const auth = readAuth(env);
  return { env, catalog, auth, workers: buildWorkers({ catalog, auth, env, overrides }) };
}

// Sınırlı eşzamanlılıkla sırayla çalıştırır.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const lane = async () => { while (next < items.length) { const i = next++; results[i] = await fn(items[i]); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

export async function collectStatus({
  probe = false, only, concurrency = 4, timeoutMs, context = loadContext(),
  run = runWorker, resolve = resolveCommand,
} = {}) {
  const { env, catalog, auth, workers } = context;
  const rows = Object.values(workers)
    .filter((w) => !only || only.includes(w.id))
    .map((w) => {
      const credential = w.authProvider ? credentialStatus(w.authProvider, { auth, catalog, env }) : null;
      const installed = Boolean(resolve(w.cli, { env }));
      let state = installed ? 'unknown' : 'not_installed';
      // OpenCode ücretsiz modelleri kimlik gerektirmez; diğer opencode işçileri kimlik ister.
      if (installed && credential && !credential.configured && w.id !== 'opencode-free') state = 'not_connected';
      return { id: w.id, label: w.label, kind: w.kind, billing: w.billing, installed, credential, models: w.models, state };
    });

  if (probe) {
    // Aynı CLI'ın eşzamanlı süreçleri birbirini kilitleyebiliyor (canlı testte opencode zaman aşımına düştü):
    // her CLI kendi kuyruğunda sırayla, farklı CLI'lar paralel.
    const lanes = {};
    for (const row of rows.filter((r) => r.state === 'unknown')) (lanes[workers[row.id].cli] ??= []).push(row);
    await mapLimit(Object.values(lanes), concurrency, async (lane) => {
      for (const row of lane) {
        const result = await run(workers[row.id], { prompt: PROBE_PROMPT, need: 'hizli', env, timeoutMs });
        row.state = result.status;
        row.probe = { model: result.model, effort: result.effort, durationMs: result.durationMs, output: result.output.slice(-300) };
      }
    });
  }
  return rows;
}
