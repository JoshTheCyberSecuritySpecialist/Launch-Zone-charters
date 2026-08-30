/**
 * Rank already-available charter slots by closeness to a requested departure.
 * Used after a checkout slot conflict so the customer can continue without restarting.
 */

function rankClosestCharterSlots(slots, requestedStartIso, limit = 3) {
  const requestedMs = Date.parse(String(requestedStartIso || ''));
  const max = Math.max(1, Math.min(6, Number(limit) || 3));
  if (!Number.isFinite(requestedMs)) return [];

  return (slots || [])
    .filter((slot) => slot && slot.available !== false && slot.start && slot.start !== requestedStartIso)
    .map((slot) => {
      const startMs = Date.parse(String(slot.start));
      return {
        start: slot.start,
        end: slot.end || slot.endIso || null,
        label: slot.label || null,
        startHHMM: slot.startHHMM || null,
        launchId: slot.launchId || null,
        deltaMs: Number.isFinite(startMs) ? Math.abs(startMs - requestedMs) : Number.POSITIVE_INFINITY,
        startMs: Number.isFinite(startMs) ? startMs : Number.POSITIVE_INFINITY,
      };
    })
    .filter((slot) => Number.isFinite(slot.deltaMs))
    .sort((a, b) => a.deltaMs - b.deltaMs || a.startMs - b.startMs)
    .slice(0, max)
    .map(({ deltaMs: _deltaMs, startMs: _startMs, ...slot }) => slot);
}

module.exports = {
  rankClosestCharterSlots,
};
