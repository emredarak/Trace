import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  CaseInput,
  CaseRecord,
  CreateCaseInput,
  validateCaseInput,
} from "./case-schema";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    const path = process.env.TRACE_DB_PATH ?? "trace.db";
    db = new Database(path);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function initDb(): void {
  const database = getDb();
  database.exec(`
    CREATE TABLE IF NOT EXISTS cases (
      id TEXT PRIMARY KEY,
      caseNo TEXT UNIQUE NOT NULL,
      summary TEXT NOT NULL,
      crimeType TEXT,
      locationType TEXT,
      locationText TEXT,
      latitude REAL,
      longitude REAL,
      occurredAt TEXT,
      officer TEXT,
      victimAge INTEGER,
      victimGender TEXT,
      suspects TEXT,
      witnesses TEXT,
      mo TEXT,
      weapon TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      needsRerank INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS evidences (
      id TEXT PRIMARY KEY,
      caseId TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      note TEXT,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS case_links (
      sourceId TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      targetId TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      createdAt TEXT NOT NULL,
      PRIMARY KEY (sourceId, targetId)
    );
    CREATE TABLE IF NOT EXISTS case_persons (
      id TEXT PRIMARY KEY,
      caseId TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      name TEXT,
      age INTEGER,
      gender TEXT,
      note TEXT,
      type TEXT NOT NULL,
      relatedVictimId TEXT REFERENCES case_persons(id) ON DELETE SET NULL,
      relationship TEXT,
      unidentified INTEGER NOT NULL DEFAULT 0,
      contactStatus TEXT,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS case_locations (
      id TEXT PRIMARY KEY,
      caseId TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      note TEXT,
      locationText TEXT,
      latitude REAL,
      longitude REAL,
      createdAt TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS case_fts USING fts5(
      summary, crimeType, locationType, weapon, mo,
      content='cases', content_rowid='rowid'
    );
    CREATE TRIGGER IF NOT EXISTS cases_ai AFTER INSERT ON cases BEGIN
      INSERT INTO case_fts(rowid, summary, crimeType, locationType, weapon, mo)
        VALUES (new.rowid, new.summary, new.crimeType, new.locationType, new.weapon, new.mo);
    END;
    CREATE TRIGGER IF NOT EXISTS cases_ad AFTER DELETE ON cases BEGIN
      INSERT INTO case_fts(case_fts, rowid, summary, crimeType, locationType, weapon, mo)
        VALUES ('delete', old.rowid, old.summary, old.crimeType, old.locationType, old.weapon, old.mo);
    END;
    CREATE TRIGGER IF NOT EXISTS cases_au AFTER UPDATE ON cases BEGIN
      INSERT INTO case_fts(case_fts, rowid, summary, crimeType, locationType, weapon, mo)
        VALUES ('delete', old.rowid, old.summary, old.crimeType, old.locationType, old.weapon, old.mo);
      INSERT INTO case_fts(rowid, summary, crimeType, locationType, weapon, mo)
        VALUES (new.rowid, new.summary, new.crimeType, new.locationType, new.weapon, new.mo);
    END;
  `);
  const locationColumns = new Set(
    (
      database.prepare("PRAGMA table_info(case_locations)").all() as {
        name: string;
      }[]
    ).map((c) => c.name),
  );
  if (!locationColumns.has("title")) {
    database.exec("ALTER TABLE case_locations ADD COLUMN title TEXT");
  }
  if (!locationColumns.has("kind")) {
    database.exec(
      "ALTER TABLE case_locations ADD COLUMN kind TEXT NOT NULL DEFAULT 'iliskili'",
    );
  }
  if (!locationColumns.has("priority")) {
    database.exec("ALTER TABLE case_locations ADD COLUMN priority TEXT");
  }
  const evidenceColumns = new Set(
    (
      database.prepare("PRAGMA table_info(evidences)").all() as {
        name: string;
      }[]
    ).map((c) => c.name),
  );
  if (!evidenceColumns.has("title")) {
    database.exec("ALTER TABLE evidences ADD COLUMN title TEXT");
  }
  if (!evidenceColumns.has("imageFile")) {
    database.exec("ALTER TABLE evidences ADD COLUMN imageFile TEXT");
  }
  if (!evidenceColumns.has("audioFile")) {
    database.exec("ALTER TABLE evidences ADD COLUMN audioFile TEXT");
  }
  const personColumns = new Set(
    (
      database.prepare("PRAGMA table_info(case_persons)").all() as {
        name: string;
      }[]
    ).map((c) => c.name),
  );
  if (!personColumns.has("audioFile")) {
    database.exec("ALTER TABLE case_persons ADD COLUMN audioFile TEXT");
  }
}

