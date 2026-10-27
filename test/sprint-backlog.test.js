import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.js';

test('Selección de historias sin duplicados y suma persistente', async () => {
  const f = await setup();
  try {
    const a = await f.owner(f.stories, 'POST', f.story, 201);
    const b = await f.owner(f.stories, 'POST', { ...f.story, title: 'Consulta' }, 201);
    const other = await f.owner(`/projects/${f.secondProject.id}/stories`, 'POST', f.story, 201);
    const sprint = await f.master(`/projects/${f.project.id}/sprints`, 'POST', { name: 'Sprint 2', startDate: '2026-10-23', endDate: '2026-10-26', goal: 'Registro y consulta' }, 201);
    const path = `/projects/${f.project.id}/sprints/${sprint.id}/stories`;
    await f.owner(path, 'POST', { storyId: a.id }, 403);
    await f.outside(path, 'GET', undefined, 404);
    await f.developer(path, 'POST', { storyId: other.id }, 404);
    await f.developer(path, 'POST', { storyId: a.id }, 400);
    await f.developer(`${f.stories}/${a.id}/estimate`, 'PATCH', { points: 21 });
    await f.developer(path, 'POST', { storyId: a.id }, 400);
    await f.developer(`${f.stories}/${a.id}/estimate`, 'PATCH', { points: 5 });
    await f.developer(`${f.stories}/${b.id}/estimate`, 'PATCH', { points: 3 });
    await f.developer(path, 'POST', { storyId: a.id }, 201);
    await f.developer(path, 'POST', { storyId: a.id }, 409);
    await f.developer(path, 'POST', { storyId: b.id }, 201);
    assert.equal((await f.master(path)).points, 8);
    assert.equal((await f.owner(path)).stories.length, 2);
    await f.developer(`${f.stories}/${a.id}/estimate`, 'PATCH', { points: 21 }, 400);
    await f.developer(`${f.stories}/${a.id}/estimate`, 'PATCH', { points: 8 });
    assert.equal((await f.master(path)).points, 11);
    await f.developer(`${path}/${b.id}`, 'DELETE');
    assert.equal((await f.owner(path)).points, 8);
    assert.equal((await f.owner(f.stories)).find(story => story.id === b.id).sprint_id, null);
    f.db.prepare("UPDATE sprints SET status='Activo' WHERE id=?").run(sprint.id);
    await f.developer(path, 'POST', { storyId: b.id }, 400);
    await f.developer(`${path}/${a.id}`, 'DELETE', undefined, 400);
  } finally { await f.close(); }
});
