// Ortak efor seviyeleri ve ihtiyaç profilleri. Varsayılan: normal (medium).
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const DEFAULT_EFFORT = 'medium';

const ALIASES = {
  normal: 'medium', orta: 'medium',
  dusuk: 'low', 'düşük': 'low',
  yuksek: 'high', 'yüksek': 'high',
  'cok-yuksek': 'xhigh', 'çok-yüksek': 'xhigh',
};

// İhtiyaç → model katmanı + efor. Görevin niteliğine göre seçilir.
export const NEEDS = {
  hizli: { tier: 'fast', effort: 'low' },
  normal: { tier: 'normal', effort: 'medium' },
  derin: { tier: 'deep', effort: 'high' },
};
export const DEFAULT_NEED = 'normal';

export function normalizeEffort(effort) {
  if (effort == null || effort === '') return DEFAULT_EFFORT;
  const v = String(effort).toLowerCase();
  const resolved = ALIASES[v] ?? v;
  if (!EFFORTS.includes(resolved)) {
    throw new Error(`Geçersiz efor: "${effort}". Geçerli: ${EFFORTS.join(', ')} (veya normal)`);
  }
  return resolved;
}

export function planFor(need = DEFAULT_NEED) {
  const plan = NEEDS[need];
  if (!plan) throw new Error(`Geçersiz ihtiyaç: "${need}". Geçerli: ${Object.keys(NEEDS).join(', ')}`);
  return plan;
}
