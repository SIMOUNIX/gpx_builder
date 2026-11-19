# Online basemap from OpenFreeMap

The basemap uses OpenFreeMap's hosted vector tiles (styled by us, in light and dark mode; first the hosted _liberty_ style, see the update below) instead of the Protomaps PMTiles regional extracts planned at first. GPX builder is a desktop app and its planner needs an internet connection to reach the LLM anyway, so offline maps would add per-region extracts to build and host for no real gain. Hillshade and 3D terrain come from the free AWS Terrain Tiles (Terrarium) dataset. Offline maps are left for later, possibly never.

**Update (2026-11-15):** the style is now our own (`outdoor-style.ts`, an AllTrails-like outdoor look) over the same OpenFreeMap tiles. The tiles and the online-only decision are unchanged. The look is superseded by [ADR 0005](0005-paper-and-ink-design.md).
