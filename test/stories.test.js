import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.js';

test('Crear y consultar historias con permisos y criterios obligatorios', async () => {
  const f = await setup();
  try {
    await f.admin(f.stories, 'POST', f.story, 403);
    await f.developer(f.stories, 'POST', f.story, 403);
    await f.otherOwner(f.stories, 'POST', f.story, 403);
    await f.outside(f.stories, 'GET', undefined, 404);
    await f.outside(f.stories, 'POST', f.story, 404);
    await f.owner(f.stories, 'POST', f.story, 403, 'invalid');
    for (const invalid of [{ title: '' }, { actor: ' ' }, { goal: '' }, { benefit: '' }, { criteria: [] }, { criteria: [' '] }, { criteria: 'texto' }, { criteria: Array(21).fill('Criterio') }]) {
      await f.owner(f.stories, 'POST', { ...f.story, ...invalid }, 400);
    }
    assert.deepEqual(await f.owner(f.stories), []);
    const a = await f.owner(f.stories, 'POST', f.story, 201);
    const b = await f.owner(f.stories, 'POST', { ...f.story, title: 'Consulta de clientes' }, 201);
    const saved = await f.developer(f.stories);
    assert.deepEqual(saved.map(item => item.id), [a.id, b.id]);
    assert.deepEqual(saved[0].criteria, f.story.criteria);
    assert.equal(saved[0].goal, f.story.goal);
    assert.deepEqual(await f.owner(`/projects/${f.secondProject.id}/stories`), []);
    await f.owner(`/projects/${f.project.id}`, 'PATCH', { name: 'Portal', description: 'Portal', archived: true });
    await f.owner(f.stories, 'POST', f.story, 400);
    assert.equal((await f.developer(f.stories)).length, 2);
  } finally { await f.close(); }
});
