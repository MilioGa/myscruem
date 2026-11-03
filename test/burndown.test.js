import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.js';

test('Burndown con línea ideal, línea real y permisos', async () => {
  let current = new Date(2026, 9, 28, 10);
  const f = await setup({ now: () => current });
  try {
    const a = await f.owner(f.stories, 'POST', f.story, 201);
    const b = await f.owner(f.stories, 'POST', { ...f.story, title: 'Consulta' }, 201);
    await f.developer(`${f.stories}/${a.id}/estimate`, 'PATCH', { points: 8 });
    await f.developer(`${f.stories}/${b.id}/estimate`, 'PATCH', { points: 5 });
    const sprints = `/projects/${f.project.id}/sprints`;
    const sprint = await f.master(sprints, 'POST', { name: 'Sprint 3', startDate: '2026-10-28', endDate: '2026-11-03', goal: 'Burndown' }, 201);
    const path = `${sprints}/${sprint.id}`;
    const chart = `${path}/burndown`;
    let data = await f.owner(chart);
    assert.equal(data.committed, 0);
    await f.developer(`${path}/stories`, 'POST', { storyId: a.id }, 201);
    await f.developer(`${path}/stories`, 'POST', { storyId: b.id }, 201);
    data = await f.developer(chart);
    assert.equal(data.committed, 13);
    assert.equal(data.days.length, 7);
    assert.deepEqual(data.days.map(day => day.ideal), [13, 10.8, 8.7, 6.5, 4.3, 2.2, 0]);
    assert.ok(data.days.every(day => day.remaining === null));
    await f.master(`${path}/start`, 'POST');
    const developerId = (await f.admin('/users')).find(user => user.role === 'Developer').id;
    const tasks = `/projects/${f.project.id}/tasks`;
    const t1 = await f.developer(tasks, 'POST', { title: 'Alta', storyId: b.id, assigneeId: developerId }, 201);
    await f.developer(tasks, 'POST', { title: 'Formulario', storyId: a.id, assigneeId: developerId }, 201);
    data = await f.master(chart);
    assert.deepEqual(data.days.map(day => day.remaining), [13, null, null, null, null, null, null]);
    current = new Date(2026, 9, 30, 18);
    await f.developer(`/projects/${f.project.id}/tasks/${t1.id}/status`, 'PATCH', { status: 'Terminado' });
    data = await f.owner(chart);
    assert.deepEqual(data.days.map(day => day.remaining), [13, 13, 8, null, null, null, null]);
    assert.equal(data.completed, 5);
    assert.equal(data.remaining, 8);
    current = new Date(2026, 10, 3, 17);
    const summary = await f.master(`${path}/close`, 'POST');
    assert.equal(summary.completed, 5);
    data = await f.developer(chart);
    assert.equal(data.sprint.status, 'Cerrado');
    assert.deepEqual(data.days.map(day => day.remaining), [13, 13, 8, 8, 8, 8, 8]);
    assert.equal(data.completed, 5);
    await f.outside(chart, 'GET', undefined, 404);
    await f.developer(`${sprints}/999/burndown`, 'GET', undefined, 404);
  } finally { await f.close(); }
});
