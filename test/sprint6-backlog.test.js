import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.js';

test('TC-01 a TC-03: sesión, rol de cada usuario y permisos validados en el servidor', async () => {
  const f = await setup();
  try {
    assert.equal((await f.master('/me')).user.role, 'Scrum Master');
    assert.equal((await f.owner('/me')).user.role, 'Product Owner');
    assert.equal((await f.developer('/me')).user.role, 'Developer');
    const sprints = `/projects/${f.project.id}/sprints`;
    await f.developer(sprints, 'POST', { name: 'Sprint', startDate: '2026-11-18', endDate: '2026-11-24', goal: 'Meta' }, 403);
    const story = await f.owner(f.stories, 'POST', f.story, 201);
    await f.developer(`${f.stories}/${story.id}`, 'PATCH', { ...f.story, title: 'Cambio' }, 403);
    await f.developer(`${f.stories}/${story.id}`, 'DELETE', undefined, 403);
    const users = await f.admin('/users');
    const id = name => users.find(user => user.name === name).id;
    await f.admin('/teams', 'POST', { name: 'Equipo Portal', projectId: f.project.id, memberIds: [id('developer'), id('master'), id('owner')] }, 201);
    assert.deepEqual((await f.otherOwner('/projects')).map(project => project.name), ['Otro portal']);
    await f.otherOwner(f.stories, 'GET', undefined, 404);
    assert.deepEqual((await f.developer('/projects')).map(project => project.name).sort(), ['Otro portal', 'Portal']);
    const anonymous = await fetch(`${(await f.admin.raw('/me')).url.replace(/\/me$/, '')}/projects`);
    assert.equal(anonymous.status, 401);
    await f.developer('/logout', 'POST');
    await f.developer('/projects', 'GET', undefined, 401);
  } finally { await f.close(); }
});

test('TC-04 y TC-05: cualquier rol crea proyectos y solo su creador o Product Owner los elimina en cascada', async () => {
  const f = await setup();
  try {
    for (const request of [f.master, f.developer, f.owner]) await request('/projects', 'POST', { name: 'Proyecto del rol', description: 'Prueba' }, 201);
    await f.master('/projects', 'POST', { name: '', description: 'Sin nombre' }, 400);
    const created = await f.master('/projects', 'POST', { name: 'Tablero interno', description: 'Proyecto del Scrum Master' }, 201);
    assert.ok((await f.master('/projects')).some(project => project.id === created.id));
    await f.developer(`/projects/${created.id}`, 'DELETE', undefined, 403);
    await f.master(`/projects/${created.id}`, 'DELETE');
    const story = await f.owner(f.stories, 'POST', f.story, 201);
    await f.developer(`${f.stories}/${story.id}/estimate`, 'PATCH', { points: 3 });
    await f.accept(story.id);
    const sprints = `/projects/${f.project.id}/sprints`;
    const sprint = await f.master(sprints, 'POST', { name: 'Sprint 6', startDate: '2026-11-18', endDate: '2026-11-24', goal: 'Evaluación' }, 201);
    await f.developer(`${sprints}/${sprint.id}/stories`, 'POST', { storyId: story.id }, 201);
    await f.master(`${sprints}/${sprint.id}/start`, 'POST');
    const developerId = (await f.admin('/users')).find(user => user.name === 'developer').id;
    const task = await f.developer(`/projects/${f.project.id}/tasks`, 'POST', { title: 'Formulario', storyId: story.id, assigneeId: developerId }, 201);
    await f.developer(`/projects/${f.project.id}/tasks/${task.id}/comments`, 'POST', { body: 'Avance' }, 201);
    await f.developer(`/projects/${f.project.id}/tasks/${task.id}/impediments`, 'POST', { description: 'Bloqueo' }, 201);
    await f.master(`${sprints}/${sprint.id}/meetings`, 'POST', { type: 'Daily', date: '2026-11-18', notes: 'Avance', agreements: ['Acuerdo'] }, 201);
    await f.owner(`${sprints}/${sprint.id}/dod`, 'PUT', { criteria: ['Demo lista'] });
    await f.developer(`/projects/${f.project.id}`, 'DELETE', undefined, 403);
    await f.otherOwner(`/projects/${f.project.id}`, 'DELETE', undefined, 403);
    await f.owner(`/projects/${f.project.id}`, 'DELETE');
    await f.owner(f.stories, 'GET', undefined, 404);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS total FROM stories WHERE project_id=?').get(f.project.id).total, 0);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS total FROM sprints WHERE project_id=?').get(f.project.id).total, 0);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS total FROM tasks').get().total, 0);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS total FROM meetings').get().total, 0);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS total FROM impediments').get().total, 0);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS total FROM epics WHERE project_id=?').get(f.project.id).total, 0);
    assert.ok((await f.owner('/projects')).every(project => project.id !== f.project.id));
  } finally { await f.close(); }
});

