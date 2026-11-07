import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.js';

test('Épicas: alta, edición, agrupación de historias y permisos del Product Owner', async () => {
  const f = await setup();
  try {
    const epics = `/projects/${f.project.id}/epics`;
    const a = await f.owner(f.stories, 'POST', f.story, 201);
    const b = await f.owner(f.stories, 'POST', { ...f.story, title: 'Consulta' }, 201);
    await f.developer(`${f.stories}/${a.id}/estimate`, 'PATCH', { points: 5 });
    await f.developer(`${f.stories}/${b.id}/estimate`, 'PATCH', { points: 3 });
    for (const request of [f.developer, f.master, f.otherOwner, f.admin]) await request(epics, 'POST', { name: 'Clientes' }, 403);
    await f.outside(epics, 'POST', { name: 'Clientes' }, 404);
    await f.owner(epics, 'POST', { name: '' }, 400);
    const clientes = await f.owner(epics, 'POST', { name: 'Clientes', description: 'Alta y consulta de clientes' }, 201);
    await f.owner(epics, 'POST', { name: 'Clientes' }, 409);
    const pedidos = await f.owner(epics, 'POST', { name: 'Pedidos' }, 201);
    await f.owner(`${epics}/${pedidos.id}`, 'PATCH', { name: 'Pedidos y envíos', description: '' });
    await f.owner(`${epics}/${pedidos.id}`, 'PATCH', { name: 'Clientes' }, 409);
    const assign = id => `${f.stories}/${id}/epic`;
    await f.developer(assign(a.id), 'PATCH', { epicId: clientes.id }, 403);
    await f.owner(assign(a.id), 'PATCH', { epicId: 9999 }, 400);
    await f.owner(assign(a.id), 'PATCH', { epicId: clientes.id });
    await f.owner(assign(b.id), 'PATCH', { epicId: clientes.id });
    let list = await f.developer(epics);
    assert.deepEqual(list.map(epic => [epic.name, epic.stories, epic.points]), [['Clientes', 2, 8], ['Pedidos y envíos', 0, 0]]);
    await f.owner(assign(b.id), 'PATCH', { epicId: null });
    list = await f.master(epics);
    assert.deepEqual(list.map(epic => epic.points), [5, 0]);
    const stories = await f.developer(f.stories);
    assert.equal(stories.find(story => story.id === a.id).epic_id, clientes.id);
    assert.equal(stories.find(story => story.id === b.id).epic_id, null);
    const other = await f.owner(`/projects/${f.secondProject.id}/epics`, 'POST', { name: 'Otro' }, 201);
    await f.owner(assign(a.id), 'PATCH', { epicId: other.id }, 400);
    assert.deepEqual(await f.outside(epics, 'GET', undefined, 404), { error: 'Proyecto no encontrado.' });
  } finally { await f.close(); }
});

test('Detalle de la historia con sus tareas y su avance', async () => {
  const f = await setup();
  try {
    const story = await f.owner(f.stories, 'POST', f.story, 201);
    await f.developer(`${f.stories}/${story.id}/estimate`, 'PATCH', { points: 5 });
    const detail = `${f.stories}/${story.id}/tasks`;
    assert.deepEqual((await f.owner(detail)).progress, 0);
    const sprints = `/projects/${f.project.id}/sprints`;
    const sprint = await f.master(sprints, 'POST', { name: 'Sprint 4', startDate: '2026-11-04', endDate: '2026-11-10', goal: 'Épicas' }, 201);
    await f.developer(`${sprints}/${sprint.id}/stories`, 'POST', { storyId: story.id }, 201);
    await f.master(`${sprints}/${sprint.id}/start`, 'POST');
    const developerId = (await f.admin('/users')).find(user => user.role === 'Developer').id;
    const tasks = `/projects/${f.project.id}/tasks`;
    const t1 = await f.developer(tasks, 'POST', { title: 'Formulario', storyId: story.id, assigneeId: developerId }, 201);
    await f.developer(tasks, 'POST', { title: 'Pruebas', storyId: story.id, assigneeId: developerId }, 201);
    await f.developer(`/projects/${f.project.id}/tasks/${t1.id}/status`, 'PATCH', { status: 'Terminado' });
    const result = await f.owner(detail);
    assert.deepEqual([result.done, result.total, result.progress], [1, 2, 50]);
    assert.deepEqual(result.tasks.map(task => [task.title, task.status, task.sprint]).sort(), [['Formulario', 'Terminado', 'Sprint 4'], ['Pruebas', 'Por hacer', 'Sprint 4']]);
    await f.outside(detail, 'GET', undefined, 404);
    await f.owner(`${f.stories}/9999/tasks`, 'GET', undefined, 404);
  } finally { await f.close(); }
});
