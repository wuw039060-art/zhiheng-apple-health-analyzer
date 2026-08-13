use std::collections::BTreeMap;

use chrono::{DateTime, FixedOffset, NaiveDate};
use rusqlite::{Connection, OptionalExtension};

use crate::{
    db::latest_import_summary,
    error::AppResult,
    models::{DailyHealth, DashboardPayload, ProfileContext},
};

const SLEEP: &str = "HKCategoryTypeIdentifierSleepAnalysis";
const HEART_RATE: &str = "HKQuantityTypeIdentifierHeartRate";
const RHR: &str = "HKQuantityTypeIdentifierRestingHeartRate";
const WALKING_HEART_RATE: &str = "HKQuantityTypeIdentifierWalkingHeartRateAverage";
const HRV: &str = "HKQuantityTypeIdentifierHeartRateVariabilitySDNN";
const RESPIRATORY: &str = "HKQuantityTypeIdentifierRespiratoryRate";
const OXYGEN: &str = "HKQuantityTypeIdentifierOxygenSaturation";
const WRIST_TEMPERATURE: &str = "HKQuantityTypeIdentifierAppleSleepingWristTemperature";
const VO2_MAX: &str = "HKQuantityTypeIdentifierVO2Max";
const HEART_RATE_RECOVERY: &str = "HKQuantityTypeIdentifierHeartRateRecoveryOneMinute";
const ACTIVE_ENERGY: &str = "HKQuantityTypeIdentifierActiveEnergyBurned";
const BASAL_ENERGY: &str = "HKQuantityTypeIdentifierBasalEnergyBurned";
const EXERCISE: &str = "HKQuantityTypeIdentifierAppleExerciseTime";
const STEPS: &str = "HKQuantityTypeIdentifierStepCount";
const DISTANCE: &str = "HKQuantityTypeIdentifierDistanceWalkingRunning";
const STAND_TIME: &str = "HKQuantityTypeIdentifierAppleStandTime";
const FLIGHTS: &str = "HKQuantityTypeIdentifierFlightsClimbed";
const WALKING_SPEED: &str = "HKQuantityTypeIdentifierWalkingSpeed";
const STEP_LENGTH: &str = "HKQuantityTypeIdentifierWalkingStepLength";
const WALKING_ASYMMETRY: &str = "HKQuantityTypeIdentifierWalkingAsymmetryPercentage";
const DOUBLE_SUPPORT: &str = "HKQuantityTypeIdentifierWalkingDoubleSupportPercentage";
const STAIR_ASCENT: &str = "HKQuantityTypeIdentifierStairAscentSpeed";
const STAIR_DESCENT: &str = "HKQuantityTypeIdentifierStairDescentSpeed";
const DAYLIGHT: &str = "HKQuantityTypeIdentifierTimeInDaylight";
const HIGH_HEART_RATE: &str = "HKCategoryTypeIdentifierHighHeartRateEvent";
const LOW_HEART_RATE: &str = "HKCategoryTypeIdentifierLowHeartRateEvent";
const IRREGULAR_RHYTHM: &str = "HKCategoryTypeIdentifierIrregularHeartRhythmEvent";

#[derive(Default)]
struct WorkingDay {
    sleep: Vec<(i64, i64)>,
    awake: Vec<(i64, i64)>,
    in_bed: Vec<(i64, i64)>,
    rem_sleep: Vec<(i64, i64)>,
    core_sleep: Vec<(i64, i64)>,
    deep_sleep: Vec<(i64, i64)>,
    workouts: Vec<(i64, i64)>,
    high_events: Vec<(i64, i64)>,
    low_events: Vec<(i64, i64)>,
    heart_rate: Vec<f64>,
    rhr: Vec<f64>,
    walking_heart_rate: Vec<f64>,
    hrv: Vec<f64>,
    respiratory: Vec<f64>,
    oxygen: Vec<f64>,
    wrist_temperature: Vec<f64>,
    vo2_max: Vec<f64>,
    heart_rate_recovery: Vec<f64>,
    active_energy_kcal: f64,
    basal_energy_kcal: f64,
    exercise_minutes: f64,
    workout_minutes: f64,
    steps: f64,
    walking_running_distance_km: f64,
    stand_minutes: f64,
    flights_climbed: f64,
    walking_speed: Vec<f64>,
    walking_step_length_cm: Vec<f64>,
    walking_asymmetry_percentage: Vec<f64>,
    walking_double_support_percentage: Vec<f64>,
    stair_ascent_speed: Vec<f64>,
    stair_descent_speed: Vec<f64>,
    time_in_daylight_minutes: f64,
    irregular_rhythm_events: u64,
    ecg_abnormal_count: u64,
    coverage: Vec<String>,
    sources: Vec<String>,
    sample_counts: BTreeMap<String, u64>,
}

