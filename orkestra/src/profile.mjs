// İşçi profili: beynin (ana ajanın) hangi işi kime vereceğine karar vermesi için yetenek, maliyet,
// durum ve geçmiş performans bir arada. Karar vermez; yalnızca bilgi sunar.

// Çalışma kayıtlarından işçi başına istatistik (süren çalışmalar hariç).
export function workerStats(runs) {
  const stats = {};
  for (const r of runs) {
    stats[r.worker] ??= { runs: 0, ok: 0, okMs: 0, lastStatus: null, lastAt: null };
    if (r.status === 'running') continue;
    const s = stats[r.worker];
    s.runs++;
    if (r.status === 'ok') { s.ok++; s.okMs += r.durationMs ?? 0; }
    if (!s.lastAt || r.startedAt > s.lastAt) { s.lastAt = r.startedAt; s.lastStatus = r.status; }
  }
  return Object.fromEntries(Object.entries(stats).map(([id, s]) => [id, {
    runs: s.runs, ok: s.ok, successRate: s.runs ? s.ok / s.runs : 0,
    avgOkMs: s.ok ? Math.round(s.okMs / s.ok) : null, lastStatus: s.lastStatus, lastAt: s.lastAt,
  }]));
}

export function buildProfiles({ rows, workers, stats }) {
  return rows.map((row) => {
    const w = workers[row.id];
    return {
      id: row.id, label: w.label, state: row.state, billing: row.billing, credential: row.credential ?? null,
      canWrite: w.access?.write !== null,
      session: Boolean(w.session),
      notes: w.notes ?? '',
      models: w.models,
      stats: stats[row.id] ?? null,
    };
  });
}
