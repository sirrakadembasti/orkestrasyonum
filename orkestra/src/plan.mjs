// Beynin (ana ajanın) projedeki kalıcı planı: <proje>/.orkestra/plan.json
// Hedef, görevler, bağımlılıklar, görevin işçisi, çalışma kimlikleri, dal ve durum geçmişi.
// Kararları beyin verir; bu modül yalnızca planı güvenle saklar ve sorgular.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// todo → doing → review (işçi bitirdi, beyin doğrulayacak) → done | failed | blocked
export const TASK_STATUSES = ['todo', 'doing', 'review', 'done', 'failed', 'blocked'];

export const planPath = (dir) => join(dir, '.orkestra', 'plan.json');

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const STALE_LOCK_MS = 30_000;

// Windows'ta silinmekte olan bir dosyayı açmak/üzerine yazmak EEXIST yerine EPERM/EBUSY/EACCES verebilir;
// bunlar da "meşgul, tekrar dene" demektir (40 eşzamanlı süreçle yeniden üretildi).
const BUSY = new Set(['EEXIST', 'EPERM', 'EBUSY', 'EACCES']);

// Paralel işçiler aynı planı güncelleyebilir: dosya kilidi ile sıraya sok.
function withLock(file, fn) {
  const lock = `${file}.lock`;
  const deadline = Date.now() + 15_000;
  for (;;) {
    try { closeSync(openSync(lock, 'wx')); break; } catch (err) {
      if (!BUSY.has(err.code)) throw err;
      try { if (Date.now() - statSync(lock).mtimeMs > STALE_LOCK_MS) unlinkSync(lock); } catch { /* başka süreç sildi */ }
      if (Date.now() > deadline) throw new Error(`plan kilidi alınamadı: ${lock}`);
      sleep(20 + Math.floor(Math.random() * 30));
    }
  }
  try { return fn(); } finally { try { unlinkSync(lock); } catch { /* yok */ } }
}

function write(file, plan) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(plan, null, 2));
  // Yarım yazılmış plan oluşmasın diye yeniden adlandır; hedef o an başka süreçte açıksa (okuyucu, tarayıcı) kısa süre dene.
  for (let i = 0; ; i++) {
    try { renameSync(tmp, file); return; } catch (err) {
      if (!BUSY.has(err.code) || i >= 50) throw err;
      sleep(20);
    }
  }
}

export function initPlan(dir, goal, { now = new Date() } = {}) {
  const file = planPath(dir);
  if (existsSync(file)) throw new Error(`plan zaten var: ${file}`);
  mkdirSync(join(dir, '.orkestra'), { recursive: true });
  const plan = { goal, createdAt: now.toISOString(), updatedAt: now.toISOString(), tasks: [] };
  write(file, plan);
  return plan;
}

export function readPlan(dir) {
  const file = planPath(dir);
  if (!existsSync(file)) throw new Error(`plan yok: ${file} (önce: orkestra plan init --dir <proje> -- "<hedef>")`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

// fn(plan) planı değiştirir; dönüş değeri updatePlan'ın dönüş değeridir.
export function updatePlan(dir, fn) {
  const file = planPath(dir);
  return withLock(file, () => {
    const plan = readPlan(dir);
    const result = fn(plan);
    plan.updatedAt = new Date().toISOString();
    write(file, plan);
    return result;
  });
}

const findTask = (plan, id) => {
  const task = plan.tasks.find((t) => t.id === id);
  if (!task) throw new Error(`bilinmeyen görev: ${id}`);
  return task;
};

export function addTask(plan, { title, worker = null, depends = [], note = null }) {
  if (!title?.trim()) throw new Error('görev için başlık gerekli');
  for (const d of depends) findTask(plan, d);
  const n = plan.tasks.reduce((max, t) => Math.max(max, Number(t.id.slice(1)) || 0), 0) + 1;
  const now = new Date().toISOString();
  const task = {
    id: `t${n}`, title: title.trim(), worker, depends, status: 'todo',
    runs: [], branch: null, notes: note ? [note] : [], history: [], createdAt: now, updatedAt: now,
  };
  plan.tasks.push(task);
  return task;
}

export function setTask(plan, id, { status, worker, run, branch, note } = {}) {
  const task = findTask(plan, id);
  if (status !== undefined && !TASK_STATUSES.includes(status)) {
    throw new Error(`geçersiz durum: ${status} (geçerli: ${TASK_STATUSES.join(', ')})`);
  }
  const now = new Date().toISOString();
  if (worker !== undefined) task.worker = worker;
  if (run && !task.runs.includes(run)) task.runs.push(run);
  if (branch !== undefined) task.branch = branch;
  if (note) task.notes.push(note);
  if (status !== undefined) {
    task.status = status;
    task.history.push({ at: now, status, ...(run ? { run } : {}), ...(note ? { note } : {}) });
  }
  task.updatedAt = now;
  return task;
}

// Başlanabilir görevler: "todo" ve tüm bağımlılıkları "done".
export function readyTasks(plan) {
  const done = new Set(plan.tasks.filter((t) => t.status === 'done').map((t) => t.id));
  return plan.tasks.filter((t) => t.status === 'todo' && t.depends.every((d) => done.has(d)));
}
