use std::{
    collections::HashMap,
    fs::{self, File},
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
};

use chrono::{DateTime, Days, NaiveDate, Utc};
use quick_xml::{
    events::{BytesStart, Event},
    Reader,
};
use rusqlite::{params, OptionalExtension};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

use crate::{
    aggregate::load_dashboard_from_connection,
    db::open_database,
    error::{AppError, AppResult},
    models::{DashboardPayload, HealthRow, ImportProgress},
};

const MAX_ARCHIVE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_ENTRIES: usize = 20_000;
const MAX_UNCOMPRESSED_BYTES: u64 = 5 * 1024 * 1024 * 1024;
const MAX_COMPRESSION_RATIO: u64 = 1_000;

struct ArchiveInventory {
    health_xml_index: usize,
    health_xml_size: u64,
    ecg_indices: Vec<usize>,
    route_files: u64,
}

struct EcgSummary {
    fingerprint: String,
    recorded_at: String,
    classification: String,
    symptoms: Option<String>,
    source_file: String,
}

struct RowBuilder {
    kind: String,
    type_identifier: String,
    value: Option<String>,
    unit: Option<String>,
    start_date: String,
    end_date: String,
    source_name: Option<String>,
    metadata: Map<String, Value>,
}

fn emit_progress(
    app: &AppHandle,
    phase: &'static str,
    percent: f64,
    message: impl Into<String>,
    records_processed: Option<u64>,
) {
    let _ = app.emit(
        "import-progress",
        ImportProgress {
            phase,
            percent: percent.clamp(0.0, 100.0),
            message: message.into(),
            records_processed,
        },
    );
}

fn validate_input(path: &Path) -> AppResult<()> {
    if !path.is_file() {
        return Err(AppError::InvalidPath(path.display().to_string()));
    }
    if !path.extension().is_some_and(|extension| {
        extension.eq_ignore_ascii_case("zip") || extension.eq_ignore_ascii_case("xml")
    }) {
        return Err(AppError::InvalidArchive(
            "请选择 Apple 健康的 .zip 或 export.xml".into(),
        ));
    }
    let size = path.metadata()?.len();
    if size == 0 || size > MAX_ARCHIVE_BYTES {
        return Err(AppError::UnsafeArchive(format!(
            "压缩包大小为 {} MB，超出允许范围",
            size / 1024 / 1024
        )));
    }
    Ok(())
}

fn inspect_archive(path: &Path) -> AppResult<ArchiveInventory> {
    let mut archive = ZipArchive::new(File::open(path)?)?;
    if archive.len() == 0 || archive.len() > MAX_ENTRIES {
        return Err(AppError::UnsafeArchive(format!(
            "文件条目数 {} 不在允许范围内",
            archive.len()
        )));
    }
    let mut total_uncompressed = 0_u64;
    let mut health_xml = None;
    let mut ecg_indices = Vec::new();
    let mut route_files = 0_u64;

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        if entry.enclosed_name().is_none() {
            return Err(AppError::UnsafeArchive(format!(
                "发现不安全路径：{}",
                entry.name()
            )));
        }
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err(AppError::UnsafeArchive(format!(
                "不允许符号链接：{}",
                entry.name()
            )));
        }
        total_uncompressed = total_uncompressed
            .checked_add(entry.size())
            .ok_or_else(|| AppError::UnsafeArchive("解压大小溢出".into()))?;
        if total_uncompressed > MAX_UNCOMPRESSED_BYTES {
            return Err(AppError::UnsafeArchive("压缩包解压后体积过大".into()));
        }
        if entry.size() > 50 * 1024 * 1024
            && entry.compressed_size() > 0
            && entry.size() / entry.compressed_size() > MAX_COMPRESSION_RATIO
        {
            return Err(AppError::UnsafeArchive(format!(
                "文件压缩比异常：{}",
                entry.name()
            )));
        }
        let name = entry.name().replace('\\', "/").to_lowercase();
        if name.ends_with(".csv") && name.contains("electrocardiogram") {
            ecg_indices.push(index);
        }
        if name.ends_with(".gpx") {
            route_files += 1;
        }
        if health_xml.is_none() && name.ends_with(".xml") && entry.size() > 1024 {
            let mut prefix = Vec::with_capacity(64 * 1024);
            entry.by_ref().take(128 * 1024).read_to_end(&mut prefix)?;
            if String::from_utf8_lossy(&prefix).contains("<HealthData") {
                health_xml = Some((index, entry.size()));
            }
        }
    }
    let (health_xml_index, health_xml_size) = health_xml.ok_or_else(|| {
        AppError::InvalidArchive("未找到根节点为 HealthData 的 Apple 健康 export.xml".into())
    })?;
    Ok(ArchiveInventory {
        health_xml_index,
        health_xml_size,
        ecg_indices,
        route_files,
    })
}

