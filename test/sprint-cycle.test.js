import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.js';

test('Inicio y cierre del sprint con regreso de historias al backlog', async () => {
  const f = await setup();
  try {
    const a = await f.owner(f.stories, 'POST', f.story, 201);
    const b = await f.owner(f.stories, 'POST', { ...f.story, title: 'Consulta' }, 201);
    await f.developer(`${f.stories}/${a.id}/estimate`, 'PATCH', { points: 5 });
    await f.developer(`${f.stories}/${b.id}/estimate`, 'PATCH', { points: 3 });
    const sprints = `/projects/${f.project.id}/sprints`;
    const sprint = await f.master(sprints, 'POST', { name: 'Sprint 3', startDate: '2026-10-28', endDate: '2026-11-03', goal: 'Tablero Kanban' }, 201);
    const path = `${sprints}/${sprint.id}`;
    await f.master(`${path}/start`, 'POST', undefined, 400);
    await f.developer(`${path}/stories`, 'POST', { storyId: a.id }, 201);
    await f.developer(`${path}/stories`, 'POST', { storyId: b.id }, 201);
    await f.developer(`${path}/start`, 'POST', undefined, 403);
    await f.owner(`${path}/start`, 'POST', undefined, 403);
    await f.outside(`${path}/start`, 'POST', undefined, 404);
    await f.master(`${path}/close`, 'POST', undefined, 400);
    await f.master(`${path}/start`, 'POST');
    await f.master(`${path}/start`, 'POST', undefined, 400);
    const active = (await f.master(sprints)).find(item => item.id === sprint.id);
    assert.equal(active.status, 'Activo');
    assert.equal(active.committed_points, 8);
    await f.developer(`${path}/stories`, 'POST', { storyId: b.id }, 400);
    const other = await f.master(sprints, 'POST', { name: 'Sprint 4', startDate: '2026-11-04', endDate: '2026-11-10', goal: 'Siguiente' }, 201);
    const c = await f.owner(f.stories, 'POST', { ...f.story, title: 'Perfil' }, 201);
    await f.developer(`${f.stories}/${c.id}/estimate`, 'PATCH', { points: 2 });
    await f.developer(`${sprints}/${other.id}/stories`, 'POST', { storyId: c.id }, 201);
    await f.master(`${sprints}/${other.id}/start`, 'POST', undefined, 409);
    f.db.prepare('UPDATE sprint_stories SET completed=1 WHERE story_id=?').run(a.id);
    await f.developer(`${path}/close`, 'POST', undefined, 403);
    const summary = await f.master(`${path}/close`, 'POST');
    assert.deepEqual(summary, { committed: 8, completed: 5, returned: 1 });
    const closed = (await f.owner(sprints)).find(item => item.id === sprint.id);
    assert.equal(closed.status, 'Cerrado');
    assert.equal(closed.completed_points, 5);
    const backlog = await f.owner(f.stories);
    assert.equal(backlog.find(story => story.id === a.id).sprint_id, sprint.id);
    assert.equal(backlog.find(story => story.id === b.id).sprint_id, null);
    assert.equal(backlog.find(story => story.id === b.id).points, 3);
    await f.master(`${path}/close`, 'POST', undefined, 400);
    await f.master(`${sprints}/${other.id}/start`, 'POST');
  } finally { await f.close(); }
});
