import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server.js';

test('Migración de historias existentes y conservación al reiniciar', () => {
  const directory = mkdtempSync(join(tmpdir(), 'myscruem-'));
  const dbPath = join(directory, 'database.sqlite');
  try {
    const original = new DatabaseSync(dbPath);
    original.exec(`CREATE TABLE stories (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, title TEXT NOT NULL, actor TEXT NOT NULL, goal TEXT NOT NULL, benefit TEXT NOT NULL, criteria TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO stories(project_id,title,actor,goal,benefit,criteria) VALUES (1,'Registro','usuario','registrar','consultar','["Guardar datos"]');`);
    original.close();
    const first = createApp({ dbPath });
    const story = first.db.prepare('SELECT * FROM stories').get();
    assert.equal(story.title, 'Registro');
    assert.equal(story.priority, 'Must have');
    assert.equal(story.position, 1);
    assert.equal(story.points, null);
    first.db.prepare('UPDATE stories SET points=5').run();
    first.db.close();
    const second = createApp({ dbPath });
    assert.equal(second.db.prepare('SELECT points FROM stories').get().points, 5);
    assert.equal(second.db.prepare('SELECT COUNT(*) AS total FROM stories').get().total, 1);
    second.db.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
