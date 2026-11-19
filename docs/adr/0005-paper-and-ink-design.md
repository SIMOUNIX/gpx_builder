# Paper-and-ink design direction

Every screen had its own look, borrowed from a reference the author no longer wants. The app now has one direction, "paper and ink": light greys and ink text, a single crimson signal colour (selected day, key states), italic serif titles, a calm grotesque for text and mono for figures. Dark mode keeps the same hierarchy (near-black, lighter crimson). One look on every screen makes the app feel like one product, and one accent keeps its meaning clear.

- **Shell:** a flat three-column layout: trip tree on the left, the screen in the middle, trip information on the right (trip view only).
- **Home:** the map, full bleed, with floating controls; the tree is closed there and opens as an overlay.
- **Map style:** a new paper-and-ink style built from the same palette, in light and dark. It looks good with Hillshade, Contours and 3D off, and those are off by default (simplest view: 2D, not saved).
- **Slope colouring** stays (same five bands), restyled to a crimson-to-blue ramp.
- **Theme:** Light, System or Dark, default System, saved on the device.

**Supersedes** the style statement in the 2026-11-15 update of [ADR 0001](0001-online-basemap.md) (our own style, "an AllTrails-like outdoor look"). **Stays** from ADR 0001: the OpenFreeMap vector tiles, the AWS Terrain tiles for hillshade and 3D, and the online-only decision.