fn parse_time(value: &str) -> Option<DateTime<FixedOffset>> {
    DateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S %z").ok()
}

fn date_part(value: &str) -> Option<String> {
    value.get(0..10).map(ToOwned::to_owned)
}

fn average(values: &[f64]) -> Option<f64> {
    (!values.is_empty()).then(|| values.iter().sum::<f64>() / values.len() as f64)
}

fn median(values: &[f64]) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let middle = sorted.len() / 2;
    Some(if sorted.len() % 2 == 0 {
        (sorted[middle - 1] + sorted[middle]) / 2.0
    } else {
        sorted[middle]
    })
}

fn merged_duration_minutes(intervals: &[(i64, i64)]) -> f64 {
    if intervals.is_empty() {
        return 0.0;
    }
    let mut sorted = intervals.to_vec();
    sorted.sort_unstable_by_key(|item| item.0);
    let mut total = 0_i64;
    let (mut start, mut end) = sorted[0];
    for (next_start, next_end) in sorted.into_iter().skip(1) {
        if next_start <= end {
            end = end.max(next_end);
        } else {
            total += (end - start).max(0);
            (start, end) = (next_start, next_end);
        }
    }
    total += (end - start).max(0);
    total as f64 / 60.0
}

fn overlaps(interval: (i64, i64), candidates: &[(i64, i64)]) -> bool {
    candidates
        .iter()
        .any(|candidate| interval.0 < candidate.1 && candidate.0 < interval.1)
}

fn add_coverage(working: &mut WorkingDay, label: &str) {
    if !working.coverage.iter().any(|item| item == label) {
        working.coverage.push(label.to_string());
    }
}

fn add_source(working: &mut WorkingDay, source: Option<&str>) {
    let Some(source) = source.map(str::trim).filter(|value| !value.is_empty()) else {
        return;
    };
    if !working.sources.iter().any(|item| item == source) {
        working.sources.push(source.to_string());
    }
}

fn add_sample(working: &mut WorkingDay, metric: &str) {
    *working.sample_counts.entry(metric.to_string()).or_default() += 1;
}

fn normalized_percentage(value: f64) -> f64 {
    if value <= 1.5 {
        value * 100.0
    } else {
        value
    }
}

fn timestamp_minutes(timestamp: i64) -> Option<f64> {
    DateTime::from_timestamp(timestamp, 0).map(|time| {
        let local = time.with_timezone(&FixedOffset::east_opt(8 * 3600).unwrap());
        local.format("%H").to_string().parse::<f64>().unwrap_or(0.0) * 60.0
            + local.format("%M").to_string().parse::<f64>().unwrap_or(0.0)
    })
}

fn normalized_oxygen(value: f64) -> f64 {
    if value <= 1.5 {
        value * 100.0
    } else {
        value
    }
}