fn clean_csv_value(value: &str) -> String {
    value.trim().trim_matches('"').replace("\"\"", "\"")
}

fn parse_ecg_summaries(path: &Path, indices: &[usize]) -> AppResult<Vec<EcgSummary>> {
    let mut archive = ZipArchive::new(File::open(path)?)?;
    let mut summaries = Vec::with_capacity(indices.len());
    for &index in indices {
        let entry = archive.by_index(index)?;
        let source_file = entry.name().replace('\\', "/");
        let mut reader = BufReader::new(entry);
        let mut recorded_at = None;
        let mut classification = None;
        let mut symptoms = None;
        let mut line = String::new();
        for _ in 0..32 {
            line.clear();
            if reader.read_line(&mut line)? == 0 {
                break;
            }
            let Some((raw_key, raw_value)) = line.trim_end().split_once(',') else {
                continue;
            };
            let key = clean_csv_value(raw_key).to_lowercase();
            let value = clean_csv_value(raw_value);
            match key.as_str() {
                "记录日期" | "recorded date" => recorded_at = Some(value),
                "分类" | "classification" => classification = Some(value),
                "症状" | "symptoms" if !value.is_empty() => symptoms = Some(value),
                _ => {}
            }
        }
        let (Some(recorded_at), Some(classification)) = (recorded_at, classification) else {
            continue;
        };
        let mut hash = Sha256::new();
        hash.update(recorded_at.as_bytes());
        hash.update([0]);
        hash.update(classification.as_bytes());
        hash.update([0]);
        hash.update(source_file.as_bytes());
        summaries.push(EcgSummary {
            fingerprint: hex::encode(hash.finalize()),
            recorded_at,
            classification,
            symptoms,
            source_file,
        });
    }
    Ok(summaries)
}

fn sha256_file(path: &Path) -> AppResult<String> {
    let mut file = BufReader::new(File::open(path)?);
    let mut hash = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hash.update(&buffer[..read]);
    }
    Ok(hex::encode(hash.finalize()))
}

fn xml_attributes(event: &BytesStart<'_>) -> AppResult<HashMap<String, String>> {
    let mut output = HashMap::new();
    for attribute in event.attributes().with_checks(false) {
        let attribute = attribute.map_err(|error| AppError::Xml(error.to_string()))?;
        let key = String::from_utf8_lossy(attribute.key.as_ref()).into_owned();
        let raw = String::from_utf8_lossy(attribute.value.as_ref());
        let value = quick_xml::escape::unescape(&raw)
            .map_err(|error| AppError::Xml(error.to_string()))?
            .into_owned();
        output.insert(key, value);
    }
    Ok(output)
}

fn row_builder(kind: &str, attributes: HashMap<String, String>) -> Option<RowBuilder> {
    let start_date = attributes.get("startDate")?.clone();
    let end_date = attributes
        .get("endDate")
        .cloned()
        .unwrap_or_else(|| start_date.clone());
    if kind == "workout" {
        let mut metadata = Map::new();
        for (key, value) in &attributes {
            metadata.insert(key.clone(), Value::String(value.clone()));
        }
        Some(RowBuilder {
            kind: kind.into(),
            type_identifier: attributes
                .get("workoutActivityType")
                .cloned()
                .unwrap_or_else(|| "HKWorkoutActivityTypeOther".into()),
            value: attributes.get("duration").cloned(),
            unit: attributes.get("durationUnit").cloned(),
            start_date,
            end_date,
            source_name: attributes.get("sourceName").cloned(),
            metadata,
        })
    } else {
        Some(RowBuilder {
            kind: kind.into(),
            type_identifier: attributes.get("type")?.clone(),
            value: attributes.get("value").cloned(),
            unit: attributes.get("unit").cloned(),
            start_date,
            end_date,
            source_name: attributes.get("sourceName").cloned(),
            metadata: Map::new(),
        })
    }
}

