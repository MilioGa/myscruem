import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.js';

test('Flujo completo del sprint 3: tablero Kanban y Burndown', async () => {
  let current = new Date(2026, 9, 28, 9);
  const f = await setup({ now: () => current });
  try {
    const a = await f.owner(f.stories, 'POST', f.story, 201);
    const b = await f.owner(f.stories, 'POST', { ...f.story, title: 'Consulta' }, 201);
    await f.developer(`${f.stories}/${a.id}/estimate`, 'PATCH', { points: 5 });
    await f.developer(`${f.stories}/${b.id}/estimate`, 'PATCH', { points: 3 });
    const sprints = `/projects/${f.project.id}/sprints`;
    const sprint = await f.master(sprints, 'POST', { name: 'Sprint 3', startDate: '2026-10-28', endDate: '2026-11-03', goal: 'Tablero y Burndown' }, 201);
    const path = `${sprints}/${sprint.id}`;
    await f.developer(`${path}/stories`, 'POST', { storyId: a.id }, 201);
    await f.developer(`${path}/stories`, 'POST', { storyId: b.id }, 201);
    await f.master(`${path}/start`, 'POST');
    const developerId = (await f.admin('/users')).find(user => user.role === 'Developer').id;
    const task = await f.developer(`/projects/${f.project.id}/tasks`, 'POST', { title: 'Registro', storyId: a.id, assigneeId: developerId }, 201);
    await f.developer(`/projects/${f.project.id}/tasks`, 'POST', { title: 'Consulta', storyId: b.id, assigneeId: developerId }, 201);
    current = new Date(2026, 9, 29, 12);
    for (const status of ['En curso', 'En revisión', 'Terminado']) await f.developer(`/projects/${f.project.id}/tasks/${task.id}/status`, 'PATCH', { status });
    const board = await f.owner(`/projects/${f.project.id}/board`);
    assert.deepEqual(board.stories.map(story => [story.id, story.completed]), [[a.id, 1], [b.id, 0]]);
    const chart = await f.master(`${path}/burndown`);
    assert.deepEqual(chart.days.slice(0, 2).map(day => day.remaining), [8, 3]);
    assert.deepEqual([chart.committed, chart.completed, chart.remaining], [8, 5, 3]);
    current = new Date(2026, 10, 3, 18);
    assert.deepEqual(await f.master(`${path}/close`, 'POST'), { committed: 8, completed: 5, returned: 1 });
    assert.equal((await f.developer(`/projects/${f.project.id}/board`)).sprint, null);
    const backlog = await f.owner(f.stories);
    assert.equal(backlog.find(story => story.id === b.id).sprint_id, null);
    const next = await f.master(sprints, 'POST', { name: 'Sprint 4', startDate: '2026-11-04', endDate: '2026-11-10', goal: 'Seguimiento' }, 201);
    await f.developer(`${sprints}/${next.id}/stories`, 'POST', { storyId: b.id }, 201);
    await f.developer(`${sprints}/${next.id}/stories`, 'POST', { storyId: a.id }, 409);
  } finally { await f.close(); }
});
