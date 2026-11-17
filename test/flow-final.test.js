import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.js';

test('Flujo final: del backlog al cierre del sprint con DoD, comentarios, actas y velocidad', async () => {
  let current = new Date(2026, 10, 12, 9);
  const f = await setup({ now: () => current });
  try {
    const users = await f.admin('/users');
    const developerId = users.find(user => user.name === 'developer').id;
    await f.admin('/teams', 'POST', { name: 'Equipo Portal', projectId: f.project.id, memberIds: [developerId, users.find(user => user.name === 'master').id] }, 201);
    await f.owner(`/projects/${f.project.id}/dod`, 'PUT', { criteria: ['Código revisado', 'Pruebas aprobadas'] });
    const epic = await f.owner(`/projects/${f.project.id}/epics`, 'POST', { name: 'Clientes' }, 201);
    const story = await f.owner(f.stories, 'POST', f.story, 201);
    const extra = await f.owner(f.stories, 'POST', { ...f.story, title: 'Perfil del cliente' }, 201);
    await f.owner(`${f.stories}/${story.id}/epic`, 'PATCH', { epicId: epic.id });
    await f.developer(`${f.stories}/${story.id}/estimate`, 'PATCH', { points: 5 });
    await f.developer(`${f.stories}/${extra.id}/estimate`, 'PATCH', { points: 3 });
    const sprints = `/projects/${f.project.id}/sprints`;
    const sprint = await f.master(sprints, 'POST', { name: 'Sprint 5', startDate: '2026-11-12', endDate: '2026-11-18', goal: 'Versión final' }, 201);
    for (const item of [story, extra]) await f.developer(`${sprints}/${sprint.id}/stories`, 'POST', { storyId: item.id }, 201);
    await f.master(`${sprints}/${sprint.id}/start`, 'POST');
    const tasks = `/projects/${f.project.id}/tasks`;
    const task = await f.developer(tasks, 'POST', { title: 'Formulario', storyId: story.id, assigneeId: developerId, label: 'Frontend' }, 201);
    const impediment = await f.developer(`${tasks}/${task.id}/impediments`, 'POST', { description: 'Sin datos de prueba' }, 201);
    await f.master(`/projects/${f.project.id}/impediments/${impediment.id}/close`, 'POST', { solution: 'Se cargaron datos' });
    assert.deepEqual((await f.developer('/notifications')).items.map(item => item.kind), ['Impedimento']);
    await f.developer('/notifications/read', 'POST', { all: true });
    assert.equal((await f.developer('/notifications')).unread, 0);
    await f.master(`${tasks}/${task.id}/comments`, 'POST', { body: 'Recuerda validar el correo.' }, 201);
    await f.developer(`${tasks}/${task.id}/attachments`, 'POST', { filename: 'diseno.txt', data: Buffer.from('Diseño').toString('base64') }, 201);
    const board = await f.developer(`/projects/${f.project.id}/board`);
    assert.deepEqual([board.tasks[0].comments, board.tasks[0].attachments], [1, 1]);
    const meeting = await f.master(`${sprints}/${sprint.id}/meetings`, 'POST', { type: 'Daily', date: '2026-11-12', notes: 'Inicio del sprint', agreements: ['Revisar diseño'] }, 201);
    const [acta] = await f.developer(`${sprints}/${sprint.id}/meetings`);
    assert.equal(acta.id, meeting.id);
    current = new Date(2026, 10, 14, 12);
    await f.developer(`${tasks}/${task.id}/status`, 'PATCH', { status: 'Terminado' });
    await f.master(`/projects/${f.project.id}/agreements/${acta.agreements[0].id}`, 'PATCH', { done: true });
    assert.equal((await f.owner(`${f.stories}/${story.id}/tasks`)).progress, 100);
    assert.deepEqual((await f.master(`${sprints}/${sprint.id}/burndown`)).days.slice(0, 3).map(day => day.remaining), [8, 8, 3]);
    current = new Date(2026, 10, 18, 18);
    await f.master(`${sprints}/${sprint.id}/meetings`, 'POST', { type: 'Retrospectiva', date: '2026-11-18', notes: 'Cierre del proyecto' }, 201);
    assert.deepEqual(await f.master(`${sprints}/${sprint.id}/close`, 'POST'), { committed: 8, completed: 5, returned: 1 });
    const velocity = await f.owner(`/projects/${f.project.id}/velocity`);
    assert.deepEqual([velocity.sprints.length, velocity.sprints[0].completed, velocity.average], [1, 5, 5]);
    assert.ok((await f.developer('/training/glossary?q=acta')).length >= 1);
  } finally { await f.close(); }
});