fn finish_row(builder: RowBuilder) -> AppResult<HealthRow> {
    let metadata_json = serde_json::to_string(&builder.metadata)?;
    let mut hash = Sha256::new();
    for part in [
        builder.kind.as_str(),
        builder.type_identifier.as_str(),
        builder.value.as_deref().unwrap_or_default(),
        builder.unit.as_deref().unwrap_or_default(),
        builder.start_date.as_str(),
        builder.end_date.as_str(),
        builder.source_name.as_deref().unwrap_or_default(),
        metadata_json.as_str(),
    ] {
        hash.update(part.as_bytes());
        hash.update([0]);
    }
    Ok(HealthRow {
        kind: builder.kind,
        type_identifier: builder.type_identifier,
        value: builder.value,
        unit: builder.unit,
        start_date: builder.start_date,
        end_date: builder.end_date,
        source_name: builder.source_name,
        metadata_json,
        fingerprint: hex::encode(hash.finalize()),
    })
}

fn complete_date(export_date: Option<&str>, fallback: Option<&str>) -> Option<String> {
    export_date
        .and_then(|value| DateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S %z").ok())
        .map(|date| date.date_naive())
        .or_else(|| {
            fallback.and_then(|value| chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
        })
        .and_then(|date| date.checked_sub_days(Days::new(1)))
        .map(|date| date.format("%Y-%m-%d").to_string())
}

fn profile_age_years(date_of_birth: Option<&str>, export_date: Option<&str>) -> Option<f64> {
    let birth =
        date_of_birth.and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())?;
    let measured = export_date
        .and_then(|value| DateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S %z").ok())?
        .date_naive();
    let days = measured.signed_duration_since(birth).num_days();
    (days >= 0).then_some(days as f64 / 365.2425)
}

fn normalized_biological_sex(value: Option<&str>) -> Option<String> {
    match value.unwrap_or_default() {
        "HKBiologicalSexMale" => Some("male".into()),
        "HKBiologicalSexFemale" => Some("female".into()),
        "HKBiologicalSexOther" => Some("other".into()),
        "HKBiologicalSexNotSet" => Some("notSet".into()),
        _ => None,
    }
}

fn import_zip(
    app: &AppHandle,
    path: &Path,
    display_name: Option<String>,
    source_hash_override: Option<String>,
) -> AppResult<DashboardPayload> {
    emit_progress(app, "validating", 3.0, "正在检查 ZIP 路径和大小", None);
    let inventory = inspect_archive(&path)?;
    let ecg_summaries = parse_ecg_summaries(&path, &inventory.ecg_indices)?;
    emit_progress(app, "hashing", 10.0, "正在计算文件指纹", None);
    let source_hash = source_hash_override.unwrap_or(sha256_file(path)?);
    let mut connection = open_database(app)?;
    let already_imported: Option<String> = connection
        .query_row(
            "SELECT import_id FROM imports WHERE source_hash = ?1 AND status = 'complete'",
            [&source_hash],
            |row| row.get(0),
        )
        .optional()?;
    if already_imported.is_some() {
        emit_progress(app, "done", 100.0, "该文件已经导入，无需重复处理", None);
        return load_dashboard_from_connection(&connection);
    }

    let import_id = Uuid::new_v4().to_string();
    let imported_at = Utc::now().to_rfc3339();
    let file_name = display_name.unwrap_or_else(|| {
        path.file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_else(|| "Apple 健康导出.zip".into())
    });
    let transaction = connection.transaction()?;
    transaction.execute(
        r#"
        INSERT INTO imports(import_id, file_name, source_hash, imported_at, status, ecg_files_seen, route_files_seen)
        VALUES (?1, ?2, ?3, ?4, 'processing', ?5, ?6)
        "#,
        params![import_id, file_name, source_hash, imported_at, inventory.ecg_indices.len() as u64, inventory.route_files],
    )?;

    {
        let mut insert_ecg = transaction.prepare_cached(
            r#"
            INSERT INTO ecg_summaries(
                fingerprint, recorded_at, classification, symptoms, source_file,
                first_seen_import, last_seen_import
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
            ON CONFLICT(fingerprint) DO UPDATE SET last_seen_import = excluded.last_seen_import
            "#,
        )?;
        for ecg in &ecg_summaries {
            insert_ecg.execute(params![
                ecg.fingerprint,
                ecg.recorded_at,
                ecg.classification,
                ecg.symptoms,
                ecg.source_file,
                import_id,
            ])?;
        }
    }

    let mut archive = ZipArchive::new(File::open(&path)?)?;
    let xml = archive.by_index(inventory.health_xml_index)?;
    let mut reader = Reader::from_reader(BufReader::new(xml));
    reader.config_mut().trim_text(true);
    let mut buffer = Vec::with_capacity(32 * 1024);
    let mut pending: Option<RowBuilder> = None;
    let mut export_date: Option<String> = None;
    // Exact birth date is kept only in memory long enough to calculate age; it is never persisted.
    let mut date_of_birth: Option<String> = None;
    let mut biological_sex: Option<String> = None;
    let mut records_seen = 0_u64;
    let mut records_inserted = 0_u64;
    let mut records_updated = 0_u64;
    let mut workouts_seen = 0_u64;
    let mut first_date: Option<String> = None;
    let mut last_date: Option<String> = None;
    let mut insert = transaction.prepare_cached(
        r#"
        INSERT OR IGNORE INTO health_records(
            fingerprint, kind, type_identifier, value, unit, start_date, end_date,
            source_name, metadata_json, first_seen_import, last_seen_import
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
        "#,
    )?;
    let mut update = transaction.prepare_cached(
        "UPDATE health_records SET last_seen_import = ?2, metadata_json = ?3 WHERE fingerprint = ?1",
    )?;

    let mut persist = |row: HealthRow| -> AppResult<()> {
        let date = row.start_date.get(0..10).map(ToOwned::to_owned);
        if let Some(date) = date {
            if first_date.as_ref().is_none_or(|current| date < *current) {
                first_date = Some(date.clone());
            }
            if last_date.as_ref().is_none_or(|current| date > *current) {
                last_date = Some(date);
            }
        }
        let changed = insert.execute(params![
            row.fingerprint,
            row.kind,
            row.type_identifier,
            row.value,
            row.unit,
            row.start_date,
            row.end_date,
            row.source_name,
            row.metadata_json,
            import_id,
        ])?;
        if changed == 1 {
            records_inserted += 1;
        } else {
            update.execute(params![row.fingerprint, import_id, row.metadata_json])?;
            records_updated += 1;
        }
        Ok(())
    };

    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Eof) => break,
            Ok(Event::Empty(event)) => match event.name().as_ref() {
                b"ExportDate" => {
                    export_date = xml_attributes(&event)?.get("value").cloned();
                }
                b"Me" => {
                    let attributes = xml_attributes(&event)?;
                    date_of_birth = attributes
                        .get("HKCharacteristicTypeIdentifierDateOfBirth")
                        .cloned();
                    biological_sex = attributes
                        .get("HKCharacteristicTypeIdentifierBiologicalSex")
                        .cloned();
                }
                b"Record" => {
                    records_seen += 1;
                    if let Some(builder) = row_builder("record", xml_attributes(&event)?) {
                        persist(finish_row(builder)?)?;
                    }
                }
                b"Workout" => {
                    workouts_seen += 1;
                    if let Some(builder) = row_builder("workout", xml_attributes(&event)?) {
                        persist(finish_row(builder)?)?;
                    }
                }
                b"MetadataEntry" => {
                    if let Some(builder) = pending.as_mut() {
                        let attributes = xml_attributes(&event)?;
                        if let (Some(key), Some(value)) =
                            (attributes.get("key"), attributes.get("value"))
                        {
                            builder
                                .metadata
                                .insert(key.clone(), Value::String(value.clone()));
                        }
                    }
                }
                _ => {}
            },
            Ok(Event::Start(event)) => match event.name().as_ref() {
                b"Record" => {
                    records_seen += 1;
                    pending = row_builder("record", xml_attributes(&event)?);
                }
                b"Workout" => {
                    workouts_seen += 1;
                    pending = row_builder("workout", xml_attributes(&event)?);
                }
                _ => {}
            },
            Ok(Event::End(event))
                if event.name().as_ref() == b"Record" || event.name().as_ref() == b"Workout" =>
            {
                if let Some(builder) = pending.take() {
                    persist(finish_row(builder)?)?;
                }
            }
            Ok(_) => {}
            Err(error) => {
                return Err(AppError::Xml(format!(
                    "位置 {}：{}",
                    reader.buffer_position(),
                    error
                )));
            }
        }
        if records_seen > 0 && records_seen % 10_000 == 0 {
            let fraction =
                reader.buffer_position() as f64 / inventory.health_xml_size.max(1) as f64;
            emit_progress(
                app,
                "parsing",
                15.0 + fraction.min(1.0) * 72.0,
                "正在流式解析健康记录",
                Some(records_seen),
            );
        }
        buffer.clear();
    }
    drop(persist);
    drop(insert);
    drop(update);

    emit_progress(
        app,
        "storing",
        90.0,
        "正在提交本地数据库事务",
        Some(records_seen),
    );
    let last_complete_date = complete_date(export_date.as_deref(), last_date.as_deref());
    let chronological_age_years =
        profile_age_years(date_of_birth.as_deref(), export_date.as_deref());
    let normalized_sex = normalized_biological_sex(biological_sex.as_deref());
    transaction.execute(
        r#"
        INSERT INTO profile_context(import_id, chronological_age_years, biological_sex, measured_at)
        VALUES (?1, ?2, ?3, ?4)
        "#,
        params![
            import_id,
            chronological_age_years,
            normalized_sex,
            export_date
        ],
    )?;
    transaction.execute(
        r#"
        UPDATE imports
           SET export_date = ?2, status = 'complete', records_seen = ?3,
               records_inserted = ?4, records_updated = ?5, workouts_seen = ?6,
               first_date = ?7, last_complete_date = ?8
         WHERE import_id = ?1
        "#,
        params![
            import_id,
            export_date,
            records_seen,
            records_inserted,
            records_updated,
            workouts_seen,
            first_date,
            last_complete_date,
        ],
    )?;
    transaction.commit()?;
    emit_progress(
        app,
        "aggregating",
        96.0,
        "正在生成 7 天与 30 天指标",
        Some(records_seen),
    );
    let dashboard = load_dashboard_from_connection(&connection)?;
    emit_progress(app, "done", 100.0, "导入完成", Some(records_seen));
    Ok(dashboard)
}

pub fn import_health_export(app: &AppHandle, input: String) -> AppResult<DashboardPayload> {
    let path = PathBuf::from(input);
    validate_input(&path)?;
    if path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("zip"))
    {
        return import_zip(app, &path, None, None);
    }

    emit_progress(app, "validating", 2.0, "正在准备 Apple 健康 XML", None);
    let original_hash = sha256_file(&path)?;
    let display_name = path
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "export.xml".into());
    let temporary_zip =
        std::env::temp_dir().join(format!("watch-health-lens-{}.zip", Uuid::new_v4()));
    let result = (|| -> AppResult<DashboardPayload> {
        let output = File::create(&temporary_zip)?;
        let mut archive = ZipWriter::new(output);
        archive.start_file(
            "apple_health_export/export.xml",
            SimpleFileOptions::default().compression_method(CompressionMethod::Deflated),
        )?;
        let mut xml = File::open(&path)?;
        std::io::copy(&mut xml, &mut archive)?;
        archive.finish()?;
        import_zip(app, &temporary_zip, Some(display_name), Some(original_hash))
    })();
    let _ = fs::remove_file(&temporary_zip);
    result
}

#[cfg(test)]
mod tests {
    use super::validate_input;
    use std::fs;

    #[test]
    fn accepts_direct_health_xml_input() {
        let path = std::env::temp_dir().join(format!("health-export-{}.xml", uuid::Uuid::new_v4()));
        fs::write(&path, b"<HealthData locale=\"zh_CN\"></HealthData>").unwrap();
        let result = validate_input(&path);
        let _ = fs::remove_file(path);
        assert!(result.is_ok());
    }

    #[test]
    fn rejects_unsupported_input_extensions() {
        let path = std::env::temp_dir().join(format!("health-export-{}.txt", uuid::Uuid::new_v4()));
        fs::write(&path, b"not an Apple Health export").unwrap();
        let result = validate_input(&path);
        let _ = fs::remove_file(path);
        assert!(result.is_err());
    }
}
