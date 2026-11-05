import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.js';

test('Carga del tablero y del Burndown con 200 tareas creadas desde la API', async () => {
  const f = await setup();
  try {
    const sprints = `/projects/${f.project.id}/sprints`;
    const sprint = await f.master(sprints, 'POST', { name: 'Sprint de carga', startDate: '2026-10-28', endDate: '2026-11-03', goal: 'Carga' }, 201);
    const ids = [];
    for (let i = 0; i < 4; i++) {
      const story = await f.owner(f.stories, 'POST', { ...f.story, title: `Historia ${i + 1}` }, 201);
      await f.developer(`${f.stories}/${story.id}/estimate`, 'PATCH', { points: 3 });
      await f.developer(`${sprints}/${sprint.id}/stories`, 'POST', { storyId: story.id }, 201);
      ids.push(story.id);
    }
    await f.master(`${sprints}/${sprint.id}/start`, 'POST');
    const developerId = (await f.admin('/users')).find(user => user.role === 'Developer').id;
    for (let i = 0; i < 200; i++) await f.developer(`/projects/${f.project.id}/tasks`, 'POST', { title: `Tarea ${i + 1}`, storyId: ids[i % 4], assigneeId: developerId }, 201);
    let start = performance.now();
    const board = await f.developer(`/projects/${f.project.id}/board`);
    assert.ok(performance.now() - start < 2000);
    assert.equal(board.tasks.length, 200);
    start = performance.now();
    const chart = await f.master(`${sprints}/${sprint.id}/burndown`);
    assert.ok(performance.now() - start < 2000);
    assert.equal(chart.committed, 12);
  } finally { await f.close(); }
});
