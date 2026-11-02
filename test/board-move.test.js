import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.js';

test('Mover tarjetas guarda el estado, avisa del cambio y respeta permisos', async () => {
  const f = await setup();
  try {
    const story = await f.owner(f.stories, 'POST', f.story, 201);
    await f.developer(`${f.stories}/${story.id}/estimate`, 'PATCH', { points: 5 });
    const sprints = `/projects/${f.project.id}/sprints`;
    const sprint = await f.master(sprints, 'POST', { name: 'Sprint 3', startDate: '2026-10-28', endDate: '2026-11-03', goal: 'Tablero' }, 201);
    await f.developer(`${sprints}/${sprint.id}/stories`, 'POST', { storyId: story.id }, 201);
    const developerId = (await f.admin('/users')).find(user => user.role === 'Developer').id;
    const insert = f.db.prepare('INSERT INTO tasks(sprint_id,story_id,title,assignee_id) VALUES (?,?,?,?)');
    const a = Number(insert.run(sprint.id, story.id, 'Formulario', developerId).lastInsertRowid);
    const b = Number(insert.run(sprint.id, story.id, 'Pruebas', developerId).lastInsertRowid);
    const move = id => `/projects/${f.project.id}/tasks/${id}/status`;
    await f.developer(move(a), 'PATCH', { status: 'En curso' }, 404);
    await f.master(`${sprints}/${sprint.id}/start`, 'POST');
    const version = `/projects/${f.project.id}/board/version`;
    const before = await f.owner(version);
    assert.equal(before.sprintId, sprint.id);
    await f.owner(move(a), 'PATCH', { status: 'En curso' }, 403);
    await f.master(move(a), 'PATCH', { status: 'En curso' }, 403);
    await f.outside(move(a), 'PATCH', { status: 'En curso' }, 404);
    await f.developer(move(a), 'PATCH', { status: 'Bloqueada' }, 400);
    await f.developer(move(999), 'PATCH', { status: 'En curso' }, 404);
    await f.developer(move(a), 'PATCH', { status: 'En curso' });
    const after = await f.master(version);
    assert.equal(after.version, before.version + 1);
    let board = await f.owner(`/projects/${f.project.id}/board`);
    assert.equal(board.tasks.find(task => task.id === a).status, 'En curso');
    assert.equal(board.sprint.board_version, after.version);
    await f.developer(move(a), 'PATCH', { status: 'Terminado' });
    board = await f.developer(`/projects/${f.project.id}/board`);
    assert.equal(board.stories[0].completed, 0);
    await f.developer(move(b), 'PATCH', { status: 'Terminado' });
    board = await f.developer(`/projects/${f.project.id}/board`);
    assert.equal(board.stories[0].completed, 1);
    await f.developer(move(b), 'PATCH', { status: 'En revisión' });
    board = await f.developer(`/projects/${f.project.id}/board`);
    assert.equal(board.stories[0].completed, 0);
    assert.deepEqual(board.tasks.map(task => task.status).sort(), ['En revisión', 'Terminado']);
  } finally { await f.close(); }
});
