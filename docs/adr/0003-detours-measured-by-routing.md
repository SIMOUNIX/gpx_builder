# Detours are measured by routing, with a lossless prefilter

A POI's detour is the real change in stage km and walking time, measured by routing previous waypoint → POI → next waypoint, not estimated from straight lines. The only shortcut is lossless: a POI whose straight-line distance exceeds half the detour allowance cannot fit it, so it is skipped without routing. Every other candidate is routed, queued under the router's rate limit. Correctness comes before speed; a slow list is acceptable, a wrong one is not.
