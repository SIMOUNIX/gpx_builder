# Online basemap from OpenFreeMap

The basemap uses OpenFreeMap's hosted vector tiles (the _liberty_ style, in light and dark mode) instead of the Protomaps PMTiles regional extracts planned at first. GPX builder is a desktop app and its planner needs an internet connection to reach the LLM anyway, so offline maps would add per-region extracts to build and host for no real gain. Hillshade and 3D terrain come from the free AWS Terrain Tiles (Terrarium) dataset. Offline maps are left for later, possibly never.
