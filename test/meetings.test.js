import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.js';

test('Actas de los eventos Scrum y seguimiento de acuerdos', async () => {
  const f = await setup();
  try {
    const sprints = `/projects/${f.project.id}/sprints`;
    const sprint = await f.master(sprints, 'POST', { name: 'Sprint 5', startDate: '2026-11-11', endDate: '2026-11-17', goal: 'Actas' }, 201);
    const meetings = `${sprints}/${sprint.id}/meetings`;
    const acta = { type: 'Retrospectiva', date: '2026-11-17', attendees: 'Todo el equipo', notes: 'Mejorar la estimación.', agreements: ['Revisar historias antes de la planificación', 'Daily a las 9:00'] };
    for (const request of [f.developer, f.owner, f.admin]) await request(meetings, 'POST', acta, 403);
    await f.outside(meetings, 'POST', acta, 404);
    for (const invalid of [{ type: 'Junta' }, { date: '2026-02-30' }, { date: 'mañana' }, { notes: '' }, { agreements: 'uno' }, { agreements: [''] }, { agreements: Array.from({ length: 21 }, (_, i) => `A${i}`) }]) {
      await f.master(meetings, 'POST', { ...acta, ...invalid }, 400);
    }
    await f.master(meetings, 'POST', { type: 'Daily', date: '2026-11-12', notes: 'Sin bloqueos.' }, 201);
    await f.master(meetings, 'POST', acta, 201);
    let list = await f.developer(meetings);
    assert.deepEqual(list.map(item => [item.type, item.date, item.agreements.length]), [['Retrospectiva', '2026-11-17', 2], ['Daily', '2026-11-12', 0]]);
    assert.equal(list[0].author, 'master');
    const agreement = list[0].agreements[0];
    const update = `/projects/${f.project.id}/agreements/${agreement.id}`;
    await f.developer(update, 'PATCH', { done: true }, 403);
    await f.outside(update, 'PATCH', { done: true }, 404);
    await f.master(update, 'PATCH', { done: 'si' }, 400);
    await f.master(update, 'PATCH', { done: true });
    list = await f.owner(meetings);
    assert.deepEqual([list[0].agreements[0].done, list[0].agreements[0].done_by], [1, 'master']);
    await f.master(update, 'PATCH', { done: false });
    assert.equal((await f.owner(meetings))[0].agreements[0].done_by, null);
    await f.master(`/projects/${f.project.id}/agreements/99999`, 'PATCH', { done: true }, 404);
  } finally { await f.close(); }
});

test('Velocidad del equipo por sprint cerrado', async () => {
  const f = await setup();
  try {
    const velocity = `/projects/${f.project.id}/velocity`;
    assert.deepEqual(await f.master(velocity), { sprints: [], average: 0 });
    const sprints = `/projects/${f.project.id}/sprints`;
    const developerId = (await f.admin('/users')).find(user => user.name === 'developer').id;
    const run = async (name, start, end, points, finish) => {
      const ids = [];
      for (const value of points) {
        const story = await f.owner(f.stories, 'POST', { ...f.story, title: `${name} ${value}` }, 201);
        await f.accept(story.id);
        await f.developer(`${f.stories}/${story.id}/estimate`, 'PATCH', { points: value });
        ids.push(story.id);
      }
      const sprint = await f.master(sprints, 'POST', { name, startDate: start, endDate: end, goal: name }, 201);
      for (const id of ids) await f.developer(`${sprints}/${sprint.id}/stories`, 'POST', { storyId: id }, 201);
      await f.master(`${sprints}/${sprint.id}/start`, 'POST');
      for (const index of finish) {
        const task = await f.developer(`/projects/${f.project.id}/tasks`, 'POST', { title: 'Tarea', storyId: ids[index], assigneeId: developerId }, 201);
        await f.developer(`/projects/${f.project.id}/tasks/${task.id}/status`, 'PATCH', { status: 'Terminado' });
      }
      await f.master(`${sprints}/${sprint.id}/close`, 'POST');
    };
    await run('Sprint 1', '2026-10-13', '2026-10-20', [5, 3], [0, 1]);
    await run('Sprint 2', '2026-10-21', '2026-10-27', [8, 5], [1]);
    const result = await f.developer(velocity);
    assert.deepEqual(result.sprints.map(item => [item.name, item.committed, item.completed]), [['Sprint 1', 8, 8], ['Sprint 2', 13, 5]]);
    assert.equal(result.average, 6.5);
    await f.outside(velocity, 'GET', undefined, 404);
  } finally { await f.close(); }
});
