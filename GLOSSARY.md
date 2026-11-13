# GPX builder

Plans multi-day hiking trips and turns them into GPX routes built from OpenStreetMap data.

## Along the route

**POI**:
A point of interest from OpenStreetMap near a stage's route: water, food, picnic or resupply.
_Avoid_: place (a place is a start, end or overnight location found by name)

**Stop**:
A POI the route passes through, to take a break or fetch something: either on the path or reached by a short detour that loops back to the route. A POI that is only displayed is not a stop.
_Avoid_: break, halt

**Detour**:
The extra walking distance, there and back on real paths, needed to reach a POI from the route.
_Avoid_: gap (reserved for the distance between water sources), offset

**Detour allowance**:
The largest detour that still counts as near the route: 1% of the trip's length, at least 200 m and at most 2 km.

## Water

**Potable water**:
A water source safe to drink as is, such as a tap or a fountain.

**Treatable water**:
Natural water (stream, river, waterfall, lake, pond, spring not marked drinkable) that is usable after filtering or treating it.

**Unknown water**:
A tap or source whose drinkability is not recorded.
_Avoid_: non-potable (it may well be drinkable)
