// Trip configuration and the date/money helpers shared by every page.
import type { Expense, Currency } from '@/lib/supabase';

export const TARGET_BUDGET = 40000;
export const CAP_BUDGET = 50000;

export const TRIP_START = '2026-09-09';
export const TRIP_END = '2026-09-29';

export const TRAVELERS = 2;

export const BASELINE = [
  { label: 'טיסות (הלוך ושוב, שני נוסעים)', amount: 13563 },
  { label: 'מלון בנגקוק - Chatrium Grand (26-29.9, 3 לילות)', amount: 1814.77 },
  { label: 'מלון קו פנגן - Varivana Resort (10-13.9, 3 לילות)', amount: 1739.01 },
  { label: 'ביטוח נסיעות ובריאות (PassportCard)', amount: 1067.5 },
];
export const BASELINE_TOTAL = BASELINE.reduce((s, b) => s + b.amount, 0);

export const CATEGORIES = ['תחבורה', 'אוכל', 'מלון', 'פעילות', 'קניות', 'אחר'];

const CATEGORY_META: Record<string, { emoji: string; color: string }> = {
  'תחבורה': { emoji: '🛵', color: '#00b4d8' },
  'אוכל': { emoji: '🍜', color: '#ff6b35' },
  'מלון': { emoji: '🏨', color: '#6c5ce7' },
  'פעילות': { emoji: '🛺', color: '#06a77d' },
  'קניות': { emoji: '🛍️', color: '#e0a900' },
  'אחר': { emoji: '✨', color: '#ef476f' },
};
const FALLBACK_META = { emoji: '❔', color: '#9a9a9a' };
export function metaFor(cat: string) {
  return CATEGORY_META[cat] ?? FALLBACK_META;
}

export const CURRENCIES: { code: Currency; label: string; sym: string }[] = [
  { code: 'THB', label: '฿ באט', sym: '฿' },
  { code: 'USD', label: '$ דולר', sym: '$' },
  { code: 'ILS', label: '₪ שקל', sym: '₪' },
];
export const SYM: Record<Currency, string> = { ILS: '₪', THB: '฿', USD: '$' };

export function fmt(n: number) {
  return new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 }).format(Math.round(n));
}
export function fmtPrecise(n: number) {
  return new Intl.NumberFormat('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
export function fmtSigned(n: number) {
  return n >= 0 ? `${fmt(n)} ₪` : `-${fmt(Math.abs(n))} ₪`;
}
// Whole days between two 'YYYY-MM-DD' dates, inclusive of both ends.
export function daysBetweenInclusive(a: string, b: string) {
  const d1 = new Date(`${a}T00:00:00`);
  const d2 = new Date(`${b}T00:00:00`);
  return Math.round((d2.getTime() - d1.getTime()) / 86400000) + 1;
}
export function dayLabel(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', weekday: 'short' });
}
export function shortDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
}
// Format a Date back to 'YYYY-MM-DD' using its LOCAL calendar date (never toISOString, which
// converts to UTC and shifts the date near midnight in any timezone ahead of UTC).
export function toDateStr(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
export function todayLocal() {
  return toDateStr(new Date());
}
// Last day an expense applies to (falls back to its start date for a normal, single-day expense).
export function expenseEndDate(e: Pick<Expense, 'date' | 'end_date'>) {
  return e.end_date && e.end_date > e.date ? e.end_date : e.date;
}
export function dateRangeLabel(e: Pick<Expense, 'date' | 'end_date'>) {
  const end = expenseEndDate(e);
  return end !== e.date ? `${shortDate(e.date)}–${shortDate(end)}` : shortDate(e.date);
}
// Every calendar day from start to end, inclusive (capped so a typo can't loop forever).
export function daysInRange(start: string, end: string): string[] {
  const days: string[] = [];
  let cur = new Date(`${start}T00:00:00`);
  const endD = new Date(`${end}T00:00:00`);
  if (endD < cur) return [start];
  let guard = 0;
  while (cur <= endD && guard < 180) {
    days.push(toDateStr(cur));
    cur = new Date(cur.getTime() + 86400000);
    guard++;
  }
  return days;
}

export type DayBucket = {
  date: string;
  total: number;
  entries: { expense: Expense; share: number; spanDays: number }[];
};

// Spread every expense evenly across the days it covers (a normal expense covers just its own
// day; a multi-day one like a car rental or hotel covers date..end_date), grouped by day,
// chronological (trip order), each day's items kept in the order they were entered.
export function spreadByDay(expenses: Expense[]): DayBucket[] {
  const map = new Map<string, DayBucket>();
  for (const e of expenses) {
    const days = daysInRange(e.date, expenseEndDate(e));
    const share = Number(e.amount) / days.length;
    days.forEach((d) => {
      let bucket = map.get(d);
      if (!bucket) {
        bucket = { date: d, total: 0, entries: [] };
        map.set(d, bucket);
      }
      bucket.total += share;
      bucket.entries.push({ expense: e, share, spanDays: days.length });
    });
  }
  Array.from(map.values()).forEach((bucket) => {
    bucket.entries.sort((a, b) => (a.expense.created_at < b.expense.created_at ? -1 : a.expense.created_at > b.expense.created_at ? 1 : 0));
  });
  return Array.from(map.values()).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
