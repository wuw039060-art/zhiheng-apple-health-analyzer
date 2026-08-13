export type PeriodDays = 7 | 30 | 90 | 180 | 365;

export interface DailyHealth {
  date: string;
  complete: boolean;
  sleepHours?: number;
  sleepStartMinutes?: number;
  sleepEndMinutes?: number;
  awakeMinutes?: number;
  inBedHours?: number;
  remSleepHours?: number;
  coreSleepHours?: number;
  deepSleepHours?: number;
  sleepEfficiencyPercentage?: number;
  heartRateAverage?: number;
  heartRateMinimum?: number;
  heartRateMaximum?: number;
  restingHeartRate?: number;
  walkingHeartRateAverage?: number;
  heartRateVariability?: number;
  respiratoryRate?: number;
  oxygenSaturation?: number;
  wristTemperatureDelta?: number;
  vo2Max?: number;
  heartRateRecoveryOneMinute?: number;
  activeEnergyKcal?: number;
  basalEnergyKcal?: number;
  exerciseMinutes?: number;
  workoutMinutes?: number;
  steps?: number;
  walkingRunningDistanceKm?: number;
  standMinutes?: number;
  flightsClimbed?: number;
  walkingSpeed?: number;
  walkingStepLengthCm?: number;
  walkingAsymmetryPercentage?: number;
  walkingDoubleSupportPercentage?: number;
  stairAscentSpeed?: number;
  stairDescentSpeed?: number;
  timeInDaylightMinutes?: number;
  highHeartRateEvents: number;
  highHeartRateMinutes: number;
  highEventsDuringWorkout: number;
  lowHeartRateEvents: number;
  lowHeartRateMinutes: number;
  lowEventsDuringSleep: number;
  irregularRhythmEvents: number;
  ecgAbnormalCount: number;
  coverage: string[];
  sources?: string[];
  sampleCounts?: Record<string, number>;
}

export type BiologicalSex = "male" | "female" | "other" | "notSet";

export interface ProfileContext {
  chronologicalAgeYears?: number;
  biologicalSex?: BiologicalSex;
  measuredAt?: string;
}

export interface ImportSummary {
  importId: string;
  fileName: string;
  importedAt: string;
  exportDate?: string;
  recordsSeen: number;
  recordsInserted: number;
  recordsUpdated: number;
  workoutsSeen: number;
  ecgFilesSeen: number;
  routeFilesSeen: number;
  firstDate?: string;
  lastCompleteDate?: string;
}

export interface DashboardPayload {
  importSummary?: ImportSummary;
  profile?: ProfileContext;
  days: DailyHealth[];
  historyDays: number;
  sourceFreshness?: string;
}

export type StateAgeRole = "age-anchor" | "modifier" | "context-only";

export interface StateAgeComponent {
  id: string;
  label: string;
  role: StateAgeRole;
  value: string;
  score?: number;
  ageEquivalent?: number;
  yearAdjustment: number;
  coverage: string;
  freshness: string;
  explanation: string;
  sourceIds: string[];
}

export interface StateAgeResult {
  status: "available" | "insufficient-data";
  age?: number;
  lower?: number;
  upper?: number;
  chronologicalAge?: number;
  difference?: number;
  confidence: "较高" | "中等" | "有限";
  confidenceScore: number;
  modelVersion: string;
  periodStart?: string;
  periodEnd?: string;
  primaryReason?: string;
  missing: string[];
  components: StateAgeComponent[];
  sourceIds: string[];
  disclaimer: string;
}

export type InsightSeverity = "important" | "attention" | "notice" | "info";
export type InsightConfidence = "较高" | "中等" | "有限";

export interface EvidenceItem {
  label: string;
  value: string;
  comparison: string;
  state: "high" | "low" | "typical" | "context";
}

export interface PossibleExplanation {
  title: string;
  rationale: string;
  fit: "较吻合" | "可能" | "需补充信息";
}

export interface HealthInsight {
  id: string;
  severity: InsightSeverity;
  confidence: InsightConfidence;
  title: string;
  summary: string;
  dateRange: string;
  evidence: EvidenceItem[];
  explanations: PossibleExplanation[];
  actions: string[];
  sourceIds: string[];
  limitation: string;
}

export interface MetricCard {
  key: string;
  label: string;
  value: string;
  unit?: string;
  delta?: string;
  tone: "good" | "neutral" | "watch";
  coverage: string;
}

export interface ImportProgress {
  phase: "validating" | "hashing" | "parsing" | "storing" | "aggregating" | "done";
  percent: number;
  message: string;
  recordsProcessed?: number;
}
