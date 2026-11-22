import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.js';

const prepare = async f => {
  const users = await f.admin('/users');
  const developerId = users.find(user => user.name === 'developer').id;
  const second = await f.admin('/users', 'POST', { name: 'segundo', email: 'segundo@example.com', role: 'Developer' }, 201);
  f.db.prepare("UPDATE users SET status='Activo' WHERE id=?").run(second.id);
  const story = await f.owner(f.stories, 'POST', f.story, 201);
  const poker = await f.master(`/projects/${f.project.id}/poker`, 'POST', { storyId: story.id }, 201);
  await f.developer(`/projects/${f.project.id}/poker/${poker.id}/vote`, 'POST', { value: '5' });
  await f.master(`/projects/${f.project.id}/poker/${poker.id}/reveal`, 'POST');
  await f.master(`/projects/${f.project.id}/poker/${poker.id}/confirm`, 'POST', { points: 5, hours: 12 });
  await f.accept(story.id);
  return { developerId, secondId: second.id, story };
};

test('TC-12 y TC-13: sprint con fechas válidas, un solo sprint activo y capacidad contra comprometido', async () => {
  const f = await setup({ now: () => new Date(2026, 10, 18, 9) });
  try {
    const { story } = await prepare(f);
    const sprints = `/projects/${f.project.id}/sprints`;
    await f.master(sprints, 'POST', { name: 'Mal', startDate: '2026-11-24', endDate: '2026-11-18', goal: 'Meta' }, 400);
    const sprint = await f.master(sprints, 'POST', { name: 'Sprint 6', startDate: '2026-11-18', endDate: '2026-11-24', goal: 'Evaluación' }, 201);
    const other = await f.master(sprints, 'POST', { name: 'Sprint 7', startDate: '2026-11-25', endDate: '2026-12-01', goal: 'Siguiente' }, 201);
    await f.developer(`${sprints}/${sprint.id}/stories`, 'POST', { storyId: story.id }, 201);
    const capacity = `${sprints}/${sprint.id}/capacity`;
    await f.developer(capacity, 'PATCH', { hours: 40 }, 403);
    await f.master(capacity, 'PATCH', { hours: -1 }, 400);
    assert.deepEqual(await f.master(capacity, 'PATCH', { hours: 10 }), { capacity: 10 });
    const summary = await f.developer(`${sprints}/${sprint.id}/stories`);
    assert.deepEqual([summary.points, summary.hours, summary.capacity], [5, 12, 10]);
    await f.master(`${sprints}/${sprint.id}/start`, 'POST');
    const extra = await f.owner(f.stories, 'POST', { ...f.story, title: 'Extra' }, 201);
    await f.developer(`${f.stories}/${extra.id}/estimate`, 'PATCH', { points: 2 });
    await f.developer(`${sprints}/${other.id}/stories`, 'POST', { storyId: extra.id }, 201);
    await f.master(`${sprints}/${other.id}/start`, 'POST', undefined, 409);
    const board = await f.developer(`/projects/${f.project.id}/board`);
    assert.deepEqual(board.stories.map(item => [item.title, item.points, item.epic, item.epic_color]), [['Registro de clientes', 5, 'Clientes', '#254e80']]);
  } finally { await f.close(); }
});

