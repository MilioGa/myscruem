import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.js';

test('Sprints en planificación y validación de fechas y permisos', async () => {
  const f = await setup();
  try {
    const path = `/projects/${f.project.id}/sprints`;
    const sprint = { name: 'Sprint 2', startDate: '2026-10-23', endDate: '2026-10-26', goal: 'Backlog funcional' };
    await f.owner(path, 'POST', sprint, 403);
    await f.developer(path, 'POST', sprint, 403);
    await f.outside(path, 'GET', undefined, 404);
    for (const invalid of [{ name: '' }, { goal: ' ' }, { startDate: '2026-02-30' }, { startDate: '2026-13-01' }, { endDate: '2026-10-23' }, { endDate: '2026-10-22' }, { startDate: null }]) {
      await f.master(path, 'POST', { ...sprint, ...invalid }, 400);
    }
    assert.deepEqual(await f.master(path), []);
    const a = await f.master(path, 'POST', sprint, 201);
    const b = await f.master(path, 'POST', { ...sprint, name: 'Sprint 3' }, 201);
    const list = await f.developer(path);
    assert.equal(list.length, 2);
    assert.ok(list.every(item => item.status === 'En planificación'));
    f.db.prepare("UPDATE sprints SET status='Activo' WHERE id=?").run(a.id);
    assert.throws(() => f.db.prepare("UPDATE sprints SET status='Activo' WHERE id=?").run(b.id));
    assert.equal(f.db.prepare("SELECT COUNT(*) AS total FROM sprints WHERE status='Activo' AND project_id=?").get(f.project.id).total, 1);
    assert.equal((await f.owner(path)).length, 2);
  } finally { await f.close(); }
});
