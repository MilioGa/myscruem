import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.js';

test('Flujo completo del Product Backlog al Sprint Backlog', async () => {
  const f = await setup();
  try {
    const a = await f.owner(f.stories, 'POST', f.story, 201);
    const b = await f.owner(f.stories, 'POST', { ...f.story, title: 'Consulta' }, 201);
    await f.developer(`${f.stories}/${a.id}/estimate`, 'PATCH', { points: 5 });
    await f.developer(`${f.stories}/${b.id}/estimate`, 'PATCH', { points: 3 });
    await f.owner(`${f.stories}/order`, 'PATCH', { order: [b.id, a.id] });
    await f.owner(`${f.stories}/${a.id}/priority`, 'PATCH', { priority: 'Should have' });
    const sprint = await f.master(`/projects/${f.project.id}/sprints`, 'POST', { name: 'Sprint 2', startDate: '2026-10-23', endDate: '2026-10-26', goal: 'Backlog funcional' }, 201);
    const path = `/projects/${f.project.id}/sprints/${sprint.id}/stories`;
    await f.developer(path, 'POST', { storyId: a.id }, 201);
    await f.developer(path, 'POST', { storyId: b.id }, 201);
    const result = await f.master(path);
    assert.equal(result.points, 8);
    assert.deepEqual(result.stories.map(story => story.id), [b.id, a.id]);
    assert.equal(result.stories[1].priority, 'Should have');
    assert.equal((await f.owner(`/projects/${f.project.id}/sprints`))[0].status, 'En planificación');
    await f.outside(path, 'GET', undefined, 404);
  } finally { await f.close(); }
});
