use std::collections::BTreeMap;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
    pub phase: &'static str,
    pub percent: f64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub records_processed: Option<u64>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub import_id: String,
    pub file_name: String,
    pub imported_at: String,
    pub export_date: Option<String>,
    pub records_seen: u64,
    pub records_inserted: u64,
    pub records_updated: u64,
    pub workouts_seen: u64,
    pub ecg_files_seen: u64,
    pub route_files_seen: u64,
    pub first_date: Option<String>,
    pub last_complete_date: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyHealth {
    pub date: String,
    pub complete: bool,
    pub sleep_hours: Option<f64>,
    pub sleep_start_minutes: Option<f64>,
    pub sleep_end_minutes: Option<f64>,
    pub awake_minutes: Option<f64>,
    pub in_bed_hours: Option<f64>,
    pub rem_sleep_hours: Option<f64>,
    pub core_sleep_hours: Option<f64>,
    pub deep_sleep_hours: Option<f64>,
    pub sleep_efficiency_percentage: Option<f64>,
    pub heart_rate_average: Option<f64>,
    pub heart_rate_minimum: Option<f64>,
    pub heart_rate_maximum: Option<f64>,
    pub resting_heart_rate: Option<f64>,
    pub walking_heart_rate_average: Option<f64>,
    pub heart_rate_variability: Option<f64>,
    pub respiratory_rate: Option<f64>,
    pub oxygen_saturation: Option<f64>,
    pub wrist_temperature_delta: Option<f64>,
    pub vo2_max: Option<f64>,
    pub heart_rate_recovery_one_minute: Option<f64>,
    pub active_energy_kcal: Option<f64>,
    pub basal_energy_kcal: Option<f64>,
    pub exercise_minutes: Option<f64>,
    pub workout_minutes: Option<f64>,
    pub steps: Option<f64>,
    pub walking_running_distance_km: Option<f64>,
    pub stand_minutes: Option<f64>,
    pub flights_climbed: Option<f64>,
    pub walking_speed: Option<f64>,
    pub walking_step_length_cm: Option<f64>,
    pub walking_asymmetry_percentage: Option<f64>,
    pub walking_double_support_percentage: Option<f64>,
    pub stair_ascent_speed: Option<f64>,
    pub stair_descent_speed: Option<f64>,
    pub time_in_daylight_minutes: Option<f64>,
    pub high_heart_rate_events: u64,
    pub high_heart_rate_minutes: f64,
    pub high_events_during_workout: u64,
    pub low_heart_rate_events: u64,
    pub low_heart_rate_minutes: f64,
    pub low_events_during_sleep: u64,
    pub irregular_rhythm_events: u64,
    pub ecg_abnormal_count: u64,
    pub coverage: Vec<String>,
    pub sources: Vec<String>,
    pub sample_counts: BTreeMap<String, u64>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileContext {
    pub chronological_age_years: Option<f64>,
    pub biological_sex: Option<String>,
    pub measured_at: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub import_summary: Option<ImportSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile: Option<ProfileContext>,
    pub days: Vec<DailyHealth>,
    pub history_days: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_freshness: Option<String>,
}

#[derive(Debug, Clone)]
pub struct HealthRow {
    pub kind: String,
    pub type_identifier: String,
    pub value: Option<String>,
    pub unit: Option<String>,
    pub start_date: String,
    pub end_date: String,
    pub source_name: Option<String>,
    pub metadata_json: String,
    pub fingerprint: String,
}
