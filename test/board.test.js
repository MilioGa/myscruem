import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.js';

const activeSprint = async f => {
  const story = await f.owner(f.stories, 'POST', f.story, 201);
  await f.developer(`${f.stories}/${story.id}/estimate`, 'PATCH', { points: 5 });
  const sprints = `/projects/${f.project.id}/sprints`;
  const sprint = await f.master(sprints, 'POST', { name: 'Sprint 3', startDate: '2026-10-28', endDate: '2026-11-03', goal: 'Tablero Kanban' }, 201);
  await f.developer(`${sprints}/${sprint.id}/stories`, 'POST', { storyId: story.id }, 201);
  return { story, sprint, sprints };
};

test('Tablero con columnas, acceso por empresa y sprint activo', async () => {
  const f = await setup();
  try {
    const board = `/projects/${f.project.id}/board`;
    const { story, sprint, sprints } = await activeSprint(f);
    assert.equal((await f.developer(board)).sprint, null);
    await f.master(`${sprints}/${sprint.id}/start`, 'POST');
    const developerId = (await f.admin('/users')).find(user => user.role === 'Developer').id;
    f.db.prepare('INSERT INTO tasks(sprint_id,story_id,title,assignee_id,status) VALUES (?,?,?,?,?)').run(sprint.id, story.id, 'Formulario', developerId, 'En curso');
    for (const request of [f.developer, f.owner, f.master, f.admin]) {
      const result = await request(board);
      assert.deepEqual(result.columns, ['Por hacer', 'En curso', 'En revisión', 'Terminado']);
      assert.equal(result.sprint.id, sprint.id);
      assert.equal(result.tasks[0].status, 'En curso');
      assert.equal(result.tasks[0].assignee, 'developer');
    }
    assert.deepEqual((await f.developer(board)).members.map(member => member.name), ['developer']);
    await f.outside(board, 'GET', undefined, 404);
    assert.equal((await f.developer(`/projects/${f.secondProject.id}/board`)).sprint, null);
  } finally { await f.close(); }
});

test('El tablero carga 200 tarjetas en menos de 2 segundos', async () => {
  const f = await setup();
  try {
    const { story, sprint, sprints } = await activeSprint(f);
    await f.master(`${sprints}/${sprint.id}/start`, 'POST');
    const developerId = (await f.admin('/users')).find(user => user.role === 'Developer').id;
    const insert = f.db.prepare('INSERT INTO tasks(sprint_id,story_id,title,assignee_id,status,position) VALUES (?,?,?,?,?,?)');
    const columns = ['Por hacer', 'En curso', 'En revisión', 'Terminado'];
    for (let i = 0; i < 200; i++) insert.run(sprint.id, story.id, `Tarea ${i + 1}`, developerId, columns[i % 4], i);
    const start = performance.now();
    const result = await f.developer(`/projects/${f.project.id}/board`);
    assert.ok(performance.now() - start < 2000);
    assert.equal(result.tasks.length, 200);
    assert.equal(result.tasks.filter(task => task.status === 'Terminado').length, 50);
  } finally { await f.close(); }
});
