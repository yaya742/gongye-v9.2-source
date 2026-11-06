/* Single-instance SQLite snapshot store. Never repairs/reseeds an existing broken database. */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createSeed } from '../src/data/seed.js';

const opened = new Set();
const COLLECTIONS = ['users', 'courses', 'circles', 'memberships', 'posts', 'attachments',
  'resources', 'comments', 'reactions', 'follows', 'courseCollections', 'ledger', 'claims',
  'gifts', 'xp', 'growthDecisions', 'notifications', 'reports', 'audit', 'events',
  'applications', 'sessions', 'uploads'];
const MAPS = ['wallets', 'prefs', 'drafts'];

export function createProductionSeed(now = Date.now()) {
  const seed = createSeed(now, { keepDemoPosts: false });
  const db = { version: 4, seedVersion: 0, production: true, demo: false,
    createdAt: new Date(now).toISOString(), session: null, revision: 0 };
  for (const key of COLLECTIONS) db[key] = [];
  for (const key of MAPS) db[key] = {};
  db.courses = seed.courses.map(({ id, school, name, code, category }) => ({ id, school, name, code, category }));
  db.circles = seed.circles.map(({ id, courseId, createdAt }) => ({
    id, courseId, status: 'active', createdBy: null, createdAt, pinnedPostId: null, inviteCode: null
  }));
  return db;
}

export class ProductionStore {
  constructor(file) {
    this.file = path.resolve(file);
    this.queue = Promise.resolve();
    this.context = new AsyncLocalStorage();
    this.closed = false;
    if (opened.has(this.file)) throw new Error('single_instance_database_already_open');
    mkdirSync(path.dirname(this.file), { recursive: true });
    opened.add(this.file);
    const existed = existsSync(this.file);
    try {
      this.sqlite = new DatabaseSync(this.file);
      this.sqlite.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
      const check = this.sqlite.prepare('PRAGMA quick_check').get();
      if (Object.values(check)[0] !== 'ok') throw new Error('database_integrity_failed');
      if (existed && !this.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='metadata'").get()) throw new Error('existing_database_schema_missing');
      this.sqlite.exec('CREATE TABLE IF NOT EXISTS metadata (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, header TEXT NOT NULL); CREATE TABLE IF NOT EXISTS collections (name TEXT PRIMARY KEY, value TEXT NOT NULL);');
      const meta = this.sqlite.prepare('SELECT revision, header FROM metadata WHERE id=1').get();
      if (meta) {
        const rows = this.sqlite.prepare('SELECT name, value FROM collections').all();
        this.data = JSON.parse(meta.header);
        for (const row of rows) this.data[row.name] = JSON.parse(row.value);
        for (const key of COLLECTIONS) if (!Array.isArray(this.data[key])) throw new Error(`invalid_collection:${key}`);
        for (const key of MAPS) if (!this.data[key] || Array.isArray(this.data[key]) || typeof this.data[key] !== 'object') throw new Error(`invalid_map:${key}`);
        if (this.data.production !== true) throw new Error('not_a_production_database');
        this.revision = Number(meta.revision);
      } else {
        if (existed) throw new Error('existing_database_metadata_missing');
        if (this.sqlite.prepare('SELECT count(*) AS n FROM collections').get().n) throw new Error('database_metadata_missing');
        this.data = createProductionSeed();
        this.revision = -1;
        this.flush();
      }
      this.data.revision = this.revision;
      this.data.session = null;
    } catch (error) {
      this.sqlite?.close();
      opened.delete(this.file);
      throw error;
    }
  }

  flush() {
    const next = this.revision + 1;
    const { session: _session, revision: _revision, ...header } = this.data;
    const rows = [];
    for (const key of [...COLLECTIONS, ...MAPS]) {
      rows.push([key, JSON.stringify(header[key])]);
      delete header[key];
    }
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const current = this.sqlite.prepare('SELECT revision FROM metadata WHERE id=1').get();
      // Optimistic revision guard also refuses silent overwrites by a second process.
      if ((current ? Number(current.revision) : -1) !== this.revision) throw new Error('database_revision_conflict_single_instance_required');
      this.sqlite.prepare('INSERT INTO metadata(id,revision,header) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,header=excluded.header').run(next, JSON.stringify(header));
      const insert = this.sqlite.prepare('INSERT INTO collections(name,value) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value');
      for (const row of rows) insert.run(...row);
      this.sqlite.exec('COMMIT');
      this.revision = next;
      this.data.revision = next;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }

  run(task) {
    const active = this.context.getStore();
    if (active?.store === this && active.active) return Promise.resolve().then(() => task(this.data));
    if (this.closed) return Promise.reject(new Error('database_closed'));
    const job = this.queue.then(async () => {
      const scope = { store: this, active: true, dirty: false };
      const before = structuredClone(this.data);
      try {
        return await this.context.run(scope, async () => {
          const result = await task(this.data);
          this.data.session = null;
          if (scope.dirty) this.flush();
          return result;
        });
      } catch (error) {
        // Keep the db object identity: file service and actions retain this reference.
        for (const key of Object.keys(this.data)) delete this.data[key];
        Object.assign(this.data, before, { session: null });
        throw error;
      } finally {
        scope.active = false;
      }
    });
    this.queue = job.catch(() => {});
    return job;
  }

  save(mutator) {
    return this.run(async (db) => {
      if (mutator) await mutator(db);
      this.context.getStore().dirty = true;
    });
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.queue;
    try { this.sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE)'); }
    finally { this.sqlite.close(); opened.delete(this.file); }
  }
}
