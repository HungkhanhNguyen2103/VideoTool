/** Format like Vietnamese narration: "." groups thousands, "," marks decimals. */
export function formatVietnameseNumber(value: number, decimals: number, grouping: boolean): string {
  const fixed = Math.abs(value).toFixed(decimals);
  const [integer = '0', fraction] = fixed.split('.');
  const grouped = grouping ? integer.replace(/\B(?=(\d{3})+(?!\d))/gu, '.') : integer;
  return `${value < 0 ? '-' : ''}${grouped}${fraction ? `,${fraction}` : ''}`;
}

/**
 * Vertical offset, in rows, of one odometer digit column.
 * Column 0 (units) rolls continuously; higher columns only roll while every
 * lower digit is 9, so digits carry over like a mechanical counter.
 */
export function odometerColumnOffset(value: number, column: number): number {
  const place = 10 ** column;
  const digit = Math.floor(value / place) % 10;
  if (column === 0) return digit + (value - Math.floor(value));
  const lower = value % place;
  const carry = lower > place - 1 ? lower - (place - 1) : 0;
  return digit + carry;
}
