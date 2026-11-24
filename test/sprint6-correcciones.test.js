import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.js';

for (const [label, withoutSavedHours] of [['iniciado con esta versión', false], ['iniciado antes de guardar las horas', true]]) test(`El Burndown por horas conserva las horas estimadas al cerrar con historias pendientes un sprint ${label}`, async () => {
  const f = await setup({ now: () => new Date(2026, 10, 18, 9) });
  try {
    const users = await f.admin('/users');
    const developerId = users.find(user => user.name === 'developer').id;
    const story = await f.owner(f.stories, 'POST', f.story, 201);
    const poker = `/projects/${f.project.id}/poker`;
    const session = await f.master(poker, 'POST', { storyId: story.id }, 201);
    await f.developer(`${poker}/${session.id}/vote`, 'POST', { value: '5' });
    await f.master(`${poker}/${session.id}/reveal`, 'POST');
    await f.master(`${poker}/${session.id}/confirm`, 'POST', { points: 5, hours: 12 });
    const sprints = `/projects/${f.project.id}/sprints`;
    const sprint = await f.master(sprints, 'POST', { name: 'Sprint 6', startDate: '2026-11-18', endDate: '2026-11-21', goal: 'Cierre' }, 201);
    await f.developer(`${sprints}/${sprint.id}/stories`, 'POST', { storyId: story.id }, 201);
    await f.master(`${sprints}/${sprint.id}/start`, 'POST');
    if (withoutSavedHours) f.db.prepare('UPDATE sprints SET committed_hours=NULL WHERE id=?').run(sprint.id);
    const task = await f.developer(`/projects/${f.project.id}/tasks`, 'POST', { title: 'Tarea', storyId: story.id, assigneeId: developerId }, 201);
    await f.developer(`/projects/${f.project.id}/tasks/${task.id}/hours`, 'POST', { hours: 4 }, 201);
    assert.deepEqual(await f.master(`${sprints}/${sprint.id}/close`, 'POST'), { committed: 5, completed: 0, returned: 1 });
    const data = await f.owner(`${sprints}/${sprint.id}/burndown`);
    assert.deepEqual([data.committed, data.hours.committed, data.hours.logged, data.hours.remaining], [5, 12, 4, 8]);
    assert.equal(data.hours.days[0].ideal, 12);
  } finally { await f.close(); }
});
