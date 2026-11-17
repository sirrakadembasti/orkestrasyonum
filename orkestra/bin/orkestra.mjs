#!/usr/bin/env node
// orkestra status [--probe] [--only a,b] [--json]
// orkestra models <işçi>
// orkestra run <işçi> [--dir proje-yolu [--write [--worktree]]] [--model m] [--effort e] [--need hizli|normal|derin] [--timeout sn] [--json] -- <prompt>
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATUS_TEXT } from '../src/classify.mjs';
import { DEFAULT_EFFORT, DEFAULT_NEED, EFFORTS, NEEDS } from '../src/effort.mjs';
import { resolveProjectDir, runWorker } from '../src/runner.mjs';
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

// İsteğe bağlı model ayarı: { "models": { "<işçi>": { "fast": "...", "normal": "...", "deep": "..." } } }
// Varsayılan konum skill klasörü; hangi proje klasöründen çağrılırsa çağrılsın aynı ayar kullanılır.
const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
function loadOverrides() {
  const path = resolvePath(process.env.ORKESTRA_CONFIG ?? join(SKILL_DIR, 'orkestra.config.json'));
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).models ?? {} : {};
}

const credText = (c) => {
  if (!c) return 'CLI yönetir';
  if (!c.configured) return '—';
  return `${c.source} (${c.type})${c.tokenExpired ? ' ⚠ token süresi geçmiş' : ''}`;
};

function printStatus(rows) {
  const lines = rows.map((r) => [
    r.id, r.billing ?? '', credText(r.credential),
    r.state === 'unknown' ? 'test edilmedi' : (STATUS_TEXT[r.state] ?? r.state),
    [r.models.fast, r.models.normal, r.models.deep].map((m) => m ?? 'varsayılan').join(' | '),
  ]);
  const head = ['İŞÇİ', 'FATURALAMA', 'KİMLİK', 'DURUM', 'MODELLER (hızlı | normal | derin)'];
  const widths = head.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i].length)));
  const fmt = (cols) => cols.map((c, i) => c.padEnd(widths[i])).join('  ');
  console.log(fmt(head));
  for (const l of lines) console.log(fmt(l));
}

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  const { flags, rest } = parseArgs(argv);
  const context = loadContext({ overrides: loadOverrides() });

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
    const prompt = promptParts.join(' ');
    if (!prompt) throw new Error('Prompt boş. Kullanım: orkestra run <işçi> [seçenekler] -- <prompt>');
    const write = flags.write === true;
    // Yazma, yanlış klasörde dosya değiştirmemek için yalnızca açıkça verilen proje klasöründe yapılır.
    if (write && typeof flags.dir !== 'string') throw new Error('--write için --dir ile proje klasörünü açıkça ver');
    if (flags.worktree && !write) throw new Error('--worktree yalnızca --write ile kullanılır (salt okunur işçi zaten bir şey değiştirmez)');
    const projectDir = resolveProjectDir(typeof flags.dir === 'string' ? flags.dir : undefined);
    // --worktree: işçi ana klasörde değil, kendi dalındaki ayrı bir kopyada çalışır; paralel işçiler birbirini ezmez.
    const wt = flags.worktree ? createWorktree(projectDir, worker.id) : null;
    let result;
    try {
      result = await runWorker(worker, {
        prompt,
        cwd: wt ? wt.path : projectDir,
        write,
        model: typeof flags.model === 'string' ? flags.model : undefined,
        effort: typeof flags.effort === 'string' ? flags.effort : undefined,
        need: typeof flags.need === 'string' ? flags.need : undefined,
        timeoutMs: flags.timeout ? Number(flags.timeout) * 1000 : undefined,
      });
    } catch (err) {
      if (wt) finalizeWorktree(wt, { message: `orkestra: ${worker.id} (yarım kaldı)` }); // kopya açıkta kalmasın
      throw err;
    }
    if (wt) {
      const fin = finalizeWorktree(wt, { message: `orkestra: ${worker.id} (${result.model ?? 'varsayılan'})\n\n${prompt}` });
      result.dir = projectDir;
      result.worktree = { ...fin, base: wt.base, uncommittedInMain: wt.dirty };
    }
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.error(`[${result.worker} · ${result.model ?? 'varsayılan'} · efor=${result.effort} · ${STATUS_TEXT[result.status] ?? result.status} · ${(result.durationMs / 1000).toFixed(1)} sn · ${result.access} · ${result.dir}]`);
      console.log(result.output);
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

  console.log(`Kullanım:
  orkestra status [--probe] [--only işçi1,işçi2] [--timeout sn] [--json]
  orkestra models <işçi>
  orkestra run <işçi> [--dir proje-yolu [--write [--worktree]]] [--model m] [--effort ${EFFORTS.join('|')}] [--need ${Object.keys(NEEDS).join('|')}] [--timeout sn] [--json] -- <prompt>
Varsayılan: ihtiyaç=${DEFAULT_NEED}, efor=${DEFAULT_EFFORT} (normal)`);
}

main().catch((err) => { console.error(`Hata: ${err.message}`); process.exitCode = 2; });
