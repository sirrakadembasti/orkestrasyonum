#!/usr/bin/env node
// orkestra status [--probe] [--only a,b] [--json]
// orkestra models <işçi>
// orkestra run <işçi> [--dir proje-yolu [--write [--worktree]]] [--continue çalışma-kimliği] [--model m] [--effort e] [--need hizli|normal|derin] [--timeout sn] [--json] -- <prompt>
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATUS_TEXT } from '../src/classify.mjs';
import { DEFAULT_EFFORT, DEFAULT_NEED, EFFORTS, NEEDS } from '../src/effort.mjs';
import { assertCanWrite, resolveProjectDir, runWorker, selectModelAndEffort } from '../src/runner.mjs';
import { addTask, initPlan, planPath, readPlan, readyTasks, setTask, updatePlan } from '../src/plan.mjs';
import { createRun, listRuns, readRun } from '../src/runlog.mjs';
import { buildProfiles, workerStats } from '../src/profile.mjs';
import { collectStatus, loadContext } from '../src/status.mjs';
import { createWorktree, finalizeWorktree } from '../src/worktree.mjs';

function parseArgs(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { rest.push(argv.slice(i + 1).join(' ')); break; }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) flags[key] = true;
      else { flags[key] = next; i++; }
    } else rest.push(a);
  }
  return { flags, rest };
}

// İsteğe bağlı makineye özel ayar (git'e girmez):
// { "models": { "<işçi>": { "fast": "...", "normal": "...", "deep": "..." } }, "disabled": ["<işçi>", …] }
// Varsayılan konum araç klasörü; hangi proje klasöründen çağrılırsa çağrılsın aynı ayar kullanılır.
const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
function loadConfig() {
  const path = resolvePath(process.env.ORKESTRA_CONFIG ?? join(SKILL_DIR, 'orkestra.config.json'));
  const config = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  return { overrides: config.models ?? {}, disabled: config.disabled ?? [] };
}

const credText = (c) => {
  if (!c) return 'CLI yönetir';
  if (!c.configured) return '—';
  return `${c.source} (${c.type})${c.tokenExpired ? ' ⚠ token süresi geçmiş' : ''}`;
};

function printTable(head, lines) {
  const widths = head.map((h, i) => Math.max(h.length, ...lines.map((l) => String(l[i]).length)));
  const fmt = (cols) => cols.map((c, i) => String(c).padEnd(widths[i])).join('  ');
  console.log(fmt(head));
  for (const l of lines) console.log(fmt(l));
}

function printStatus(rows) {
  printTable(['İŞÇİ', 'FATURALAMA', 'KİMLİK', 'DURUM', 'MODELLER (hızlı | normal | derin)'], rows.map((r) => [
    r.id, r.billing ?? '', credText(r.credential),
    r.state === 'unknown' ? 'test edilmedi' : (STATUS_TEXT[r.state] ?? r.state),
    [r.models.fast, r.models.normal, r.models.deep].map((m) => m ?? 'varsayılan').join(' | '),
  ]));
}

// Çalışma listesinde "ok" bir işçinin aktif olduğunu değil, işin bittiğini anlatır.
const stateText = (state) => ({ running: 'çalışıyor', lost: 'kayıp (süreç yok)', ok: 'bitti (başarılı)' }[state] ?? STATUS_TEXT[state] ?? state);
const TASK_TEXT = { todo: 'yapılacak', doing: 'çalışıyor', review: 'doğrulanacak', done: 'bitti', failed: 'başarısız', blocked: 'engelli' };

