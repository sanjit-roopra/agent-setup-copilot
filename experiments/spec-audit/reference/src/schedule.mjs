const DAY_MS = 86400000;
export const CUTOFF_MINUTES = 16 * 60;

const isWeekend = dayMs => [0, 6].includes(new Date(dayMs).getUTCDay());

/** SPEC 9. Everything is evaluated on the warehouse's local clock. */
export function dispatchDate(orderedAtIso, warehouse) {
  const instant = Date.parse(orderedAtIso);
  if (Number.isNaN(instant)) throw new RangeError(`not a timestamp: ${orderedAtIso}`);
  // Shifting the instant lets the UTC getters read the warehouse's wall clock.
  const local = new Date(instant + warehouse.utcOffsetMinutes * 60000);
  let day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  if (minutes >= CUTOFF_MINUTES) day += DAY_MS;
  while (isWeekend(day)) day += DAY_MS;
  return new Date(day).toISOString().slice(0, 10);
}