test('TC-06: el equipo exige Scrum Master, Product Owner y Developer y permite quitar integrantes', async () => {
  const f = await setup();
  try {
    const users = await f.master('/users');
    const id = name => users.find(user => user.name === name).id;
    const team = { name: 'Equipo Portal', projectId: f.project.id, memberIds: [id('developer'), id('master')] };
    assert.equal((await f.master('/teams', 'POST', team, 400)).error, 'El equipo debe tener al menos un Scrum Master, un Product Owner y un Developer.');
    const created = await f.master('/teams', 'POST', { ...team, memberIds: [id('developer'), id('master'), id('owner'), id('other-owner')] }, 201);
    await f.master(`/teams/${created.id}`, 'PATCH', { ...team, memberIds: [id('developer'), id('master'), id('owner')] });
    await f.master('/teams', 'POST', { name: 'Equipo dos', memberIds: [id('developer'), id('master'), id('other-owner')] }, 201);
    const list = await f.master('/teams');
    assert.deepEqual(list.map(item => [item.name, item.members.length]), [['Equipo Portal', 3], ['Equipo dos', 3]]);
    await f.developer('/teams', 'POST', team, 403);
  } finally { await f.close(); }
});

test('TC-07 y TC-08: épicas del Scrum Master con color e historias completas del Product Owner', async () => {
  const f = await setup();
  try {
    const epics = `/projects/${f.project.id}/epics`;
    await f.owner(epics, 'POST', { name: 'Pagos', description: 'Cobros', color: '#ff0000' }, 403);
    await f.master(epics, 'POST', { name: 'Pagos', description: 'Cobros' }, 400);
    const pagos = await f.master(epics, 'POST', { name: 'Pagos', description: 'Cobros', color: '#FF0000' }, 201);
    assert.equal((await f.owner(epics)).find(epic => epic.id === pagos.id).color, '#ff0000');
    await f.master(f.stories, 'POST', f.story, 403);
    await f.developer(f.stories, 'POST', f.story, 403);
    await f.owner(f.stories, 'POST', { ...f.story, epicId: undefined }, 400);
    const a = await f.owner(f.stories, 'POST', { ...f.story, epicId: pagos.id }, 201);
    const b = await f.owner(f.stories, 'POST', { ...f.story, title: 'Consulta' }, 201);
    await f.owner(`${f.stories}/${a.id}`, 'PATCH', { ...f.story, title: 'Cobro editado', epicId: pagos.id });
    await f.owner(`${f.stories}/${b.id}/priority`, 'PATCH', { priority: 'Could have' });
    await f.owner(`${f.stories}/order`, 'PATCH', { order: [b.id, a.id] });
    assert.deepEqual((await f.developer(f.stories)).map(story => [story.title, story.epic_id]), [['Consulta', f.epic.id], ['Cobro editado', pagos.id]]);
    await f.owner(`${f.stories}/${b.id}`, 'DELETE');
    assert.deepEqual((await f.developer(f.stories)).map(story => story.title), ['Cobro editado']);
  } finally { await f.close(); }
});

