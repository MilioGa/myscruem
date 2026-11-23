import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server.js';

test('Una base del sprint 5 se migra a las tablas del sprint 6 sin perder datos', () => {
  const directory = mkdtempSync(join(tmpdir(), 'myscruem-'));
  const dbPath = join(directory, 'database.sqlite');
  try {
    const first = createApp({ dbPath });
    first.db.exec(`INSERT INTO companies(name,code) VALUES ('Empresa','empresa');
      INSERT INTO users(company_id,name,email,role,status) VALUES (1,'SM','sm@example.com','Scrum Master','Activo');
      INSERT INTO users(company_id,name,email,role,status) VALUES (1,'PO','po@example.com','Product Owner','Activo');
      INSERT INTO projects(company_id,name,description,owner_id) VALUES (1,'Portal','Demo',2);
      INSERT INTO epics(project_id,name,description) VALUES (1,'Clientes','Registro');
      INSERT INTO stories(project_id,title,actor,goal,benefit,criteria,points,epic_id) VALUES (1,'Registro','cliente','registrarme','comprar','["ok"]',5,1);
      INSERT INTO sprints(project_id,name,start_date,end_date,goal,status) VALUES (1,'Sprint 5','2026-11-11','2026-11-17','Calidad','Activo');`);
    first.db.close();
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`DROP TABLE scoped_dod; DROP TABLE poker_votes; DROP TABLE poker_sessions; DROP TABLE work_logs; DROP TABLE tutorial_progress; DROP TABLE agreements; DROP TABLE meetings;
      ALTER TABLE epics DROP COLUMN color; ALTER TABLE stories DROP COLUMN criteria_done; ALTER TABLE stories DROP COLUMN estimated_hours; ALTER TABLE sprints DROP COLUMN capacity_hours; ALTER TABLE users DROP COLUMN tour_done;
      CREATE TABLE meetings (id INTEGER PRIMARY KEY, sprint_id INTEGER NOT NULL REFERENCES sprints(id), type TEXT NOT NULL CHECK(type IN ('Daily','Revisión','Retrospectiva')), date TEXT NOT NULL, attendees TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL, created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO meetings(sprint_id,type,date,notes,created_by) VALUES (1,'Daily','2026-11-12','Avance',1);`);
    legacy.close();
    const second = createApp({ dbPath });
    const story = second.db.prepare('SELECT * FROM stories').get();
    assert.deepEqual([story.title, story.points, story.criteria_done, story.estimated_hours], ['Registro', 5, '[]', null]);
    assert.equal(second.db.prepare('SELECT color FROM epics').get().color, '#254e80');
    assert.equal(second.db.prepare('SELECT capacity_hours FROM sprints').get().capacity_hours, null);
    assert.equal(second.db.prepare('SELECT tour_done FROM users WHERE id=1').get().tour_done, 0);
    for (const table of ['scoped_dod', 'poker_sessions', 'poker_votes', 'work_logs', 'tutorial_progress']) assert.equal(second.db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total, 0);
    second.db.exec("INSERT INTO meetings(sprint_id,type,date,notes,created_by) VALUES (1,'Planning','2026-11-11','Planeación',1)");
    assert.deepEqual(second.db.prepare('SELECT type FROM meetings ORDER BY id').all().map(row => row.type), ['Daily', 'Planning']);
    second.db.close();
    const third = createApp({ dbPath });
    assert.equal(third.db.prepare('SELECT COUNT(*) AS total FROM meetings').get().total, 2);
    third.db.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