test('TC-14 y TC-15: tablero con columnas, tarjetas de su responsable y horas reales', async () => {
  const f = await setup({ now: () => new Date(2026, 10, 18, 9) });
  try {
    const { developerId, secondId, story } = await prepare(f);
    const sprints = `/projects/${f.project.id}/sprints`;
    const sprint = await f.master(sprints, 'POST', { name: 'Sprint 6', startDate: '2026-11-18', endDate: '2026-11-24', goal: 'Horas' }, 201);
    await f.developer(`${sprints}/${sprint.id}/stories`, 'POST', { storyId: story.id }, 201);
    await f.master(`${sprints}/${sprint.id}/start`, 'POST');
    const tasks = `/projects/${f.project.id}/tasks`;
    const mine = await f.developer(tasks, 'POST', { title: 'Mía', storyId: story.id, assigneeId: developerId }, 201);
    const foreign = await f.developer(tasks, 'POST', { title: 'Ajena', storyId: story.id, assigneeId: secondId }, 201);
    const board = await f.developer(`/projects/${f.project.id}/board`);
    assert.deepEqual(board.columns, ['Por hacer', 'En curso', 'En revisión', 'Terminado']);
    assert.ok(board.tasks.every(task => task.assignee && task.hours === 0));
    await f.developer(`${tasks}/${foreign.id}/status`, 'PATCH', { status: 'En curso' }, 403);
    await f.developer(`${tasks}/${mine.id}/status`, 'PATCH', { status: 'En revisión' });
    for (const hours of [-2, 0, 25, '3', null]) await f.developer(`${tasks}/${mine.id}/hours`, 'POST', { hours }, 400);
    await f.developer(`${tasks}/${foreign.id}/hours`, 'POST', { hours: 2 }, 403);
    await f.master(`${tasks}/${mine.id}/hours`, 'POST', { hours: 2 }, 403);
    await f.developer(`${tasks}/${mine.id}/hours`, 'POST', { hours: 4 }, 201);
    assert.deepEqual(await f.developer(`${tasks}/${mine.id}/hours`, 'POST', { hours: 1.5 }, 201), { hours: 5.5 });
    const saved = (await f.developer(`/projects/${f.project.id}/board`)).tasks.find(task => task.id === mine.id);
    assert.deepEqual([saved.status, saved.hours], ['En revisión', 5.5]);
    const detail = await f.owner(`${f.stories}/${story.id}/tasks`);
    assert.deepEqual([detail.hours, detail.story.estimated_hours], [5.5, 12]);
  } finally { await f.close(); }
});

test('TC-16 y TC-17: historial de impedimentos y cuatro tipos de reunión editables solo por el Scrum Master', async () => {
  const f = await setup({ now: () => new Date(2026, 10, 18, 9) });
  try {
    const { developerId, story } = await prepare(f);
    const sprints = `/projects/${f.project.id}/sprints`;
    const sprint = await f.master(sprints, 'POST', { name: 'Sprint 6', startDate: '2026-11-18', endDate: '2026-11-24', goal: 'Eventos' }, 201);
    await f.developer(`${sprints}/${sprint.id}/stories`, 'POST', { storyId: story.id }, 201);
    await f.master(`${sprints}/${sprint.id}/start`, 'POST');
    const task = await f.developer(`/projects/${f.project.id}/tasks`, 'POST', { title: 'Tarea', storyId: story.id, assigneeId: developerId }, 201);
    const first = await f.developer(`/projects/${f.project.id}/tasks/${task.id}/impediments`, 'POST', { description: 'Sin acceso' }, 201);
    await f.master(`/projects/${f.project.id}/impediments/${first.id}/close`, 'POST', { solution: 'Acceso otorgado' });
    await f.developer(`/projects/${f.project.id}/tasks/${task.id}/impediments`, 'POST', { description: 'Falta diseño' }, 201);
    const history = await f.owner(`/projects/${f.project.id}/impediments?status=Todos`);
    assert.deepEqual(history.map(item => [item.description, item.status, item.solution]), [['Falta diseño', 'Abierto', null], ['Sin acceso', 'Cerrado', 'Acceso otorgado']]);
    const meetings = `${sprints}/${sprint.id}/meetings`;
    for (const type of ['Planning', 'Daily', 'Revisión', 'Retrospectiva']) await f.master(meetings, 'POST', { type, date: '2026-11-18', notes: `Reunión ${type}` }, 201);
    await f.master(meetings, 'POST', { type: 'Otra', date: '2026-11-18', notes: 'No' }, 400);
    await f.developer(meetings, 'POST', { type: 'Daily', date: '2026-11-18', notes: 'No' }, 403);
    const list = await f.developer(meetings);
    assert.deepEqual(list.map(item => item.type).sort(), ['Daily', 'Planning', 'Retrospectiva', 'Revisión']);
    const planning = list.find(item => item.type === 'Planning');
    const edit = `/projects/${f.project.id}/meetings/${planning.id}`;
    for (const request of [f.developer, f.owner]) await request(edit, 'PATCH', { type: 'Planning', date: '2026-11-18', notes: 'Cambio' }, 403);
    await f.master(edit, 'PATCH', { type: 'Planning', date: '2026-11-19', notes: 'Planeación del sprint 6', attendees: 'Todo el equipo' });
    const edited = (await f.owner(meetings)).find(item => item.id === planning.id);
    assert.deepEqual([edited.date, edited.notes, edited.attendees], ['2026-11-19', 'Planeación del sprint 6', 'Todo el equipo']);
    await f.master(`/projects/${f.project.id}/meetings/9999`, 'PATCH', { type: 'Daily', date: '2026-11-18', notes: 'x' }, 404);
  } finally { await f.close(); }
});

