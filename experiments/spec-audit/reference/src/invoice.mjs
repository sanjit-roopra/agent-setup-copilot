import { priceLine } from './line.mjs';
import { invoiceTax } from './tax.mjs';

/** SPEC 10. */
export function buildInvoice(shipments) {
  if (!Array.isArray(shipments) || shipments.length === 0) throw new Error('an invoice needs at least one line');
  const lines = shipments.map(priceLine);
  const subtotalCents = lines.reduce((sum, line) => sum + line.totalCents, 0);
  const taxCents = invoiceTax(lines);
  return { lines, subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}
