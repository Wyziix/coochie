// CSV files for the export, made to open cleanly in Excel: UTF-8 with a BOM,
// CRLF line ends, ISO dates ("2026-11-02", times as "2026-11-02 18:30:00"
// in Europe/Madrid), dot decimals, and no formulas from user text.
// No Deno/npm imports, so it is tested directly.

export type Kind = 'text' | 'number' | 'date' | 'datetime';
export type Column = { key: string; header?: string; kind?: Kind };
type Row = Record<string, unknown>;

export const TIME_ZONE = 'Europe/Madrid';
const BOM = '﻿';

const local = new Intl.DateTimeFormat('sv-SE', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** "2026-11-02 18:30:00" (Madrid), which Excel reads as a date and time. */
export function localDateTime(value: string | number | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return local.format(d).replace('T', ' ');
}

/** Madrid calendar day, "2026-11-02". */
export function localDate(value: Date): string {
  return localDateTime(value).slice(0, 10);
}

function number(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '';
  // Never "1e-7" or a comma: plain digits with a dot.
  const s = String(n);
  return /e/i.test(s) ? n.toFixed(12).replace(/\.?0+$/, '') : s;
}

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Text that starts like a formula would run in Excel ("=", "+", "-", "@").
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function cell(value: unknown, kind: Kind): string {
  let s: string;
  switch (kind) {
    case 'number':
      s = number(value);
      break;
    case 'date':
      s = typeof value === 'string' ? value.slice(0, 10) : '';
      break;
    case 'datetime':
      s = value ? localDateTime(value as string) : '';
      break;
    default:
      s = text(value);
  }
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Row[], columns: Column[]): string {
  const lines = [columns.map((c) => cell(c.header ?? c.key, 'text')).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => cell(row[c.key], c.kind ?? 'text')).join(','));
  }
  return BOM + lines.join('\r\n') + '\r\n';
}

const n = (key: string, header?: string): Column => ({ key, header, kind: 'number' });
const t = (key: string, header?: string): Column => ({ key, header, kind: 'text' });
const d = (key: string, header?: string): Column => ({ key, header, kind: 'date' });
const dt = (key: string, header?: string): Column => ({ key, header, kind: 'datetime' });

/** One CSV per part of the export (the JSON file has everything). */
export const TABLES: {
  file: string;
  key: string;
  columns: Column[];
  flatten?: (rows: Row[]) => Row[];
}[] = [
  {
    file: 'workouts.csv',
    key: 'workouts',
    columns: [
      t('id'),
      t('name'),
      dt('started_at'),
      dt('ended_at'),
      n('duration_seconds'),
      n('total_volume_kg'),
      t('notes'),
    ],
  },
  {
    file: 'sets.csv',
    key: 'sets',
    columns: [
      t('workout_id'),
      dt('workout_started_at'),
      t('exercise'),
      n('exercise_order'),
      n('set_order'),
      t('set_type'),
      n('weight_kg'),
      n('reps'),
      n('rpe'),
      n('duration_seconds'),
      n('distance_m'),
    ],
  },
  {
    file: 'templates.csv',
    key: 'templates',
    columns: [
      t('template'),
      t('program'),
      t('notes'),
      t('exercise'),
      n('position'),
      n('target_sets'),
      n('target_reps_min'),
      n('target_reps_max'),
      n('target_duration_seconds'),
      n('rest_seconds'),
    ],
    flatten: (templates) =>
      templates.flatMap((tpl) => {
        const base = { template: tpl.name, program: tpl.program, notes: tpl.notes };
        const exercises = (tpl.exercises as Row[] | undefined) ?? [];
        return exercises.length ? exercises.map((e) => ({ ...base, ...e })) : [base];
      }),
  },
  {
    file: 'personal_records.csv',
    key: 'personal_records',
    columns: [
      t('exercise'),
      t('record_type'),
      n('value'),
      n('weight_kg'),
      n('reps'),
      dt('achieved_at'),
      n('previous_value'),
    ],
  },
  {
    file: 'body_stats.csv',
    key: 'body_stats',
    columns: [
      d('measured_on'),
      n('bodyweight_kg'),
      n('body_fat_pct'),
      n('neck_cm'),
      n('shoulders_cm'),
      n('chest_cm'),
      n('waist_cm'),
      n('hips_cm'),
      n('arm_cm'),
      n('thigh_cm'),
      n('calf_cm'),
      t('notes'),
    ],
  },
  {
    file: 'nutrition.csv',
    key: 'food_logs',
    columns: [
      d('day'),
      t('meal'),
      t('name'),
      n('grams'),
      n('servings'),
      n('kcal'),
      n('protein_g'),
      n('carbs_g'),
      n('fat_g'),
    ],
  },
  { file: 'water.csv', key: 'water', columns: [d('day'), n('ml'), dt('logged_at')] },
  {
    file: 'points.csv',
    key: 'points',
    columns: [dt('earned_at'), d('day'), n('points'), t('reason'), t('source'), t('workout_id')],
  },
  { file: 'badges.csv', key: 'badges', columns: [t('badge'), t('description'), dt('earned_at')] },
];