pub fn load_dashboard_from_connection(connection: &Connection) -> AppResult<DashboardPayload> {
    let summary = latest_import_summary(connection)?;
    let Some(latest_summary) = summary.clone() else {
        return Ok(DashboardPayload::default());
    };
    let last_complete = latest_summary
        .last_complete_date
        .as_deref()
        .and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok());
    let earliest = last_complete
        .and_then(|date| date.checked_sub_days(chrono::Days::new(119)))
        .map(|date| date.format("%Y-%m-%d").to_string())
        .unwrap_or_else(|| "0000-01-01".to_string());

    let mut days: BTreeMap<String, WorkingDay> = BTreeMap::new();
    let mut statement = connection.prepare(
        r#"
        SELECT kind, type_identifier, value, unit, start_date, end_date, source_name
          FROM health_records
         WHERE substr(start_date, 1, 10) >= ?1
           AND (
                kind = 'workout' OR type_identifier IN (
                  'HKCategoryTypeIdentifierSleepAnalysis',
                  'HKQuantityTypeIdentifierHeartRate',
                  'HKQuantityTypeIdentifierRestingHeartRate',
                  'HKQuantityTypeIdentifierWalkingHeartRateAverage',
                  'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
                  'HKQuantityTypeIdentifierRespiratoryRate',
                  'HKQuantityTypeIdentifierOxygenSaturation',
                  'HKQuantityTypeIdentifierAppleSleepingWristTemperature',
                  'HKQuantityTypeIdentifierVO2Max',
                  'HKQuantityTypeIdentifierHeartRateRecoveryOneMinute',
                  'HKQuantityTypeIdentifierActiveEnergyBurned',
                  'HKQuantityTypeIdentifierBasalEnergyBurned',
                  'HKQuantityTypeIdentifierAppleExerciseTime',
                  'HKQuantityTypeIdentifierStepCount',
                  'HKQuantityTypeIdentifierDistanceWalkingRunning',
                  'HKQuantityTypeIdentifierAppleStandTime',
                  'HKQuantityTypeIdentifierFlightsClimbed',
                  'HKQuantityTypeIdentifierWalkingSpeed',
                  'HKQuantityTypeIdentifierWalkingStepLength',
                  'HKQuantityTypeIdentifierWalkingAsymmetryPercentage',
                  'HKQuantityTypeIdentifierWalkingDoubleSupportPercentage',
                  'HKQuantityTypeIdentifierStairAscentSpeed',
                  'HKQuantityTypeIdentifierStairDescentSpeed',
                  'HKQuantityTypeIdentifierTimeInDaylight',
                  'HKCategoryTypeIdentifierHighHeartRateEvent',
                  'HKCategoryTypeIdentifierLowHeartRateEvent',
                  'HKCategoryTypeIdentifierIrregularHeartRhythmEvent'
                )
           )
         ORDER BY start_date
        "#,
    )?;
    let rows = statement.query_map([earliest.as_str()], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, String>(5)?,
            row.get::<_, Option<String>>(6)?,
        ))
    })?;

    for row in rows {
        let (kind, metric, value, unit, start, end, source_name) = row?;
        let Some(start_time) = parse_time(&start) else {
            continue;
        };
        let end_time = parse_time(&end).unwrap_or(start_time);
        let interval = (
            start_time.timestamp(),
            end_time.timestamp().max(start_time.timestamp() + 1),
        );
        let date = if metric == SLEEP {
            date_part(&end)
        } else {
            date_part(&start)
        };
        let Some(date) = date else { continue };
        let working = days.entry(date).or_default();
        add_source(working, source_name.as_deref());
        add_sample(
            working,
            if kind == "workout" {
                "workout"
            } else {
                metric.as_str()
            },
        );
        let number = value.as_deref().and_then(|item| item.parse::<f64>().ok());

        if kind == "workout" {
            working.workouts.push(interval);
            working.workout_minutes += (interval.1 - interval.0).max(0) as f64 / 60.0;
            add_coverage(working, "workout");
            continue;
        }

        match metric.as_str() {
            SLEEP => {
                let category = value.as_deref().unwrap_or_default();
                if category.contains("InBed") {
                    working.in_bed.push(interval);
                }
                if category.contains("Asleep") {
                    working.sleep.push(interval);
                    if category.contains("REM") {
                        working.rem_sleep.push(interval);
                    }
                    if category.contains("Core") {
                        working.core_sleep.push(interval);
                    }
                    if category.contains("Deep") {
                        working.deep_sleep.push(interval);
                    }
                    add_coverage(working, "sleep");
                } else if category.contains("Awake") {
                    working.awake.push(interval);
                }
            }
            HEART_RATE => {
                if let Some(value) = number {
                    working.heart_rate.push(value);
                    add_coverage(working, "heart");
                }
            }
            RHR => {
                if let Some(value) = number {
                    working.rhr.push(value);
                    add_coverage(working, "heart");
                }
            }
            WALKING_HEART_RATE => {
                if let Some(value) = number {
                    working.walking_heart_rate.push(value);
                    add_coverage(working, "heart");
                }
            }
            HRV => {
                if let Some(value) = number {
                    working.hrv.push(value);
                    add_coverage(working, "heart");
                }
            }
            RESPIRATORY => {
                if let Some(value) = number {
                    working.respiratory.push(value);
                    add_coverage(working, "respiratory");
                }
            }
            OXYGEN => {
                if let Some(value) = number {
                    working.oxygen.push(normalized_oxygen(value));
                    add_coverage(working, "oxygen");
                }
            }
            WRIST_TEMPERATURE => {
                if let Some(value) = number {
                    working.wrist_temperature.push(value);
                    add_coverage(working, "temperature");
                }
            }
            VO2_MAX => {
                if let Some(value) = number {
                    working.vo2_max.push(value);
                    add_coverage(working, "cardio-fitness");
                }
            }
            HEART_RATE_RECOVERY => {
                if let Some(value) = number {
                    working.heart_rate_recovery.push(value);
                    add_coverage(working, "recovery");
                }
            }
            ACTIVE_ENERGY => {
                if let Some(mut value) = number {
                    if unit
                        .as_deref()
                        .is_some_and(|item| item.eq_ignore_ascii_case("kj"))
                    {
                        value /= 4.184;
                    }
                    working.active_energy_kcal += value;
                    add_coverage(working, "activity");
                }
            }
            BASAL_ENERGY => {
                if let Some(mut value) = number {
                    if unit
                        .as_deref()
                        .is_some_and(|item| item.eq_ignore_ascii_case("kj"))
                    {
                        value /= 4.184;
                    }
                    working.basal_energy_kcal += value;
                    add_coverage(working, "energy");
                }
            }
            EXERCISE => {
                if let Some(value) = number {
                    working.exercise_minutes += value;
                    add_coverage(working, "activity");
                }
            }
            STEPS => {
                if let Some(value) = number {
                    working.steps += value;
                    add_coverage(working, "activity");
                }
            }
            DISTANCE => {
                if let Some(mut value) = number {
                    if unit
                        .as_deref()
                        .is_some_and(|item| item.eq_ignore_ascii_case("m"))
                    {
                        value /= 1000.0;
                    }
                    working.walking_running_distance_km += value;
                    add_coverage(working, "mobility");
                }
            }
            STAND_TIME => {
                if let Some(value) = number {
                    working.stand_minutes += value;
                    add_coverage(working, "activity");
                }
            }
            FLIGHTS => {
                if let Some(value) = number {
                    working.flights_climbed += value;
                    add_coverage(working, "mobility");
                }
            }
            WALKING_SPEED => {
                if let Some(value) = number {
                    working.walking_speed.push(value);
                    add_coverage(working, "mobility");
                }
            }
            STEP_LENGTH => {
                if let Some(mut value) = number {
                    if unit
                        .as_deref()
                        .is_some_and(|item| item.eq_ignore_ascii_case("m"))
                    {
                        value *= 100.0;
                    }
                    working.walking_step_length_cm.push(value);
                    add_coverage(working, "mobility");
                }
            }
            WALKING_ASYMMETRY => {
                if let Some(value) = number {
                    working
                        .walking_asymmetry_percentage
                        .push(normalized_percentage(value));
                    add_coverage(working, "mobility");
                }
            }
            DOUBLE_SUPPORT => {
                if let Some(value) = number {
                    working
                        .walking_double_support_percentage
                        .push(normalized_percentage(value));
                    add_coverage(working, "mobility");
                }
            }
            STAIR_ASCENT => {
                if let Some(value) = number {
                    working.stair_ascent_speed.push(value);
                    add_coverage(working, "mobility");
                }
            }
            STAIR_DESCENT => {
                if let Some(value) = number {
                    working.stair_descent_speed.push(value);
                    add_coverage(working, "mobility");
                }
            }
            DAYLIGHT => {
                if let Some(value) = number {
                    working.time_in_daylight_minutes += value;
                    add_coverage(working, "daylight");
                }
            }
            HIGH_HEART_RATE => {
                working.high_events.push(interval);
                add_coverage(working, "heart-events");
            }
            LOW_HEART_RATE => {
                working.low_events.push(interval);
                add_coverage(working, "heart-events");
            }
            IRREGULAR_RHYTHM => {
                working.irregular_rhythm_events += 1;
                add_coverage(working, "heart-events");
            }
            _ => {}
        }
    }

    let mut ecg_statement = connection.prepare(
        r#"
        SELECT substr(recorded_at, 1, 10), COUNT(*)
          FROM ecg_summaries
         WHERE substr(recorded_at, 1, 10) >= ?1
           AND lower(trim(classification)) NOT IN ('sinus rhythm', '窦性心律')
         GROUP BY substr(recorded_at, 1, 10)
        "#,
    )?;
    let ecg_rows = ecg_statement.query_map([earliest.as_str()], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;
    for row in ecg_rows {
        let (date, count) = row?;
        let working = days.entry(date).or_default();
        working.ecg_abnormal_count = count as u64;
        add_coverage(working, "ecg");
    }

    let all_temperatures: Vec<f64> = days
        .values()
        .filter_map(|day| median(&day.wrist_temperature))
        .collect();
    let temperature_center = median(&all_temperatures);
    let mut output = Vec::with_capacity(days.len());
    for (date, working) in days {
        let sleep_minutes = merged_duration_minutes(&working.sleep);
        let sleep_start_minutes = working
            .sleep
            .iter()
            .map(|item| item.0)
            .min()
            .and_then(timestamp_minutes);
        let sleep_end_minutes = working
            .sleep
            .iter()
            .map(|item| item.1)
            .max()
            .and_then(timestamp_minutes);
        let in_bed_minutes = merged_duration_minutes(&working.in_bed);
        let awake_minutes = merged_duration_minutes(&working.awake);
        let sleep_denominator = if in_bed_minutes > 0.0 {
            in_bed_minutes
        } else {
            sleep_minutes + awake_minutes
        };
        let wrist = median(&working.wrist_temperature)
            .zip(temperature_center)
            .map(|(value, center)| value - center);
        let complete = latest_summary
            .last_complete_date
            .as_ref()
            .is_none_or(|last| date <= *last);
        output.push(DailyHealth {
            date,
            complete,
            sleep_hours: (!working.sleep.is_empty()).then_some(sleep_minutes / 60.0),
            sleep_start_minutes,
            sleep_end_minutes,
            awake_minutes: (!working.awake.is_empty()).then_some(awake_minutes),
            in_bed_hours: (in_bed_minutes > 0.0).then_some(in_bed_minutes / 60.0),
            rem_sleep_hours: (!working.rem_sleep.is_empty())
                .then_some(merged_duration_minutes(&working.rem_sleep) / 60.0),
            core_sleep_hours: (!working.core_sleep.is_empty())
                .then_some(merged_duration_minutes(&working.core_sleep) / 60.0),
            deep_sleep_hours: (!working.deep_sleep.is_empty())
                .then_some(merged_duration_minutes(&working.deep_sleep) / 60.0),
            sleep_efficiency_percentage: (sleep_denominator > 0.0)
                .then_some((sleep_minutes / sleep_denominator * 100.0).min(100.0)),
            heart_rate_average: average(&working.heart_rate),
            heart_rate_minimum: working.heart_rate.iter().copied().min_by(f64::total_cmp),
            heart_rate_maximum: working.heart_rate.iter().copied().max_by(f64::total_cmp),
            resting_heart_rate: average(&working.rhr),
            walking_heart_rate_average: average(&working.walking_heart_rate),
            heart_rate_variability: average(&working.hrv),
            respiratory_rate: average(&working.respiratory),
            oxygen_saturation: median(&working.oxygen),
            wrist_temperature_delta: wrist,
            vo2_max: median(&working.vo2_max),
            heart_rate_recovery_one_minute: median(&working.heart_rate_recovery),
            active_energy_kcal: (working.active_energy_kcal > 0.0)
                .then_some(working.active_energy_kcal),
            basal_energy_kcal: (working.basal_energy_kcal > 0.0)
                .then_some(working.basal_energy_kcal),
            exercise_minutes: (working.exercise_minutes > 0.0).then_some(working.exercise_minutes),
            workout_minutes: (working.workout_minutes > 0.0).then_some(working.workout_minutes),
            steps: (working.steps > 0.0).then_some(working.steps),
            walking_running_distance_km: (working.walking_running_distance_km > 0.0)
                .then_some(working.walking_running_distance_km),
            stand_minutes: (working.stand_minutes > 0.0).then_some(working.stand_minutes),
            flights_climbed: (working.flights_climbed > 0.0).then_some(working.flights_climbed),
            walking_speed: median(&working.walking_speed),
            walking_step_length_cm: median(&working.walking_step_length_cm),
            walking_asymmetry_percentage: median(&working.walking_asymmetry_percentage),
            walking_double_support_percentage: median(&working.walking_double_support_percentage),
            stair_ascent_speed: median(&working.stair_ascent_speed),
            stair_descent_speed: median(&working.stair_descent_speed),
            time_in_daylight_minutes: (working.time_in_daylight_minutes > 0.0)
                .then_some(working.time_in_daylight_minutes),
            high_heart_rate_events: working.high_events.len() as u64,
            high_heart_rate_minutes: merged_duration_minutes(&working.high_events),
            high_events_during_workout: working
                .high_events
                .iter()
                .filter(|item| overlaps(**item, &working.workouts))
                .count() as u64,
            low_heart_rate_events: working.low_events.len() as u64,
            low_heart_rate_minutes: merged_duration_minutes(&working.low_events),
            low_events_during_sleep: working
                .low_events
                .iter()
                .filter(|item| overlaps(**item, &working.sleep))
                .count() as u64,
            irregular_rhythm_events: working.irregular_rhythm_events,
            ecg_abnormal_count: working.ecg_abnormal_count,
            coverage: working.coverage,
            sources: working.sources,
            sample_counts: working.sample_counts,
        });
    }

    let history_days: i64 = connection.query_row(
        "SELECT COUNT(DISTINCT substr(start_date, 1, 10)) FROM health_records",
        [],
        |row| row.get(0),
    )?;
    let profile = connection
        .query_row(
            r#"
        SELECT chronological_age_years, biological_sex, measured_at
          FROM profile_context
         WHERE import_id = ?1
        "#,
            [&latest_summary.import_id],
            |row| {
                Ok(ProfileContext {
                    chronological_age_years: row.get(0)?,
                    biological_sex: row.get(1)?,
                    measured_at: row.get(2)?,
                })
            },
        )
        .optional()?;
    Ok(DashboardPayload {
        import_summary: summary,
        profile,
        days: output,
        history_days: history_days as u64,
        source_freshness: Some(latest_summary.imported_at),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merges_overlapping_sleep_segments() {
        assert_eq!(
            merged_duration_minutes(&[(0, 600), (300, 900), (1200, 1800)]),
            25.0
        );
    }

    #[test]
    fn detects_interval_overlap() {
        assert!(overlaps((10, 20), &[(0, 12)]));
        assert!(!overlaps((20, 30), &[(0, 20)]));
    }
}
