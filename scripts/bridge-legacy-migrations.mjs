#!/usr/bin/env node

import { constants as fsConstants, copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const mappings = [
  {
    oldId: 17,
    oldName: 'vpn_management',
    newId: 900002,
    newName: 'legacy_vpn_management',
  },
  {
    oldId: 16,
    oldName: 'household_activity',
    newId: 900001,
    newName: 'legacy_household_activity',
  },
];

function usage(message) {
  if (message) console.error(message);
  console.error(
    'Usage: node scripts/bridge-legacy-migrations.mjs --database <sqlite-file> [--apply --backup <backup-file>]'
  );
  process.exit(2);
}

function parseArgs(argv) {
  const result = { apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      result.apply = true;
    } else if (arg === '--database' || arg === '--backup') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) usage(`Missing value for ${arg}`);
      result[arg.slice(2)] = resolve(value);
      index += 1;
    } else {
      usage(`Unknown argument: ${arg}`);
    }
  }
  if (!result.database) usage('--database is required');
  if (result.apply && !result.backup) {
    usage('--backup is required with --apply');
  }
  return result;
}

function migrationRows(db) {
  const exists = db
    .prepare(
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = '_migrations'"
    )
    .get();
  if (!exists) throw new Error('The database has no _migrations table');
  return db
    .prepare(
      'SELECT id, name, applied_at FROM _migrations WHERE id IN (16, 17, 900001, 900002) ORDER BY id'
    )
    .all();
}

function inspect(rows) {
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  const pending = [];

  for (const mapping of mappings) {
    const source = byId.get(mapping.oldId);
    const target = byId.get(mapping.newId);

    if (source?.name === mapping.oldName && !target) {
      pending.push(mapping);
      continue;
    }
    if (!source && target?.name === mapping.newName) continue;

    // Once nightly migration 16 has run, the old household marker should be
    // at 900001 while id 16 belongs to usenet_indexer_metrics.
    if (
      mapping.oldId === 16 &&
      source?.name === 'usenet_indexer_metrics' &&
      target?.name === mapping.newName
    ) {
      continue;
    }

    const sourceDescription = source
      ? `${mapping.oldId}:${source.name}`
      : `${mapping.oldId}:missing`;
    const targetDescription = target
      ? `${mapping.newId}:${target.name}`
      : `${mapping.newId}:missing`;
    throw new Error(
      `Unexpected migration state (${sourceDescription}, ${targetDescription}); refusing to modify the database`
    );
  }

  return pending;
}

const options = parseArgs(process.argv.slice(2));
if (!existsSync(options.database)) {
  throw new Error(`Database does not exist: ${options.database}`);
}

let db = new DatabaseSync(options.database, { readOnly: !options.apply });
try {
  const before = migrationRows(db);
  const pending = inspect(before);
  console.log(
    JSON.stringify(
      { mode: options.apply ? 'apply' : 'dry-run', before, pending },
      null,
      2
    )
  );

  if (!options.apply) process.exit(0);
  if (existsSync(options.backup)) {
    throw new Error(`Backup already exists: ${options.backup}`);
  }

  const checkpoint = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
  if (Number(checkpoint?.busy ?? 0) !== 0) {
    throw new Error(
      `SQLite WAL checkpoint is busy; refusing to create a potentially incomplete backup (${JSON.stringify(checkpoint)})`
    );
  }

  db.close();
  db = undefined;
  copyFileSync(options.database, options.backup, fsConstants.COPYFILE_EXCL);
  db = new DatabaseSync(options.database);

  db.exec('BEGIN IMMEDIATE');
  try {
    const update = db.prepare(
      'UPDATE _migrations SET id = ?, name = ? WHERE id = ? AND name = ?'
    );
    for (const mapping of pending) {
      const result = update.run(
        mapping.newId,
        mapping.newName,
        mapping.oldId,
        mapping.oldName
      );
      if (Number(result.changes) !== 1) {
        throw new Error(
          `Expected to update exactly one ${mapping.oldName} migration row; updated ${result.changes}`
        );
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  const after = migrationRows(db);
  inspect(after);
  console.log(JSON.stringify({ backup: options.backup, after }, null, 2));
} finally {
  db?.close();
}
