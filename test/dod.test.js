import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.js';

test('Definition of Done por proyecto y permisos del Product Owner', async () => {
  const f = await setup();
  try {
    const dod = `/projects/${f.project.id}/dod`;
    assert.deepEqual((await f.developer(dod)).criteria, []);
    const criteria = ['Código revisado por otro integrante', 'Pruebas automáticas aprobadas', 'Criterios de aceptación cumplidos'];
    for (const request of [f.developer, f.master, f.admin, f.otherOwner]) await request(dod, 'PUT', { criteria }, 403);
    await f.outside(dod, 'PUT', { criteria }, 404);
    for (const invalid of ['texto', [''], ['x'.repeat(201)], Array.from({ length: 16 }, (_, i) => `Criterio ${i}`), ['Repetido', 'repetido']]) {
      await f.owner(dod, 'PUT', { criteria: invalid }, 400);
    }
    assert.deepEqual((await f.owner(dod, 'PUT', { criteria: ['  Código revisado por otro integrante ', ...criteria.slice(1)] })).criteria, criteria);
    for (const request of [f.developer, f.master, f.admin]) {
      const result = await request(dod);
      assert.deepEqual(result.criteria, criteria);
      assert.equal(result.updated_by, 'owner');
    }
    await f.owner(dod, 'PUT', { criteria: criteria.slice(0, 1) });
    assert.deepEqual((await f.developer(dod)).criteria, criteria.slice(0, 1));
    await f.owner(dod, 'PUT', { criteria: [] });
    assert.deepEqual((await f.developer(dod)).criteria, []);
    assert.deepEqual((await f.owner(`/projects/${f.secondProject.id}/dod`)).criteria, []);
    await f.outside(dod, 'GET', undefined, 404);
  } finally { await f.close(); }
});
