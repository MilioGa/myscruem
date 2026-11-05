import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.js';

test('Equipos: alta, edición, integrantes, proyecto y aislamiento por empresa', async () => {
  const f = await setup();
  try {
    const users = await f.admin('/users');
    const id = name => users.find(user => user.name === name).id;
    const adminId = id('Administrador');
    const team = { name: 'Equipo Portal', projectId: f.project.id, memberIds: [id('developer'), id('master'), id('owner')] };
    await f.owner('/teams', 'POST', team, 403);
    await f.developer('/teams', 'GET', undefined, 403);
    await f.outside('/teams', 'POST', team, 400);
    for (const invalid of [{ name: '' }, { memberIds: 'x' }, { memberIds: [adminId] }, { memberIds: [99999] }, { projectId: 99999 }, { projectId: '1' }]) {
      await f.admin('/teams', 'POST', { ...team, ...invalid }, 400);
    }
    const created = await f.admin('/teams', 'POST', team, 201);
    await f.admin('/teams', 'POST', { ...team, projectId: null }, 409);
    await f.admin('/teams', 'POST', { ...team, name: 'Otro equipo' }, 409);
    const second = await f.admin('/teams', 'POST', { name: 'Equipo libre', memberIds: [id('developer')] }, 201);
    let list = await f.admin('/teams');
    assert.deepEqual(list.map(item => item.name), ['Equipo Portal', 'Equipo libre']);
    const portal = list.find(item => item.id === created.id);
    assert.equal(portal.project, 'Portal');
    assert.deepEqual(portal.members.map(member => member.name), ['developer', 'master', 'owner']);
    await f.admin(`/teams/${created.id}`, 'PATCH', { name: 'Equipo Portal', projectId: f.project.id, memberIds: [id('developer'), id('developer')] });
    await f.admin(`/teams/${second.id}`, 'PATCH', { name: 'Equipo libre', projectId: f.project.id, memberIds: [] }, 409);
    await f.admin(`/teams/${second.id}`, 'PATCH', { name: 'Equipo libre', projectId: f.secondProject.id, memberIds: [] });
    list = await f.admin('/teams');
    assert.deepEqual(list.find(item => item.id === created.id).members.map(member => member.name), ['developer']);
    assert.equal(list.find(item => item.id === second.id).project, 'Otro portal');
    await f.outside(`/teams/${created.id}`, 'PATCH', team, 404);
    assert.deepEqual(await f.outside('/teams'), []);
    await f.admin('/teams/99999', 'PATCH', team, 404);
  } finally { await f.close(); }
});
