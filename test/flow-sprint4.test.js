import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.js';

test('Flujo completo del sprint 4 sin afectar el tablero ni el Burndown', async () => {
  let current = new Date(2026, 10, 4, 9);
  const f = await setup({ now: () => current });
  try {
    const users = await f.admin('/users');
    const developerId = users.find(user => user.name === 'developer').id;
    await f.admin('/teams', 'POST', { name: 'Equipo Portal', projectId: f.project.id, memberIds: [developerId, users.find(user => user.name === 'master').id] }, 201);
    const epic = await f.owner(`/projects/${f.project.id}/epics`, 'POST', { name: 'Clientes' }, 201);
    const story = await f.owner(f.stories, 'POST', f.story, 201);
    await f.owner(`${f.stories}/${story.id}/epic`, 'PATCH', { epicId: epic.id });
    await f.developer(`${f.stories}/${story.id}/estimate`, 'PATCH', { points: 5 });
    const sprints = `/projects/${f.project.id}/sprints`;
    const sprint = await f.master(sprints, 'POST', { name: 'Sprint 4', startDate: '2026-11-04', endDate: '2026-11-10', goal: 'Seguimiento y capacitación' }, 201);
    await f.developer(`${sprints}/${sprint.id}/stories`, 'POST', { storyId: story.id }, 201);
    await f.master(`${sprints}/${sprint.id}/start`, 'POST');
    const tasks = `/projects/${f.project.id}/tasks`;
    const a = await f.developer(tasks, 'POST', { title: 'Formulario', storyId: story.id, assigneeId: developerId, label: 'Frontend', type: 'Desarrollo' }, 201);
    const b = await f.developer(tasks, 'POST', { title: 'Pruebas', storyId: story.id, assigneeId: developerId, type: 'Pruebas' }, 201);
    const impediment = await f.developer(`${tasks}/${b.id}/impediments`, 'POST', { description: 'Sin datos de prueba' }, 201);
    assert.deepEqual((await f.developer(`/projects/${f.project.id}/board?type=Pruebas`)).tasks.map(task => task.impediment), ['Sin datos de prueba']);
    current = new Date(2026, 10, 6, 12);
    await f.master(`/projects/${f.project.id}/impediments/${impediment.id}/close`, 'POST', { solution: 'Se cargaron datos de ejemplo' });
    for (const task of [a, b]) await f.developer(`${tasks}/${task.id}/status`, 'PATCH', { status: 'Terminado' });
    const chart = await f.master(`${sprints}/${sprint.id}/burndown`);
    assert.deepEqual(chart.days.slice(0, 3).map(day => day.remaining), [5, 5, 0]);
    assert.equal((await f.owner(`${f.stories}/${story.id}/tasks`)).progress, 100);
    assert.deepEqual((await f.owner(`/projects/${f.project.id}/epics`)).map(item => item.points), [5]);
    assert.ok((await f.developer('/training/glossary?q=impedimento')).length >= 1);
    current = new Date(2026, 10, 10, 18);
    assert.deepEqual(await f.master(`${sprints}/${sprint.id}/close`, 'POST'), { committed: 5, completed: 5, returned: 0 });
  } finally { await f.close(); }
});