function nextCaseNo(database: Database.Database): string {
  const row = database
    .prepare(
      "SELECT MAX(CAST(SUBSTR(caseNo, 4) AS INTEGER)) AS maxNo FROM cases WHERE caseNo LIKE 'TR-%'",
    )
    .get() as { maxNo: number | null };
  const next = (row.maxNo ?? 0) + 1;
  return `TR-${String(next).padStart(4, "0")}`;
}

function toRecord(row: Record<string, unknown>): CaseRecord {
  return {
    ...(row as unknown as CaseInput),
    id: row.id,
    caseNo: row.caseNo,
    needsRerank: Boolean(row.needsRerank),
  } as CaseRecord;
}

export function insertCase(input: CreateCaseInput): CaseRecord {
  const valid = validateCaseInput(input);
  const { locations, persons, ...caseFields } = valid;
  const database = getDb();
  const runInsert = database.transaction((): CaseRecord => {
  const now = new Date().toISOString();
  const record: CaseRecord = {
    ...caseFields,
    id: randomUUID(),
    caseNo: nextCaseNo(database),
    status: valid.status ?? "open",
    needsRerank: false,
    createdAt: now,
    updatedAt: now,
  };
  database
    .prepare(
      `INSERT INTO cases (
        id, caseNo, summary, crimeType, locationType, locationText,
        latitude, longitude, occurredAt, officer, victimAge, victimGender,
        suspects, witnesses, mo, weapon, status, needsRerank, createdAt, updatedAt
      ) VALUES (
        @id, @caseNo, @summary, @crimeType, @locationType, @locationText,
        @latitude, @longitude, @occurredAt, @officer, @victimAge, @victimGender,
        @suspects, @witnesses, @mo, @weapon, @status, @needsRerank, @createdAt, @updatedAt
      )`,
    )
    .run({
      id: record.id,
      caseNo: record.caseNo,
      summary: record.summary,
      crimeType: record.crimeType ?? null,
      locationType: record.locationType ?? null,
      locationText: record.locationText ?? null,
      latitude: record.latitude ?? null,
      longitude: record.longitude ?? null,
      occurredAt: record.occurredAt ?? null,
      officer: record.officer ?? null,
      victimAge: record.victimAge ?? null,
      victimGender: record.victimGender ?? null,
      suspects: record.suspects ?? null,
      witnesses: record.witnesses ?? null,
      mo: record.mo ?? null,
      weapon: record.weapon ?? null,
      status: record.status,
      needsRerank: 0,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  if (locations && locations.length > 0) {
    const insertLocation = database.prepare(
      "INSERT INTO case_locations (id, caseId, title, note, locationText, kind, priority, latitude, longitude, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const loc of locations) {
      insertLocation.run(
        randomUUID(),
        record.id,
        loc.title ?? "Konum",
        loc.note ?? null,
        loc.note ?? null,
        loc.kind ?? "iliskili",
        loc.priority ?? null,
        loc.latitude ?? null,
        loc.longitude ?? null,
        now,
      );
    }
  }
  if (persons && persons.length > 0) {
    const insertPerson = database.prepare(
      "INSERT INTO case_persons (id, caseId, name, age, gender, note, type, relatedVictimId, relationship, unidentified, contactStatus, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const personIds: string[] = [];
    for (const person of persons) {
      const personId = person.id ?? randomUUID();
      personIds.push(personId);
      insertPerson.run(
        personId,
        record.id,
        person.name,
        person.age,
        person.gender,
        person.note,
        person.type,
        null,
        null,
        person.unidentified ? 1 : 0,
        person.contactStatus,
        now,
      );
    }
    const linkPerson = database.prepare(
      "UPDATE case_persons SET relatedVictimId = ?, relationship = ? WHERE id = ?",
    );
    persons.forEach((person, i) => {
      if (person.relatedVictimId !== null) {
        linkPerson.run(person.relatedVictimId, person.relationship, personIds[i]);
      }
    });
  }
  return toRecord(record as unknown as Record<string, unknown>);
  });
  return runInsert();
}
