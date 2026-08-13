mod aggregate;
mod db;
mod error;
mod importer;
mod models;

use models::DashboardPayload;
use tauri::AppHandle;

#[tauri::command]
async fn import_health_export(app: AppHandle, path: String) -> Result<DashboardPayload, String> {
    tauri::async_runtime::spawn_blocking(move || importer::import_health_export(&app, path))
        .await
        .map_err(|error| format!("导入任务异常结束：{error}"))?
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn load_dashboard(app: AppHandle) -> Result<DashboardPayload, String> {
    let connection = db::open_database(&app).map_err(|error| error.to_string())?;
    aggregate::load_dashboard_from_connection(&connection).map_err(|error| error.to_string())
}

#[tauri::command]
fn export_health_data(app: AppHandle, path: String) -> Result<u64, String> {
    let connection = db::open_database(&app).map_err(|error| error.to_string())?;
    db::export_health_records(&connection, std::path::Path::new(&path))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_health_date(app: AppHandle, date: String) -> Result<DashboardPayload, String> {
    let mut connection = db::open_database(&app).map_err(|error| error.to_string())?;
    db::delete_health_date(&mut connection, &date).map_err(|error| error.to_string())?;
    aggregate::load_dashboard_from_connection(&connection).map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_health_metric(
    app: AppHandle,
    type_identifier: String,
) -> Result<DashboardPayload, String> {
    let mut connection = db::open_database(&app).map_err(|error| error.to_string())?;
    db::delete_health_metric(&mut connection, &type_identifier)
        .map_err(|error| error.to_string())?;
    aggregate::load_dashboard_from_connection(&connection).map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_all_health_data(app: AppHandle) -> Result<DashboardPayload, String> {
    let mut connection = db::open_database(&app).map_err(|error| error.to_string())?;
    db::delete_all_health_data(&mut connection).map_err(|error| error.to_string())?;
    aggregate::load_dashboard_from_connection(&connection).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            import_health_export,
            load_dashboard,
            export_health_data,
            delete_health_date,
            delete_health_metric,
            delete_all_health_data
        ])
        .run(tauri::generate_context!())
        .expect("failed to run desktop application");
}
