# Approved Earth opening on the Finland branch

Local implementation on `main-dontDelete`; no remote branch updates.

Current cloud-to-map handoff: see `cloud-main-integration.md`. The approved cloud lab effect now replaces the direct photographic crossfade described in earlier notes below.

Current direction: static isolated lights first, a slight turn during the
original city-network reveal, then a stronger night-to-day view turn. The sun
stays fixed in world space throughout. A shared camera/world orbit provides the
actual night-side view without animating the light; local Earth/cloud rotation
adds the small visible surface turn. The exact final pose still feeds Finland's
approach. Earlier motion revisions below are historical.

The user requested replacing the existing video opening with the approved
city-lights Earth intro from `inestigate-data`, then explicitly clarified that
the animated approach to Finland must remain. The active path therefore is:

1. Assets load against a pure black frame, with no country-selection UI.
2. Lights/sunrise sequence based on the approved checkpoint, approximately 7.67 seconds.
   The latest user-requested revision accelerates city reveal, starts Earth
   rotation early. The sun is fixed, so the surface moves under a stationary
   lighting field. Clouds follow the same rotation without an independent drift.
   NASA textures, framing, world tilt, star seed and exact final pose remain.
3. After the centered reveal completes, a solid ivory panel (#f2ecde) slides
   in from the left over 1.1 seconds, carrying black “Choose a country” text
   and the search field. Its thin vertical border shares the exact animation
   clock and boundary of the shrinking WebGL space viewport. The attached
   Finland suggestion appears only while searching. Choosing Finland
   starts the four-second 3D orbital alignment and descent after the placement
   finishes. The panel slides out and the viewport expands back to full width
   during the first part of flight, preserving the final map projection.
   The landing uses the DataX wordmark at the top, a smaller heading and short
   climate/energy/water description above a wider search field. No bottom
   source block is shown.
4. Final pose matches the existing satellite-photo camera, up vector, lens and
   oblate-Earth scale. Crossfade to the map; its framing animation waits 380ms
   so it does not move away from the matching pose during the fade.
5. The existing map, selection, reports and comparisons remain available.

The full opening plays at 1.5 times its original speed: all reveal/flight
curves and endpoints are unchanged. The crossfade, opening controls, cleanup
delay and automatic map framing are shortened by the same factor. Historical
timings in earlier revision notes below describe their original versions.

The entry page no longer renders the MP4. Old video assets are retained as
inactive files. `EarthOpening` dynamically loads the Three.js scene and frees
its resources after handoff. Skip/replay, reduced-motion bypass, hidden-tab
pause and WebGL/texture fallback are supported. No provider or scoring changes.
Reduced motion completes the reveal immediately but still waits for a country
choice. Replay returns to country selection; only Finland is currently offered.

`npm test`: nine intro/controls regressions plus three flight tests.
The latter verify alignment before descent, continuous bounded movement,
idempotent/reduced-motion completion, and the final projected positions of five
Finnish locations against the actual map projection (less than 1e-8 pixel
numerical difference at the reference image aspect ratio).

`npm run build` checks the complete production app. Browser checks should include
full lights-to-Finland playback, skip/replay, one opening canvas with disposal at
handoff, and selecting a bundled site afterward. The scene uses local NASA
imagery and does not represent current weather. Attribution remains accessible
in the DOM, `/earth/sources.json` and the map/image credits page.


Verified locally: all ten Node regressions and the production build pass.
The browser displayed the approved dark/city-lights/dawn phases and an actual
3D approach frame (`data-flight-progress` 0.8472), then opened Finland's map.
Replay and Skip intro were exercised. After handoff there are no video elements
or remaining Earth WebGL canvases; the map is visible and interactive. Selecting
Helsinki loaded the existing regional report (59.3/100), without calculation
changes. The three original NASA images also match their source-manifest SHA-256
checksums. Browser proofs are saved locally at `/tmp/approved-earth-opening.jpg`,
`/tmp/finland-3d-flight.jpg` and `/tmp/finland-new-opening-map.jpg`.


## Initial dynamic reveal revision (superseded lighting)

The user requested slow initial lights with an accelerating build, and a moving
Earth/shadow throughout the reveal. `getEarthIntroFrame` provides a separate
accelerating clock for the light shader (`uIntroLights`), keeping the first seed
at normalized time .055. Rotation starts at .015 and sun movement at .035,
with smooth speed ramps and no early held pose. Surface/cloud/atmosphere reveal
still follows the approved stages. The cloud layer has a restrained independent
drift. Earth, clouds and sun return exactly to their original final pose, so
Finland's six-second approach and projection alignment are unchanged.

The original early-static-pose assertion was intentionally updated for this new
requirement. The tests now also verify accelerating reveal over equal time
windows, monotonic continuous Earth/sun motion, and the settled cloud endpoint.
The existing continuity, reduced-motion and Finland projection checks remain.
Browser observed the quiet first-light phase and the moving day/night boundary
at progress .6956; proof: `/tmp/earth-dynamic-dawn.jpg`.


## Fixed-light clarification

The user explicitly requested that only Earth move, rather than Earth plus an
independently moving shadow. Removed the sun interpolation from both intro and
Finland flight and removed independent cloud drift. The sun retains its original
final world-space direction and position throughout. Early city lights are
revealed before terrain, including where the day surface will later appear;
they fade into the fixed daylight as the surface is revealed. There is no animated
shadow mask. Accelerating light timing, 11.5-second intro duration, exact Earth/
cloud handoff pose and six-second camera approach remain.

Regression checks now assert invariant sun direction/position for every intro
frame, clouds attached to Earth's rotation, and no sun motion during approach.
All eleven tests pass, including the unchanged final map-projection check.
Browser proof of the revised intro: `/tmp/earth-fixed-sun.jpg`.


## Surprise-first staging (current)

The user rejected the early full day-side reveal and requested the original
surprise: a few stationary lights, then subtle movement as the network appears,
then a dynamic turn revealing the lit side. Restored the approved shader city
clock exactly: seeds at .055/.130/.195, followed by the original staggered
network. No turn before .22; the gentle phase reaches only 4% of the total turn
by .50. A smoother acceleration/deceleration curve supplies the remaining 96%
from .50 to 1. Surface/atmosphere/cloud reveal is delayed accordingly.

For an actually dark initial view with a fixed sun, a single shared orbit turns
the camera and world from the night-side vantage to the approved final vantage;
Earth/clouds also make their original local turn. This is a viewpoint change,
not a moving light or animated shadow mask. The star frame follows the orbit so
there is no separate rushing starfield. All world/camera/Earth/cloud poses are
restored exactly before the existing Finland approach.

Tests assert an initially stationary camera/surface, a dark starting view under
the fixed sun, gentle early motion vs faster main turn, and exact final camera,
world, clouds and Earth poses. Twelve tests and production build pass. Browser
observed isolated lights at progress .2669 and the revealed crescent/network at
.7238; proof: `/tmp/earth-surprise-reveal.jpg`.
