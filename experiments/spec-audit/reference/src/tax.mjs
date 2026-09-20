import { basisPoints } from './money.mjs';

/** SPEC 8: rounded per line, then summed. */
export function invoiceTax(lines) {
  return lines.reduce((sum, line) => sum + basisPoints(line.totalCents, line.zone.taxBp), 0);
}
