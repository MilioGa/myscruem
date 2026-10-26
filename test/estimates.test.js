import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.js';

test('Estimación Fibonacci persistente y exclusiva del Developer', async () => {
  const f = await setup();
  try {
    const story = await f.owner(f.stories, 'POST', f.story, 201);
    const path = `${f.stories}/${story.id}/estimate`;
    await f.owner(path, 'PATCH', { points: 5 }, 403);
    await f.admin(path, 'PATCH', { points: 5 }, 403);
    await f.outside(path, 'PATCH', { points: 5 }, 404);
    await f.developer(`/projects/${f.secondProject.id}/stories/${story.id}/estimate`, 'PATCH', { points: 5 }, 404);
    for (const points of [0, 4, -1, 1.5, '5', null, 100]) await f.developer(path, 'PATCH', { points }, 400);
    assert.equal((await f.owner(f.stories))[0].points, null);
    for (const points of [1, 2, 3, 5, 8, 13, 21]) {
      await f.developer(path, 'PATCH', { points });
      assert.equal((await f.master(f.stories))[0].points, points);
    }
  } finally { await f.close(); }
});
