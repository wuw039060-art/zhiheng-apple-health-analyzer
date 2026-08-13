use std::{
    fs::{self, File},
    io::{BufWriter, Write},
    path::{Path, PathBuf},
};

use rusqlite::{Connection, OptionalExtension};
use tauri::{AppHandle, Manager};

use crate::{error::AppResult, models::ImportSummary};

pub fn database_path(app: &AppHandle) -> AppResult<PathBuf> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| std::io::Error::other(error.to_string()))?;
    fs::create_dir_all(&directory)?;
    Ok(directory.join("watch-health-lens.db"))
}

pub fn open_database(app: &AppHandle) -> AppResult<Connection> {
    let connection = Connection::open(database_path(app)?)?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    connection.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS imports (
            import_id TEXT PRIMARY KEY,
            file_name TEXT NOT NULL,
            source_hash TEXT NOT NULL UNIQUE,
            imported_at TEXT NOT NULL,
            export_date TEXT,
            status TEXT NOT NULL,
            records_seen INTEGER NOT NULL DEFAULT 0,
            records_inserted INTEGER NOT NULL DEFAULT 0,
            records_updated INTEGER NOT NULL DEFAULT 0,
            workouts_seen INTEGER NOT NULL DEFAULT 0,
            ecg_files_seen INTEGER NOT NULL DEFAULT 0,
            route_files_seen INTEGER NOT NULL DEFAULT 0,
            first_date TEXT,
            last_complete_date TEXT
        );

        CREATE TABLE IF NOT EXISTS health_records (
            fingerprint TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            type_identifier TEXT NOT NULL,
            value TEXT,
            unit TEXT,
            start_date TEXT NOT NULL,
            end_date TEXT NOT NULL,
            source_name TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            first_seen_import TEXT NOT NULL,
            last_seen_import TEXT NOT NULL,
            FOREIGN KEY(first_seen_import) REFERENCES imports(import_id),
            FOREIGN KEY(last_seen_import) REFERENCES imports(import_id)
        );

        CREATE INDEX IF NOT EXISTS idx_health_type_start
            ON health_records(type_identifier, start_date);
        CREATE INDEX IF NOT EXISTS idx_health_start
            ON health_records(start_date);

        CREATE TABLE IF NOT EXISTS ecg_summaries (
            fingerprint TEXT PRIMARY KEY,
            recorded_at TEXT NOT NULL,
            classification TEXT NOT NULL,
            symptoms TEXT,
            source_file TEXT NOT NULL,
            first_seen_import TEXT NOT NULL,
            last_seen_import TEXT NOT NULL,
            FOREIGN KEY(first_seen_import) REFERENCES imports(import_id),
            FOREIGN KEY(last_seen_import) REFERENCES imports(import_id)
        );
        CREATE INDEX IF NOT EXISTS idx_ecg_recorded_at ON ecg_summaries(recorded_at);

        CREATE TABLE IF NOT EXISTS profile_context (
            import_id TEXT PRIMARY KEY,
            chronological_age_years REAL,
            biological_sex TEXT,
            measured_at TEXT,
            FOREIGN KEY(import_id) REFERENCES imports(import_id)
        );
        "#,
    )?;
    Ok(connection)
}

pub fn latest_import_summary(connection: &Connection) -> AppResult<Option<ImportSummary>> {
    connection
        .query_row(
            r#"
            SELECT import_id, file_name, imported_at, export_date,
                   records_seen, records_inserted, records_updated, workouts_seen,
                   ecg_files_seen, route_files_seen, first_date, last_complete_date
              FROM imports
             WHERE status = 'complete'
             ORDER BY imported_at DESC
             LIMIT 1
            "#,
            [],
            |row| {
                Ok(ImportSummary {
                    import_id: row.get(0)?,
                    file_name: row.get(1)?,
                    imported_at: row.get(2)?,
                    export_date: row.get(3)?,
                    records_seen: row.get::<_, i64>(4)? as u64,
                    records_inserted: row.get::<_, i64>(5)? as u64,
                    records_updated: row.get::<_, i64>(6)? as u64,
                    workouts_seen: row.get::<_, i64>(7)? as u64,
                    ecg_files_seen: row.get::<_, i64>(8)? as u64,
                    route_files_seen: row.get::<_, i64>(9)? as u64,
                    first_date: row.get(10)?,
                    last_complete_date: row.get(11)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

pub fn delete_all_health_data(connection: &mut Connection) -> AppResult<()> {
    let transaction = connection.transaction()?;
    transaction.execute("DELETE FROM ecg_summaries", [])?;
    transaction.execute("DELETE FROM health_records", [])?;
    transaction.execute("DELETE FROM profile_context", [])?;
    transaction.execute("DELETE FROM imports", [])?;
    transaction.commit()?;
    Ok(())
}

pub fn delete_health_date(connection: &mut Connection, date: &str) -> AppResult<()> {
    let transaction = connection.transaction()?;
    transaction.execute(
        "DELETE FROM health_records WHERE substr(start_date, 1, 10) = ?1 OR (type_identifier = 'HKCategoryTypeIdentifierSleepAnalysis' AND substr(end_date, 1, 10) = ?1)",
        [date],
    )?;
    transaction.execute(
        "DELETE FROM ecg_summaries WHERE substr(recorded_at, 1, 10) = ?1",
        [date],
    )?;
    transaction.commit()?;
    Ok(())
}

pub fn delete_health_metric(connection: &mut Connection, type_identifier: &str) -> AppResult<()> {
    connection.execute(
        "DELETE FROM health_records WHERE type_identifier = ?1",
        [type_identifier],
    )?;
    Ok(())
}

fn csv_cell(value: Option<String>) -> String {
    let value = value.unwrap_or_default().replace('"', "\"\"");
    format!("\"{value}\"")
}

pub fn export_health_records(connection: &Connection, path: &Path) -> AppResult<u64> {
    let mut statement = connection.prepare(
        "SELECT kind, type_identifier, value, unit, start_date, end_date, source_name, metadata_json FROM health_records ORDER BY start_date",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, Option<String>>(0)?,
            row.get::<_, Option<String>>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, Option<String>>(4)?,
            row.get::<_, Option<String>>(5)?,
            row.get::<_, Option<String>>(6)?,
            row.get::<_, Option<String>>(7)?,
        ))
    })?;
    let mut writer = BufWriter::new(File::create(path)?);
    writer.write_all(
        b"kind,type_identifier,value,unit,start_date,end_date,source_name,metadata_json\n",
    )?;
    let mut count = 0_u64;
    for row in rows {
        let row = row?;
        let line = [row.0, row.1, row.2, row.3, row.4, row.5, row.6, row.7]
            .into_iter()
            .map(csv_cell)
            .collect::<Vec<_>>()
            .join(",");
        writeln!(writer, "{line}")?;
        count += 1;
    }
    writer.flush()?;
    Ok(count)
}
