/** Date.parse keeps milliseconds; preserve the extra digits allowed by ISO timestamps. */
export function compareIsoTimestamps(left: string, right: string): number {
  const leftMillis = Date.parse(left);
  const rightMillis = Date.parse(right);
  if (leftMillis !== rightMillis) return leftMillis < rightMillis ? -1 : 1;
  const leftFraction = fractionalDigits(left);
  const rightFraction = fractionalDigits(right);
  const length = Math.max(leftFraction.length, rightFraction.length);
  const normalizedLeft = leftFraction.padEnd(length, "0");
  const normalizedRight = rightFraction.padEnd(length, "0");
  return normalizedLeft === normalizedRight ? 0 : normalizedLeft < normalizedRight ? -1 : 1;
}

/** Signed elapsed milliseconds, including the fractional source precision. */
export function millisecondsBetweenIsoTimestamps(later: string, earlier: string): number {
  const wholeMilliseconds = Date.parse(later) - Date.parse(earlier);
  const submillisecond = (value: string): number =>
    Number(`0.${fractionalDigits(value).slice(3) || "0"}`);
  return wholeMilliseconds + submillisecond(later) - submillisecond(earlier);
}

function fractionalDigits(value: string): string {
  return /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1] ?? "";
}

export function isoTimestampFromEpochMicroseconds(value: number): string | undefined {
  if (!Number.isSafeInteger(value)) return undefined;
  const milliseconds = Math.floor(value / 1000);
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.valueOf())) return undefined;
  const iso = date.toISOString();
  const remainingMicroseconds = value - milliseconds * 1000;
  const extra = String(remainingMicroseconds).padStart(3, "0").replace(/0+$/, "");
  return `${iso.slice(0, -1)}${extra}Z`;
}
