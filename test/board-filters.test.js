import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.js';

test('Etiqueta, tipo y filtros combinables del tablero', async () => {
  const f = await setup();
  try {
    const second = await f.admin('/users', 'POST', { name: 'segundo', email: 'segundo@example.com', role: 'Developer' }, 201);
    f.db.prepare("UPDATE users SET status='Activo' WHERE id=?").run(second.id);
    const developerId = (await f.admin('/users')).find(user => user.name === 'developer').id;
    const story = await f.owner(f.stories, 'POST', f.story, 201);
    await f.developer(`${f.stories}/${story.id}/estimate`, 'PATCH', { points: 5 });
    const sprints = `/projects/${f.project.id}/sprints`;
    const sprint = await f.master(sprints, 'POST', { name: 'Sprint 4', startDate: '2026-11-04', endDate: '2026-11-10', goal: 'Filtros' }, 201);
    await f.developer(`${sprints}/${sprint.id}/stories`, 'POST', { storyId: story.id }, 201);
    await f.master(`${sprints}/${sprint.id}/start`, 'POST');
    const tasks = `/projects/${f.project.id}/tasks`;
    const base = { storyId: story.id, assigneeId: developerId };
    await f.developer(tasks, 'POST', { ...base, title: 'Tipo inválido', type: 'Otro' }, 400);
    await f.developer(tasks, 'POST', { ...base, title: 'Etiqueta larga', label: 'x'.repeat(41) }, 400);
    await f.developer(tasks, 'POST', { ...base, title: 'Formulario', label: 'Frontend', type: 'Desarrollo' }, 201);
    await f.developer(tasks, 'POST', { ...base, title: 'API', label: 'Backend' }, 201);
    await f.developer(tasks, 'POST', { ...base, title: 'Pruebas de API', label: 'Backend', type: 'Pruebas', assigneeId: second.id }, 201);
    await f.developer(tasks, 'POST', { ...base, title: 'Manual', type: 'Documentación', assigneeId: second.id }, 201);
    const board = `/projects/${f.project.id}/board`;
    const all = await f.owner(board);
    assert.deepEqual(all.types, ['Desarrollo', 'Pruebas', 'Diseño', 'Documentación']);
    assert.deepEqual(all.labels, ['Backend', 'Frontend']);
    assert.equal(all.tasks.find(task => task.title === 'API').type, 'Desarrollo');
    const titles = async query => (await f.developer(`${board}?${query}`)).tasks.map(task => task.title).sort();
    assert.deepEqual(await titles(`assignee=${second.id}`), ['Manual', 'Pruebas de API']);
    assert.deepEqual(await titles('label=Backend'), ['API', 'Pruebas de API']);
    assert.deepEqual(await titles('type=Pruebas'), ['Pruebas de API']);
    assert.deepEqual(await titles(`label=Backend&assignee=${developerId}`), ['API']);
    assert.deepEqual(await titles('label=Backend&type=Documentación'), []);
    assert.equal((await f.developer(board)).tasks.length, 4);
  } finally { await f.close(); }
});
