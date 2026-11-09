import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server.js';

test('Una base del sprint 3 se migra sin perder datos', () => {
  const directory = mkdtempSync(join(tmpdir(), 'myscruem-'));
  const dbPath = join(directory, 'database.sqlite');
  try {
    const first = createApp({ dbPath });
    first.db.exec(`INSERT INTO companies(name,code) VALUES ('Empresa','empresa');
      INSERT INTO users(company_id,name,email,role,status) VALUES (1,'Dev','dev@example.com','Developer','Activo');
      INSERT INTO users(company_id,name,email,role,status) VALUES (1,'PO','po@example.com','Product Owner','Activo');
      INSERT INTO projects(company_id,name,description,owner_id) VALUES (1,'Portal','Demo',2);
      INSERT INTO stories(project_id,title,actor,goal,benefit,criteria,points) VALUES (1,'Registro','cliente','registrarme','comprar','["ok"]',5);
      INSERT INTO sprints(project_id,name,start_date,end_date,goal,status) VALUES (1,'Sprint 3','2026-10-28','2026-11-03','Kanban','Activo');
      INSERT INTO sprint_stories(sprint_id,story_id) VALUES (1,1);
      INSERT INTO tasks(sprint_id,story_id,title,assignee_id,status) VALUES (1,1,'Formulario',1,'En curso');`);
    first.db.close();
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`DROP TABLE impediments; DROP TABLE team_members; DROP TABLE teams; ALTER TABLE stories DROP COLUMN epic_id; DROP TABLE epics;
      ALTER TABLE tasks DROP COLUMN label; ALTER TABLE tasks DROP COLUMN type;`);
    legacy.close();
    const second = createApp({ dbPath });
    const task = second.db.prepare('SELECT * FROM tasks').get();
    assert.deepEqual([task.title, task.status, task.label, task.type], ['Formulario', 'En curso', '', 'Desarrollo']);
    assert.equal(second.db.prepare('SELECT epic_id FROM stories').get().epic_id, null);
    for (const table of ['teams', 'team_members', 'epics', 'impediments']) assert.equal(second.db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total, 0);
    second.db.close();
    const third = createApp({ dbPath });
    assert.equal(third.db.prepare('SELECT COUNT(*) AS total FROM tasks').get().total, 1);
    third.db.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
