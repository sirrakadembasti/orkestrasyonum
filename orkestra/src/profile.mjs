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

// Beynin kararı: işçinin çıkış durumu yanıltabilir (zaman aşımına düşen işçinin işi tamam olabilir).
// Kapanan görev = "done" ya da "failed"; işçiye, görevin son çalışmasının işçisi sayılır.
// İşçiye gitmemiş, karar bekleyen ya da engellenen görevler sayılmaz.
export function verdictStats({ plans, runs }) {
  const workerOf = new Map(runs.map((r) => [r.id, r.worker]));
  const stats = {};
  for (const task of plans.flatMap((p) => p.tasks)) {
    if (task.status !== 'done' && task.status !== 'failed') continue;
    const worker = workerOf.get(task.runs.at(-1));
    if (!worker) continue;
    stats[worker] ??= { verified: 0, closed: 0 };
    stats[worker].closed++;
    if (task.status === 'done') stats[worker].verified++;
  }
  return stats;
}

export function buildProfiles({ rows, workers, stats, verdicts = {} }) {
  return rows.map((row) => {
    const w = workers[row.id];
    return {
      id: row.id, label: w.label, state: row.state, billing: row.billing, credential: row.credential ?? null,
      canWrite: w.access?.write !== null,
      session: Boolean(w.session),
      notes: w.notes ?? '',
      models: w.models,
      stats: stats[row.id] ?? null,
      verdicts: verdicts[row.id] ?? null,
    };
  });
}
