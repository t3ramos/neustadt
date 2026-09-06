/** Primitive saved-state guards shared with resident incident validation. */
import { tr } from '../i18n/index';

export function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(tr(`Ungültiger Spielstand: ${label}.`, `Invalid saved game: ${label}.`));
  return value as Record<string, unknown>;
}

export function requireNumber(
  value: unknown,
  label: string,
  min: number,
  max: number,
  integer = false,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    throw new Error(tr(`Ungültiger Spielstand: ${label}.`, `Invalid saved game: ${label}.`));
  return value;
}

export function requireString(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new Error(tr(`Ungültiger Spielstand: ${label}.`, `Invalid saved game: ${label}.`));
  return value;
}

export function requireBoolean(value: unknown, label: string): void {
  if (typeof value !== 'boolean')
    throw new Error(tr(`Ungültiger Spielstand: ${label}.`, `Invalid saved game: ${label}.`));
}
