import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server.js';
import { setup } from './support.js';

test('Una base del sprint 2 se migra y conserva sus sprints', () => {
  const directory = mkdtempSync(join(tmpdir(), 'myscruem-'));
  const dbPath = join(directory, 'database.sqlite');
  try {
    const first = createApp({ dbPath });
    first.db.exec(`INSERT INTO companies(name,code) VALUES ('Empresa','empresa');
      INSERT INTO users(company_id,name,email,role,status) VALUES (1,'PO','po@example.com','Product Owner','Activo');
      INSERT INTO projects(company_id,name,description,owner_id) VALUES (1,'Portal','Demo',1);
      INSERT INTO sprints(project_id,name,start_date,end_date,goal) VALUES (1,'Sprint 2','2026-10-21','2026-10-27','Backlog');`);
    first.db.close();
    const legacy = new DatabaseSync(dbPath);
    legacy.exec('DROP TABLE tasks; DROP TABLE burndown;');
    legacy.close();
    const second = createApp({ dbPath });
    const sprint = second.db.prepare('SELECT * FROM sprints').get();
    assert.equal(sprint.status, 'En planificación');
    assert.equal(sprint.board_version, 0);
    assert.equal(second.db.prepare('SELECT COUNT(*) AS total FROM tasks').get().total, 0);
    second.db.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('Las funciones de los sprints 1 y 2 siguen disponibles y un proyecto archivado bloquea el tablero', async () => {
  const f = await setup();
  try {
    await f.admin('/users');
    const story = await f.owner(f.stories, 'POST', f.story, 201);
    await f.developer(`${f.stories}/${story.id}/estimate`, 'PATCH', { points: 3 });
    await f.owner(`${f.stories}/${story.id}/priority`, 'PATCH', { priority: 'Should have' });
    const sprints = `/projects/${f.project.id}/sprints`;
    const sprint = await f.master(sprints, 'POST', { name: 'Sprint 3', startDate: '2026-10-28', endDate: '2026-11-03', goal: 'Regresión' }, 201);
    await f.developer(`${sprints}/${sprint.id}/stories`, 'POST', { storyId: story.id }, 201);
    await f.master(`${sprints}/${sprint.id}/start`, 'POST');
    const developerId = (await f.admin('/users')).find(user => user.role === 'Developer').id;
    const task = await f.developer(`/projects/${f.project.id}/tasks`, 'POST', { title: 'Tarea', storyId: story.id, assigneeId: developerId }, 201);
    await f.owner(`/projects/${f.project.id}`, 'PATCH', { name: 'Portal', description: 'Portal de clientes', archived: true });
    await f.developer(`/projects/${f.project.id}/tasks/${task.id}/status`, 'PATCH', { status: 'En curso' }, 400);
    await f.developer(`/projects/${f.project.id}/tasks`, 'POST', { title: 'Otra', storyId: story.id, assigneeId: developerId }, 400);
    await f.master(`${sprints}/${sprint.id}/close`, 'POST', undefined, 400);
    assert.equal((await f.developer(`/projects/${f.project.id}/board`)).tasks.length, 1);
    assert.equal((await f.developer(`${sprints}/${sprint.id}/burndown`)).committed, 3);
    await f.admin('/logout', 'POST');
    await f.admin('/users', 'GET', undefined, 401);
  } finally { await f.close(); }
});
