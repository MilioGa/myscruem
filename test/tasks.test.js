import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.js';

test('Crear y asignar tareas desde el tablero', async () => {
  const f = await setup();
  try {
    const story = await f.owner(f.stories, 'POST', f.story, 201);
    const outsideStory = await f.owner(f.stories, 'POST', { ...f.story, title: 'Fuera del sprint' }, 201);
    await f.developer(`${f.stories}/${story.id}/estimate`, 'PATCH', { points: 5 });
    const sprints = `/projects/${f.project.id}/sprints`;
    const sprint = await f.master(sprints, 'POST', { name: 'Sprint 3', startDate: '2026-10-28', endDate: '2026-11-03', goal: 'Tablero' }, 201);
    await f.developer(`${sprints}/${sprint.id}/stories`, 'POST', { storyId: story.id }, 201);
    const users = await f.admin('/users');
    const developerId = users.find(user => user.role === 'Developer').id;
    const masterId = users.find(user => user.role === 'Scrum Master').id;
    const tasks = `/projects/${f.project.id}/tasks`;
    const task = { title: 'Formulario de pedido', storyId: story.id, assigneeId: developerId, description: 'Campos obligatorios' };
    await f.developer(tasks, 'POST', task, 400);
    await f.master(`${sprints}/${sprint.id}/start`, 'POST');
    await f.owner(tasks, 'POST', task, 403);
    await f.master(tasks, 'POST', task, 403);
    await f.outside(tasks, 'POST', task, 404);
    for (const invalid of [{ title: '' }, { title: '   ' }, { title: undefined }, { storyId: outsideStory.id }, { storyId: '1' }, { assigneeId: masterId }, { assigneeId: 9999 }, { description: 'x'.repeat(1001) }]) {
      await f.developer(tasks, 'POST', { ...task, ...invalid }, 400);
    }
    assert.equal((await f.developer(`/projects/${f.project.id}/board`)).tasks.length, 0);
    const { version } = await f.developer(`/projects/${f.project.id}/board/version`);
    const created = await f.developer(tasks, 'POST', task, 201);
    await f.developer(tasks, 'POST', { ...task, title: 'Sin descripción', description: undefined }, 201);
    const board = await f.master(`/projects/${f.project.id}/board`);
    const saved = board.tasks.find(item => item.id === created.id);
    assert.equal(saved.status, 'Por hacer');
    assert.equal(saved.assignee_id, developerId);
    assert.equal(saved.title, 'Formulario de pedido');
    assert.equal(board.tasks.length, 2);
    assert.equal(board.sprint.board_version, version + 2);
    await f.developer(`/projects/${f.project.id}/tasks/${created.id}/status`, 'PATCH', { status: 'Terminado' });
    await f.developer(tasks, 'POST', { ...task, title: 'Ajuste' }, 201);
    assert.equal((await f.developer(`/projects/${f.project.id}/board`)).stories[0].completed, 0);
    await f.outside(`/projects/${f.project.id}/board`, 'GET', undefined, 404);
  } finally { await f.close(); }
});