test('TC-18 y TC-19: Burndown por puntos y horas, selector de sprint y vista general', async () => {
  let current = new Date(2026, 10, 18, 9);
  const f = await setup({ now: () => current });
  try {
    const { developerId, story } = await prepare(f);
    const sprints = `/projects/${f.project.id}/sprints`;
    const sprint = await f.master(sprints, 'POST', { name: 'Sprint 6', startDate: '2026-11-18', endDate: '2026-11-21', goal: 'Métricas' }, 201);
    await f.developer(`${sprints}/${sprint.id}/stories`, 'POST', { storyId: story.id }, 201);
    await f.master(`${sprints}/${sprint.id}/start`, 'POST');
    const task = await f.developer(`/projects/${f.project.id}/tasks`, 'POST', { title: 'Tarea', storyId: story.id, assigneeId: developerId }, 201);
    await f.developer(`/projects/${f.project.id}/tasks/${task.id}/hours`, 'POST', { hours: 4 }, 201);
    current = new Date(2026, 10, 19, 9);
    await f.developer(`/projects/${f.project.id}/tasks/${task.id}/hours`, 'POST', { hours: 3 }, 201);
    const data = await f.owner(`${sprints}/${sprint.id}/burndown`);
    assert.deepEqual([data.hours.committed, data.hours.logged, data.hours.remaining], [12, 7, 5]);
    assert.deepEqual(data.hours.days.map(day => [day.date, day.ideal, day.remaining]), [['2026-11-18', 12, 8], ['2026-11-19', 8, 5], ['2026-11-20', 4, null], ['2026-11-21', 0, null]]);
    assert.deepEqual(data.days.map(day => day.ideal), [5, 3.3, 1.7, 0]);
    await f.developer(`/projects/${f.project.id}/tasks/${task.id}/status`, 'PATCH', { status: 'Terminado' });
    await f.master(`${sprints}/${sprint.id}/close`, 'POST');
    const extra = await f.owner(f.stories, 'POST', { ...f.story, title: 'Pendiente' }, 201);
    await f.developer(`${f.stories}/${extra.id}/estimate`, 'PATCH', { points: 3 });
    const general = await f.owner(`/projects/${f.project.id}/burndown`);
    assert.deepEqual([general.committed, general.completed, general.remaining, general.sprints], [8, 5, 3, 1]);
    assert.deepEqual(general.days.map(day => [day.label, day.ideal, day.remaining]), [['Inicio', 8, 8], ['Sprint 6', 0, 3]]);
    await f.outside(`/projects/${f.project.id}/burndown`, 'GET', undefined, 404);
  } finally { await f.close(); }
});

test('TC-20 y TC-21: avance del tutorial teórico y recorrido inicial por rol', async () => {
  const f = await setup();
  try {
    let guide = await f.developer('/training');
    assert.deepEqual(guide.progress, { completed: [], finished: false });
    await f.developer('/training/progress', 'POST', { moduleId: 'inexistente' }, 404);
    for (const module of guide.modules.slice(0, -1)) assert.equal((await f.developer('/training/progress', 'POST', { moduleId: module.id })).finished, false);
    const last = await f.developer('/training/progress', 'POST', { moduleId: guide.modules.at(-1).id });
    assert.deepEqual([last.completed.length, last.finished], [4, true]);
    await f.developer('/training/progress', 'POST', { moduleId: guide.modules[0].id });
    guide = await f.developer('/training');
    assert.equal(guide.progress.completed.length, 4);
    assert.equal((await f.owner('/training')).progress.finished, false);
    for (const request of [f.admin, f.owner, f.master, f.developer]) assert.equal((await request('/me')).tour, true);
    assert.deepEqual(await f.developer('/tour', 'POST'), { tour: false });
    assert.equal((await f.developer('/me')).tour, false);
    assert.equal((await f.master('/me')).tour, true);
  } finally { await f.close(); }
});