function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} sn`;
  if (s < 3600) return `${Math.floor(s / 60)} dk ${s % 60} sn`;
  return `${Math.floor(s / 3600)} sa ${Math.floor((s % 3600) / 60)} dk`;
}

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  const { flags, rest } = parseArgs(argv);
  const context = loadContext(loadConfig());
  for (const id of context.disabled) {
    if (!context.workers[id]) console.error(`[ayar] uyarı: "disabled" listesinde bilinmeyen işçi: ${id}`);
  }

  if (command === 'status') {
    const rows = await collectStatus({
      probe: Boolean(flags.probe), only: typeof flags.only === 'string' ? flags.only.split(',') : undefined,
      timeoutMs: flags.timeout ? Number(flags.timeout) * 1000 : undefined, context,
    });
    if (flags.json) console.log(JSON.stringify(rows, null, 2));
    else printStatus(rows);
    return;
  }

  if (command === 'models') {
    const worker = context.workers[rest[0]];
    if (!worker) throw new Error(`Bilinmeyen işçi: ${rest[0]}`);
    console.log(JSON.stringify({ id: worker.id, katmanlar: worker.models, modeller: worker.availableModels ?? 'CLI kendi listesini yönetir' }, null, 2));
    return;
  }

  if (command === 'run') {
    const [workerId, ...promptParts] = rest;
    const worker = context.workers[workerId];
    if (!worker) throw new Error(`Bilinmeyen işçi: ${workerId}. Liste için: orkestra status`);
    if (context.disabled.has(workerId)) throw new Error(`${workerId} pasif (orkestra.config.json → "disabled"); açmak için listeden çıkar`);
    const prompt = promptParts.join(' ');
    if (!prompt) throw new Error('Prompt boş. Kullanım: orkestra run <işçi> [seçenekler] -- <prompt>');
    const write = flags.write === true;
    // --continue <çalışma kimliği>: aynı işçinin önceki oturumunda, aynı proje klasöründe devam eder.
    let prev = null;
    if (typeof flags.continue === 'string') {
      if (flags.worktree) throw new Error('--continue ile --worktree birlikte kullanılamaz (önceki çalışma kopyası silindi)');
      prev = readRun(flags.continue);
      if (prev.worker !== workerId) throw new Error(`${prev.id} farklı bir işçiye ait (${prev.worker}); devam için aynı işçiyi seç`);
      if (!prev.sessionId) throw new Error(`${prev.id} için kayıtlı oturum kimliği yok; devam edilemiyor`);
    }
    // Yazma, yanlış klasörde dosya değiştirmemek için yalnızca açıkça verilen (ya da devam edilen) proje klasöründe yapılır.
    if (write && typeof flags.dir !== 'string' && !prev) throw new Error('--write için --dir ile proje klasörünü açıkça ver');
    if (flags.worktree && !write) throw new Error('--worktree yalnızca --write ile kullanılır (salt okunur işçi zaten bir şey değiştirmez)');
    if (write) assertCanWrite(worker); // worktree ve çalışma kaydı açılmadan önce
    const projectDir = resolveProjectDir(typeof flags.dir === 'string' ? flags.dir : prev?.dir ?? undefined);
    // --task <görev>: çalışma projedeki plana bağlanır; plan ve görev, işçi başlamadan doğrulanır.
    const taskId = typeof flags.task === 'string' ? flags.task : null;
    if (taskId && !readPlan(projectDir).tasks.some((t) => t.id === taskId)) throw new Error(`bilinmeyen görev: ${taskId}`);
    // --worktree: işçi ana klasörde değil, kendi dalındaki ayrı bir kopyada çalışır; paralel işçiler birbirini ezmez.
    const wt = flags.worktree ? createWorktree(projectDir, worker.id) : null;
    const choice = {
      model: typeof flags.model === 'string' ? flags.model : undefined,
      effort: typeof flags.effort === 'string' ? flags.effort : undefined,
      need: typeof flags.need === 'string' ? flags.need : undefined,
    };
    // İzleme: çalışma kaydı açılır, kimlik hemen bildirilir; çıktı geldikçe günlüğe yazılır.
    const chosen = selectModelAndEffort(worker, choice);
    const log = createRun({ worker: worker.id, ...chosen, dir: projectDir, access: write ? 'yazma' : 'okuma', prompt });
    console.error(`[izleme] kimlik: ${log.id} · günlük: ${log.log}`);
    const markTask = (patch) => {
      if (!taskId) return;
      updatePlan(projectDir, (p) => setTask(p, taskId, patch));
      if (patch.status) console.error(`[plan] ${taskId} → ${TASK_TEXT[patch.status]}`);
    };
    markTask({ status: 'doing', worker: worker.id, run: log.id });
    const stream = flags.stream === true && !flags.json;
    let result;
    try {
      result = await runWorker(worker, {
        prompt,
        cwd: wt ? wt.path : projectDir,
        write,
        ...choice,
        timeoutMs: flags.timeout ? Number(flags.timeout) * 1000 : undefined,
        session: prev?.sessionId,
        onOutput: (chunk) => { log.append(chunk); if (stream) process.stdout.write(chunk); },
      });
    } catch (err) {
      if (wt) finalizeWorktree(wt, { message: `orkestra: ${worker.id} (yarım kaldı)` }); // kopya açıkta kalmasın
      log.finish({ status: 'error' });
      markTask({ status: 'failed', note: err.message });
      throw err;
    }
    if (wt) {
      const fin = finalizeWorktree(wt, { message: `orkestra: ${worker.id} (${result.model ?? 'varsayılan'})\n\n${prompt}` });
      result.dir = projectDir;
      result.worktree = { ...fin, base: wt.base, uncommittedInMain: wt.dirty };
    }
    result.runId = log.id;
    log.finish(result);
    // İşçinin "tamam" demesi kanıt değil: başarılı iş "review" olur, beyin doğrulayınca "done" yapar.
    markTask(result.status === 'ok'
      ? { status: 'review', ...(result.worktree?.branch ? { branch: result.worktree.branch } : {}) }
      : { status: 'failed', note: STATUS_TEXT[result.status] ?? result.status });
    if (result.sessionId) console.error(`[izleme] oturum: ${result.sessionId} · devam için: --continue ${log.id}`);
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.error(`[${result.worker} · ${result.model ?? 'varsayılan'} · efor=${result.effort} · ${STATUS_TEXT[result.status] ?? result.status} · ${(result.durationMs / 1000).toFixed(1)} sn · ${result.access} · ${result.dir}]`);
      if (!stream) console.log(result.output); // akış açıksa çıktı zaten basıldı
      if (wt) {
        const w = result.worktree;
        console.error(w.commit
          ? `[worktree] dal: ${w.branch} · commit: ${w.commit.slice(0, 7)} · dosyalar: ${w.files.join(', ')}\n[worktree] birleştirmek için: git -C "${projectDir}" merge --no-ff ${w.branch}`
          : '[worktree] işçi hiçbir dosyayı değiştirmedi; dal silindi');
        if (w.uncommittedInMain) console.error('[worktree] uyarı: ana klasördeki commit edilmemiş değişiklikler işçinin kopyasına dahil değildi');
      }
    }
    process.exitCode = result.status === 'ok' ? 0 : 1;
    return;
  }

  if (command === 'plan') {
    const [sub, ...args] = rest;
    const dir = resolveProjectDir(typeof flags.dir === 'string' ? flags.dir : undefined);
    if (sub === 'init') {
      const goal = args.join(' ').trim();
      if (!goal) throw new Error('Hedef boş. Kullanım: orkestra plan init --dir <proje> -- "<hedef>"');
      initPlan(dir, goal);
      console.log(`plan oluşturuldu: ${planPath(dir)}`);
      return;
    }
    if (sub === 'add') {
      const task = updatePlan(dir, (p) => addTask(p, {
        title: args.join(' '),
        worker: typeof flags.worker === 'string' ? flags.worker : null,
        depends: typeof flags.depends === 'string' ? flags.depends.split(',').map((s) => s.trim()).filter(Boolean) : [],
        note: typeof flags.note === 'string' ? flags.note : null,
      }));
      console.log(`${task.id} eklendi: ${task.title}`);
      return;
    }
    if (sub === 'set') {
      const task = updatePlan(dir, (p) => setTask(p, args[0], {
        status: typeof flags.status === 'string' ? flags.status : undefined,
        worker: typeof flags.worker === 'string' ? flags.worker : undefined,
        note: typeof flags.note === 'string' ? flags.note : undefined,
      }));
      console.log(`${task.id} → ${TASK_TEXT[task.status]}`);
      return;
    }
    if (sub === 'show' || sub === undefined) {
      const plan = readPlan(dir);
      const ready = readyTasks(plan);
      if (flags.json) { console.log(JSON.stringify({ plan, ready }, null, 2)); return; }
      console.log(`hedef: ${plan.goal}`);
      if (!plan.tasks.length) { console.log('henüz görev yok'); return; }
      printTable(['GÖREV', 'DURUM', 'İŞÇİ', 'BAĞIMLI', 'SON ÇALIŞMA', 'DAL', 'BAŞLIK'], plan.tasks.map((t) => [
        t.id, TASK_TEXT[t.status], t.worker ?? '—', t.depends.join(',') || '—', t.runs.at(-1) ?? '—', t.branch ?? '—', t.title,
      ]));
      const count = (s) => plan.tasks.filter((t) => t.status === s).length;
      console.log(`\nhazır: ${ready.map((t) => t.id).join(', ') || 'yok'} · doğrulanacak: ${count('review')} · bitti: ${count('done')}/${plan.tasks.length}`);
      return;
    }
    throw new Error(`Bilinmeyen plan komutu: ${sub} (init | add | set | show)`);
  }

  if (command === 'profile') {
    // Beyin için: yetenek, maliyet, durum ve geçmiş performans (canlı test yapılmaz, kredi harcanmaz).
    const rows = await collectStatus({ only: typeof flags.only === 'string' ? flags.only.split(',') : undefined, context });
    const profiles = buildProfiles({ rows, workers: context.workers, stats: workerStats(listRuns({ limit: Infinity })) });
    if (flags.json) { console.log(JSON.stringify(profiles, null, 2)); return; }
    printTable(['İŞÇİ', 'DURUM', 'YAZMA', 'OTURUM', 'FATURALAMA', 'GEÇMİŞ (başarılı/toplam · ort.)', 'NOT'], profiles.map((p) => [
      p.id, p.state === 'unknown' ? 'hazır (test edilmedi)' : (STATUS_TEXT[p.state] ?? p.state),
      p.canWrite ? 'evet' : 'hayır', p.session ? 'evet' : 'hayır', p.billing ?? '',
      p.stats ? `${p.stats.ok}/${p.stats.runs}${p.stats.avgOkMs ? ` · ${ago(p.stats.avgOkMs)}` : ''}` : '—',
      p.notes,
    ]));
    return;
  }

  if (command === 'runs') {
    const runs = listRuns({ limit: flags.limit ? Number(flags.limit) : 20 });
    if (flags.json) { console.log(JSON.stringify(runs, null, 2)); return; }
    if (!runs.length) { console.log('Kayıtlı çalışma yok.'); return; }
    const now = Date.now();
    const rows = runs.map((r) => [
      r.id, r.worker, stateText(r.state),
      ago(now - Date.parse(r.startedAt)),
      r.state === 'running' ? (r.lastOutputAt ? ago(now - Date.parse(r.lastOutputAt)) : 'henüz yok') : '—',
      r.dir ?? '',
    ]);
    printTable(['KİMLİK', 'İŞÇİ', 'DURUM', 'BAŞLAYALI', 'SON ÇIKTIDAN BERİ', 'KLASÖR'], rows);
    return;
  }

  if (command === 'watch') {
    const r = readRun(rest[0] ?? '', { lines: flags.lines ? Number(flags.lines) : 20 });
    if (flags.json) { console.log(JSON.stringify(r, null, 2)); return; }
    const now = Date.now();
    console.log(`${r.id} · ${r.worker} · ${r.model ?? 'varsayılan'} · efor=${r.effort} · ${r.access} · ${stateText(r.state)}`);
    console.log(`klasör: ${r.dir}`);
    console.log(r.finishedAt
      ? `süre: ${ago(Date.parse(r.finishedAt) - Date.parse(r.startedAt))} · bitiş: ${ago(now - Date.parse(r.finishedAt))} önce`
      : `başlayalı: ${ago(now - Date.parse(r.startedAt))} · son çıktıdan beri: ${r.lastOutputAt ? ago(now - Date.parse(r.lastOutputAt)) : 'henüz çıktı yok'}`);
    if (r.worktree?.branch) console.log(`worktree dalı: ${r.worktree.branch}`);
    if (r.sessionId) console.log(`oturum: ${r.sessionId} · devam için: --continue ${r.id}`);
    console.log(`günlük: ${r.log}\n--- son ${r.tail.length} satır ---`);
    console.log(r.tail.join('\n'));
    return;
  }

  console.log(`Kullanım:
  orkestra status [--probe] [--only işçi1,işçi2] [--timeout sn] [--json]
  orkestra models <işçi>
  orkestra run <işçi> [--dir proje-yolu [--write [--worktree]]] [--continue çalışma-kimliği] [--model m] [--effort ${EFFORTS.join('|')}] [--need ${Object.keys(NEEDS).join('|')}] [--timeout sn] [--stream] [--json] -- <prompt>
  orkestra runs [--limit n] [--json]          # son çalışmalar: durum, süre, son çıktıdan beri
  orkestra watch <kimlik> [--lines n] [--json] # bir çalışmanın durumu ve günlüğün son satırları
Varsayılan: ihtiyaç=${DEFAULT_NEED}, efor=${DEFAULT_EFFORT} (normal)`);
}

main().catch((err) => { console.error(`Hata: ${err.message}`); process.exitCode = 2; });
