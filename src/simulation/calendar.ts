/** The simulation's historical `month` field remains a stable save/progression tick index. */
export const ECONOMY_STEP_SECONDS = 5;
export const ECONOMY_STEPS_PER_MINUTE = 60 / ECONOMY_STEP_SECONDS;
export const perMinute = (perStep: number): number => perStep * ECONOMY_STEPS_PER_MINUTE;
/** One calendar month advances over a real minute at 1x; economy ticks stay unchanged. */
export const CALENDAR_MONTH_SECONDS = 60;
export const CALENDAR_START_YEAR = 2000;
export const perMonth = (perStep: number): number =>
  perStep * (CALENDAR_MONTH_SECONDS / ECONOMY_STEP_SECONDS);
export function calendarState(step: number, progress = 0) {
  const seconds = Math.max(
    0,
    (Number.isFinite(step) ? step : 0) * ECONOMY_STEP_SECONDS +
      (Number.isFinite(progress) ? progress : 0),
  );
  const elapsedMonths = Math.floor(seconds / CALENDAR_MONTH_SECONDS);
  const month = elapsedMonths % 12,
    year = CALENDAR_START_YEAR + Math.floor(elapsedMonths / 12);
  const fraction = (seconds % CALENDAR_MONTH_SECONDS) / CALENDAR_MONTH_SECONDS;
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return {
    month,
    year,
    day: Math.min(days, 1 + Math.floor(fraction * days)),
    fraction,
    elapsedMonths,
  };
}
const MONTH_NAMES = {
  de: [
    'Januar',
    'Februar',
    'März',
    'April',
    'Mai',
    'Juni',
    'Juli',
    'August',
    'September',
    'Oktober',
    'November',
    'Dezember',
  ],
  en: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
};
export function calendarDate(
  step: number,
  progress = 0,
  locale: 'de' | 'en' = 'de',
  short = false,
): string {
  const { month, year } = calendarState(step, progress);
  return `${short ? MONTH_NAMES[locale][month].slice(0, 3) : MONTH_NAMES[locale][month]} ${year}`;
}
export function playTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60),
    remainder = String(total % 60).padStart(2, '0');
  return minutes < 60
    ? `${minutes}:${remainder}`
    : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${remainder}`;
}
export const stepTime = (step: number): string => playTime(step * ECONOMY_STEP_SECONDS);
