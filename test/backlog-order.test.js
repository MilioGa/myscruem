import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.js';

test('Orden y prioridad del backlog protegidos y persistentes', async () => {
  const f = await setup();
  try {
    const a = await f.owner(f.stories, 'POST', f.story, 201);
    const b = await f.owner(f.stories, 'POST', { ...f.story, title: 'Consulta' }, 201);
    const path = `${f.stories}/order`;
    await f.developer(path, 'PATCH', { order: [b.id, a.id] }, 403);
    await f.otherOwner(path, 'PATCH', { order: [b.id, a.id] }, 403);
    await f.outside(path, 'PATCH', { order: [b.id, a.id] }, 404);
    for (const order of [[a.id], [a.id,a.id], [a.id,9999], ['1','2']]) await f.owner(path, 'PATCH', { order }, 409);
    await f.owner(path, 'PATCH', { order: [b.id, a.id] });
    assert.deepEqual((await f.developer(f.stories)).map(story => story.id), [b.id, a.id]);
    const c = await f.owner(f.stories, 'POST', { ...f.story, title: 'Perfil' }, 201);
    assert.deepEqual((await f.owner(f.stories)).map(story => story.id), [b.id, a.id, c.id]);
    const priorityPath = `${f.stories}/${a.id}/priority`;
    await f.developer(priorityPath, 'PATCH', { priority: 'Could have' }, 403);
    await f.otherOwner(priorityPath, 'PATCH', { priority: 'Could have' }, 403);
    await f.owner(priorityPath, 'PATCH', { priority: 'Urgente' }, 400);
    for (const priority of ['Must have','Should have','Could have','Won’t have']) {
      await f.owner(priorityPath, 'PATCH', { priority });
      assert.equal((await f.master(f.stories)).find(story => story.id === a.id).priority, priority);
    }
  } finally { await f.close(); }
});
