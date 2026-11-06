import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.js';

test('Los responsables del tablero se limitan al equipo del proyecto', async () => {
  const f = await setup();
  try {
    const second = await f.admin('/users', 'POST', { name: 'segundo', email: 'segundo@example.com', role: 'Developer' }, 201);
    f.db.prepare("UPDATE users SET status='Activo' WHERE id=?").run(second.id);
    const developerId = (await f.admin('/users')).find(user => user.name === 'developer').id;
    const story = await f.owner(f.stories, 'POST', f.story, 201);
    await f.developer(`${f.stories}/${story.id}/estimate`, 'PATCH', { points: 3 });
    const sprints = `/projects/${f.project.id}/sprints`;
    const sprint = await f.master(sprints, 'POST', { name: 'Sprint 4', startDate: '2026-11-04', endDate: '2026-11-10', goal: 'Equipos' }, 201);
    await f.developer(`${sprints}/${sprint.id}/stories`, 'POST', { storyId: story.id }, 201);
    await f.master(`${sprints}/${sprint.id}/start`, 'POST');
    const board = `/projects/${f.project.id}/board`;
    assert.deepEqual((await f.developer(board)).members.map(member => member.name), ['developer', 'segundo']);
    await f.admin('/teams', 'POST', { name: 'Equipo Portal', projectId: f.project.id, memberIds: [second.id] }, 201);
    assert.deepEqual((await f.developer(board)).members.map(member => member.name), ['segundo']);
    const tasks = `/projects/${f.project.id}/tasks`;
    await f.developer(tasks, 'POST', { title: 'Fuera del equipo', storyId: story.id, assigneeId: developerId }, 400);
    await f.developer(tasks, 'POST', { title: 'Dentro del equipo', storyId: story.id, assigneeId: second.id }, 201);
  } finally { await f.close(); }
});
