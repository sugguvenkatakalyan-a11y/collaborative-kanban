/**
 * Fractional ordering helpers.
 *
 * Each task has a numeric `position`. To insert between two neighbours we use the
 * midpoint of their positions, so a move updates only the moved task. When the
 * gap gets too small (after many inserts at the same spot) the column is
 * rebalanced back to evenly spaced integers.
 */
const STEP = 1024;
const MIN_GAP = 1e-6;

/** Returns the new position, or null if the column needs rebalancing first. */
function positionBetween(before, after) {
  if (before == null && after == null) return STEP;
  if (before == null) return after - STEP;
  if (after == null) return before + STEP;
  if (after - before < MIN_GAP) return null;
  return (before + after) / 2;
}

module.exports = { STEP, positionBetween };
