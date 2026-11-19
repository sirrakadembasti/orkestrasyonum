import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { addTask, initPlan, planPath, readPlan, readyTasks, setTask, updatePlan } from '../src/plan.mjs';

const project = () => mkdtempSync(join(tmpdir(), 'orkestra-plan-'));

test('plan: proje içinde .orkestra/plan.json oluşturulur, ikinci kez oluşturulamaz', () => {
  const dir = project();
  const plan = initPlan(dir, 'Giriş sayfası yap');
  assert.equal(planPath(dir), join(dir, '.orkestra', 'plan.json'));
  assert.ok(existsSync(planPath(dir)));
  assert.equal(plan.goal, 'Giriş sayfası yap');
  assert.deepEqual(plan.tasks, []);
  assert.throws(() => initPlan(dir, 'başka'), /plan zaten var/);
  assert.throws(() => readPlan(project()), /plan yok/);
});

test('plan: görev eklenir, kimlik sırayla verilir, bağımlılık doğrulanır', () => {
  const dir = project();
  initPlan(dir, 'hedef');
  const t1 = updatePlan(dir, (p) => addTask(p, { title: 'API yaz', worker: 'codex' }));
  const t2 = updatePlan(dir, (p) => addTask(p, { title: 'Test yaz', depends: ['t1'] }));
  assert.equal(t1.id, 't1');
  assert.equal(t2.id, 't2');
  const plan = readPlan(dir);
  assert.deepEqual(plan.tasks.map((t) => [t.id, t.status, t.worker, t.depends]), [['t1', 'todo', 'codex', []], ['t2', 'todo', null, ['t1']]]);
  assert.throws(() => updatePlan(dir, (p) => addTask(p, { title: 'x', depends: ['t9'] })), /bilinmeyen görev: t9/);
  assert.throws(() => updatePlan(dir, (p) => addTask(p, { title: '' })), /başlık/);
});

test('plan: durum güncellenir, geçmiş tutulur, geçersiz durum reddedilir', () => {
  const dir = project();
  initPlan(dir, 'hedef');
  updatePlan(dir, (p) => addTask(p, { title: 'API yaz' }));
  updatePlan(dir, (p) => setTask(p, 't1', { status: 'doing', run: 'codex-1', note: 'başladı' }));
  updatePlan(dir, (p) => setTask(p, 't1', { status: 'review', branch: 'orkestra/codex-1' }));
  const t = readPlan(dir).tasks[0];
  assert.equal(t.status, 'review');
  assert.deepEqual(t.runs, ['codex-1']);
  assert.equal(t.branch, 'orkestra/codex-1');
  assert.deepEqual(t.history.map((h) => h.status), ['doing', 'review']);
  assert.equal(t.history[0].note, 'başladı');
  assert.throws(() => updatePlan(dir, (p) => setTask(p, 't1', { status: 'bitti-gibi' })), /geçersiz durum/);
  assert.throws(() => updatePlan(dir, (p) => setTask(p, 't7', { status: 'done' })), /bilinmeyen görev: t7/);
});

test('plan: hazır görevler yalnızca bağımlılıkları bitmiş "todo" görevlerdir', () => {
  const dir = project();
  initPlan(dir, 'hedef');
  for (const [title, depends] of [['a', []], ['b', ['t1']], ['c', []], ['d', ['t2', 't3']]]) {
    updatePlan(dir, (p) => addTask(p, { title, depends }));
  }
  assert.deepEqual(readyTasks(readPlan(dir)).map((t) => t.id), ['t1', 't3']);
  updatePlan(dir, (p) => setTask(p, 't1', { status: 'review' }));
  assert.deepEqual(readyTasks(readPlan(dir)).map((t) => t.id), ['t3'], '"doğrulanacak" bitmiş sayılmaz');
  updatePlan(dir, (p) => setTask(p, 't1', { status: 'done' }));
  updatePlan(dir, (p) => setTask(p, 't3', { status: 'done' }));
  assert.deepEqual(readyTasks(readPlan(dir)).map((t) => t.id), ['t2']);
});

test('plan: paralel güncellemeler kilitle sıraya girer, hiçbiri kaybolmaz', async () => {
  const dir = project();
  initPlan(dir, 'hedef');
  const url = new URL('../src/plan.mjs', import.meta.url).href;
  const code = `import { updatePlan, addTask } from ${JSON.stringify(url)}; updatePlan(process.argv[1], (p) => addTask(p, { title: process.argv[2] }));`;
  const one = (i) => new Promise((res, rej) => {
    const c = spawn(process.execPath, ['--input-type=module', '-e', code, dir, `görev ${i}`], { stdio: 'ignore' });
    c.on('close', (codeExit) => (codeExit === 0 ? res() : rej(new Error(`çıkış ${codeExit}`))));
  });
  await Promise.all(Array.from({ length: 40 }, (_, i) => one(i)));
  const plan = JSON.parse(readFileSync(planPath(dir), 'utf8'));
  assert.equal(plan.tasks.length, 40);
  assert.deepEqual(plan.tasks.map((t) => t.id).sort(), Array.from({ length: 40 }, (_, i) => `t${i + 1}`).sort());
  assert.ok(!existsSync(planPath(dir) + '.lock'), 'kilit dosyası kalmamalı');
});