test('TC-09: los criterios de aceptación se marcan y bloquean el paso a Terminado', async () => {
  const f = await setup();
  try {
    const story = await f.owner(f.stories, 'POST', { ...f.story, criteria: ['Uno', 'Dos', 'Tres'] }, 201);
    const criteria = index => `${f.stories}/${story.id}/criteria/${index}`;
    await f.master(criteria(0), 'PATCH', { done: true }, 403);
    await f.otherOwner(criteria(0), 'PATCH', { done: true }, 403);
    await f.developer(criteria(3), 'PATCH', { done: true }, 404);
    await f.developer(criteria(0), 'PATCH', { done: 'si' }, 400);
    assert.deepEqual((await f.developer(criteria(1), 'PATCH', { done: true })).criteria_done, [1]);
    await f.developer(`${f.stories}/${story.id}/estimate`, 'PATCH', { points: 3 });
    const sprints = `/projects/${f.project.id}/sprints`;
    const sprint = await f.master(sprints, 'POST', { name: 'Sprint 6', startDate: '2026-11-18', endDate: '2026-11-24', goal: 'Criterios' }, 201);
    await f.developer(`${sprints}/${sprint.id}/stories`, 'POST', { storyId: story.id }, 201);
    await f.master(`${sprints}/${sprint.id}/start`, 'POST');
    const developerId = (await f.admin('/users')).find(user => user.name === 'developer').id;
    const tasks = `/projects/${f.project.id}/tasks`;
    const first = await f.developer(tasks, 'POST', { title: 'Primera', storyId: story.id, assigneeId: developerId }, 201);
    const second = await f.developer(tasks, 'POST', { title: 'Segunda', storyId: story.id, assigneeId: developerId }, 201);
    await f.developer(`${tasks}/${first.id}/status`, 'PATCH', { status: 'Terminado' });
    assert.equal((await f.developer(`${tasks}/${second.id}/status`, 'PATCH', { status: 'Terminado' }, 409)).error, 'La historia tiene criterios de aceptación sin marcar. Márcalos antes de pasarla a Terminado.');
    await f.owner(criteria(0), 'PATCH', { done: true });
    await f.developer(criteria(2), 'PATCH', { done: true });
    await f.developer(`${tasks}/${second.id}/status`, 'PATCH', { status: 'Terminado' });
    const saved = (await f.owner(`/projects/${f.project.id}/sprints/${sprint.id}/stories`)).stories[0];
    assert.equal(saved.completed, 1);
    assert.deepEqual((await f.owner(f.stories))[0].criteria_done, [0, 1, 2]);
  } finally { await f.close(); }
});

test('TC-10: Definition of Done del proyecto, de cada historia y de cada sprint por separado', async () => {
  const f = await setup();
  try {
    const story = await f.owner(f.stories, 'POST', f.story, 201);
    const sprint = await f.master(`/projects/${f.project.id}/sprints`, 'POST', { name: 'Sprint 6', startDate: '2026-11-18', endDate: '2026-11-24', goal: 'DoD' }, 201);
    const project = `/projects/${f.project.id}/dod`;
    const storyDod = `${f.stories}/${story.id}/dod`;
    const sprintDod = `/projects/${f.project.id}/sprints/${sprint.id}/dod`;
    await f.owner(project, 'PUT', { criteria: ['Código revisado', 'Pruebas pasadas'] });
    await f.owner(storyDod, 'PUT', { criteria: ['Validación con el cliente'] });
    await f.owner(sprintDod, 'PUT', { criteria: ['Demo preparada', 'Manual actualizado'] });
    for (const request of [f.developer, f.master, f.otherOwner]) {
      await request(storyDod, 'PUT', { criteria: ['No'] }, 403);
      await request(sprintDod, 'PUT', { criteria: ['No'] }, 403);
    }
    await f.owner(storyDod, 'PUT', { criteria: ['Repetido', 'repetido'] }, 400);
    assert.deepEqual((await f.developer(project)).criteria, ['Código revisado', 'Pruebas pasadas']);
    const savedStory = await f.developer(storyDod);
    assert.deepEqual([savedStory.scope, savedStory.name, savedStory.criteria], ['Historia', 'Registro de clientes', ['Validación con el cliente']]);
    const savedSprint = await f.master(sprintDod);
    assert.deepEqual([savedSprint.scope, savedSprint.criteria], ['Sprint', ['Demo preparada', 'Manual actualizado']]);
    await f.owner(`${f.stories}/9999/dod`, 'GET', undefined, 404);
    await f.owner(`/projects/${f.project.id}/sprints/9999/dod`, 'GET', undefined, 404);
    await f.outside(storyDod, 'GET', undefined, 404);
  } finally { await f.close(); }
});
