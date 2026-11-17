import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server.js';

test('Una base del sprint 4 se migra a las tablas del sprint 5 sin perder datos', () => {
  const directory = mkdtempSync(join(tmpdir(), 'myscruem-'));
  const dbPath = join(directory, 'database.sqlite');
  try {
    const first = createApp({ dbPath });
    first.db.exec(`INSERT INTO companies(name,code) VALUES ('Empresa','empresa');
      INSERT INTO users(company_id,name,email,role,status) VALUES (1,'Dev','dev@example.com','Developer','Activo');
      INSERT INTO users(company_id,name,email,role,status) VALUES (1,'PO','po@example.com','Product Owner','Activo');
      INSERT INTO projects(company_id,name,description,owner_id) VALUES (1,'Portal','Demo',2);
      INSERT INTO stories(project_id,title,actor,goal,benefit,criteria,points) VALUES (1,'Registro','cliente','registrarme','comprar','["ok"]',5);
      INSERT INTO sprints(project_id,name,start_date,end_date,goal,status) VALUES (1,'Sprint 4','2026-11-04','2026-11-10','Seguimiento','Activo');
      INSERT INTO sprint_stories(sprint_id,story_id) VALUES (1,1);
      INSERT INTO tasks(sprint_id,story_id,title,assignee_id,status,label,type) VALUES (1,1,'Formulario',1,'En curso','Frontend','Desarrollo');`);
    first.db.close();
    const legacy = new DatabaseSync(dbPath);
    legacy.exec('DROP TABLE agreements; DROP TABLE meetings; DROP TABLE task_attachments; DROP TABLE task_comments; DROP TABLE notifications; DROP TABLE definition_of_done;');
    legacy.close();
    const second = createApp({ dbPath });
    const task = second.db.prepare('SELECT * FROM tasks').get();
    assert.deepEqual([task.title, task.status, task.label, task.type], ['Formulario', 'En curso', 'Frontend', 'Desarrollo']);
    for (const table of ['definition_of_done', 'notifications', 'task_comments', 'task_attachments', 'meetings', 'agreements']) assert.equal(second.db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total, 0);
    second.db.close();
    const third = createApp({ dbPath });
    assert.equal(third.db.prepare('SELECT COUNT(*) AS total FROM stories').get().total, 1);
    third.db.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
