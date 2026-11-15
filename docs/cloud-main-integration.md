# Main-site cloud transition

The main site uses the approved `/lab/approach` crossing after choosing Finland.
The city-lights opening, fixed sunlight, centered reveal, ivory country picker,
DataX branding, map data and analysis are preserved.

The camera flies toward the existing cloud cover above northern Finland over
5 seconds, then automatically crosses it and reveals the final map over
3 seconds. Both stages use the same trajectory and renderer as the lab.
The country panel retracts and the space viewport expands during the approach.

The original cloud texture exists from orbit as 24 thin concentric shells.
Their alpha is normalized to preserve the original combined opacity (0.82 at
maximum texture density); a neutral-white emissive fill of 0.28 lifts gray
shading. Each shell clears gently as the camera crosses it. There is no separate
procedural overlay and no fading out of the original clouds during approach.

The interactive map loads and paints behind the scene during the opening.
Its initial photo framing covers the entire viewport, including on resize,
and remains fixed while clouds clear. Only after exit finishes does the map
ease back to its usual fitted framing over approximately 0.75 seconds; the
black feathered edges therefore enter after the cloud crossing, not during it.
Each feather grows from zero width as its image edge enters the viewport,
avoiding the previous full-width shadow switch. Header/footer shading fades
in over the same 0.75-second settling interval instead of appearing instantly.
At the cloud boundary, its first-paint promise must resolve before exit starts.
During exit, the Earth surface fades beneath the existing clouds and the WebGL
background becomes transparent. The clouds clear over the actual map canvas.
The header, map controls and selection UI appear only after exit; then Earth
resources are disposed. A slow map load holds the covered view until ready.

Skip bypasses the remaining flight or exit and opens the prepared map. Replay
invalidates pending loading, destroys the map view and starts a fresh opening.
Reduced motion settles the two flight stages without an animated crossing.
Texture/WebGL errors fall back to map loading; map failures offer Retry.

`/lab/approach` remains available for isolated tuning. `/lab/clouds` and the
older procedural implementation remain separate comparison experiments.
Technical checks cover camera continuity, opening-to-cloud compatibility,
normalized cloud opacity, reduced motion, disposal and the eight-second timing.
Visual assessment remains with the user by explicit request.
