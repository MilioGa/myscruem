import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.js';

test('Épicas: el Scrum Master las crea con color y el Product Owner asigna historias', async () => {
  const f = await setup();
  try {
    const epics = `/projects/${f.project.id}/epics`;
    const a = await f.owner(f.stories, 'POST', f.story, 201);
    const b = await f.owner(f.stories, 'POST', { ...f.story, title: 'Consulta' }, 201);
    await f.developer(`${f.stories}/${a.id}/estimate`, 'PATCH', { points: 5 });
    await f.developer(`${f.stories}/${b.id}/estimate`, 'PATCH', { points: 3 });
    const pedido = { name: 'Pedidos', description: 'Pedidos y envíos', color: '#c0392b' };
    for (const request of [f.developer, f.owner, f.otherOwner, f.admin]) assert.equal((await request(epics, 'POST', pedido, 403)).error, 'Solo el Scrum Master puede crear y editar épicas.');
    await f.outside(epics, 'POST', pedido, 404);
    for (const invalid of [{ name: '' }, { description: '' }, { color: '' }, { color: 'rojo' }, { color: undefined }]) await f.master(epics, 'POST', { ...pedido, ...invalid }, 400);
    await f.master(epics, 'POST', { ...pedido, name: 'Clientes' }, 409);
    const pedidos = await f.master(epics, 'POST', pedido, 201);
    await f.master(`${epics}/${pedidos.id}`, 'PATCH', { name: 'Pedidos y envíos', description: 'Seguimiento', color: '#8E44AD' });
    await f.master(`${epics}/${pedidos.id}`, 'PATCH', { ...pedido, name: 'Clientes' }, 409);
    await f.owner(`${epics}/${pedidos.id}`, 'PATCH', pedido, 403);
    const assign = id => `${f.stories}/${id}/epic`;
    await f.developer(assign(a.id), 'PATCH', { epicId: pedidos.id }, 403);
    await f.owner(assign(a.id), 'PATCH', { epicId: 9999 }, 400);
    await f.owner(assign(a.id), 'PATCH', { epicId: null }, 400);
    await f.owner(assign(b.id), 'PATCH', { epicId: pedidos.id });
    let list = await f.developer(epics);
    assert.deepEqual(list.map(epic => [epic.name, epic.color, epic.stories, epic.points]), [['Clientes', '#254e80', 1, 5], ['Pedidos y envíos', '#8e44ad', 1, 3]]);
    await f.owner(assign(b.id), 'PATCH', { epicId: f.epic.id });
    list = await f.master(epics);
    assert.deepEqual(list.map(epic => epic.points), [8, 0]);
    await f.owner(assign(a.id), 'PATCH', { epicId: f.secondEpic.id }, 400);
    assert.deepEqual(await f.outside(epics, 'GET', undefined, 404), { error: 'Proyecto no encontrado.' });
  } finally { await f.close(); }
});

test('Historias: épica obligatoria, edición y eliminación por el Product Owner', async () => {
  const f = await setup();
  try {
    const { epicId, ...withoutEpic } = f.story;
    assert.equal((await f.owner(f.stories, 'POST', withoutEpic, 400)).error, 'Selecciona la épica de la historia; es obligatoria.');
    await f.owner(f.stories, 'POST', { ...f.story, epicId: f.secondEpic.id }, 400);
    const story = await f.owner(f.stories, 'POST', f.story, 201);
    const path = `${f.stories}/${story.id}`;
    const edited = { ...f.story, title: 'Registro editado', criteria: ['Nuevo criterio'] };
    for (const request of [f.developer, f.master, f.otherOwner]) await request(path, 'PATCH', edited, 403);
    await f.owner(path, 'PATCH', { ...edited, epicId: undefined }, 400);
    await f.owner(path, 'PATCH', edited);
    let saved = (await f.owner(f.stories)).find(item => item.id === story.id);
    assert.deepEqual([saved.title, saved.criteria, saved.epic_id], ['Registro editado', ['Nuevo criterio'], f.epic.id]);
    await f.owner(`${f.stories}/9999`, 'PATCH', edited, 404);
    await f.developer(path, 'DELETE', undefined, 403);
    const committed = await f.owner(f.stories, 'POST', { ...f.story, title: 'Comprometida' }, 201);
    await f.developer(`${f.stories}/${committed.id}/estimate`, 'PATCH', { points: 3 });
    const sprint = await f.master(`/projects/${f.project.id}/sprints`, 'POST', { name: 'Sprint 6', startDate: '2026-11-18', endDate: '2026-11-24', goal: 'Evaluación' }, 201);
    await f.developer(`/projects/${f.project.id}/sprints/${sprint.id}/stories`, 'POST', { storyId: committed.id }, 201);
    await f.owner(`${f.stories}/${committed.id}`, 'DELETE', undefined, 409);
    await f.owner(path, 'DELETE');
    assert.deepEqual((await f.owner(f.stories)).map(item => item.title), ['Comprometida']);
    await f.owner(path, 'DELETE', undefined, 404);
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
