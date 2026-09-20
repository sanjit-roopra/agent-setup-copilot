// Order is historical and carries no meaning.
export const ZONE_TABLE = [
  { prefix: '10', zone: { name: 'metro', baseCents: 450, perStepCents: 35, taxBp: 1900, remote: false } },
  { prefix: '9', zone: { name: 'south', baseCents: 650, perStepCents: 55, taxBp: 1900, remote: false } },
  { prefix: 'EC', zone: { name: 'city', baseCents: 500, perStepCents: 40, taxBp: 2000, remote: false } },
  { prefix: '90', zone: { name: 'coast', baseCents: 600, perStepCents: 50, taxBp: 1900, remote: false } },
  { prefix: '902', zone: { name: 'islands', baseCents: 900, perStepCents: 80, taxBp: 700, remote: true } },
  { prefix: 'E', zone: { name: 'east', baseCents: 550, perStepCents: 45, taxBp: 2000, remote: false } },
];

export function normalizePostalCode(code) {
  return String(code).replace(/\s+/g, '').toUpperCase();
}

/** SPEC 3: the longest matching prefix decides. */
export function zoneFor(postalCode, table = ZONE_TABLE) {
  const code = normalizePostalCode(postalCode);
  let best = null;
  for (const entry of table) {
    if (code.startsWith(entry.prefix) && (!best || entry.prefix.length > best.prefix.length)) best = entry;
  }
  if (!best) throw new Error(`no zone for postal code ${code}`);
  return best.zone;
}
