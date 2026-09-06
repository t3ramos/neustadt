/** Public simulation API. Implementations live in the owning domain modules below. */
export { isWaterTerrain } from '../world/terrain';
export { TOOL_DEFS } from './catalog';
export { isBuildingAnchor, getFootprint } from './city-queries';
export { createCity, expandCity } from './generation';
export { recalculate, takeLoan, repayLoan } from './economy';
export { previewBuild, build } from './construction';
export { tick } from './growth';
export { triggerDisaster, applyCitizenIncident } from './disasters';
export { deserializeCity, serializeCity } from '../persistence/serialization';
