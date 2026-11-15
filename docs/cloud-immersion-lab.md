# Isolated cloud immersion experiment

Route: `/lab/clouds`. This remains a separate manual test of the cloud effect.
This earlier procedural effect is retained for comparison. The main site now
uses the approved existing-cloud crossing from `/lab/approach`; see
`cloud-main-integration.md`.

The lab starts above a procedural cloud bank with the existing local Finland
satellite photo as a ground reference. `Enter clouds` moves the camera forward
and down over 5.5 seconds. It stops inside an opaque cloud core. `Exit clouds`
continues down through the bottom of the bank over 4.5 seconds and reveals the
ground. The same photo is reframed at full resolution while fully obscured,
avoiding a blurred close-up on exit. `Replay` restarts the complete experiment.
This remains an isolated lab with no switch to the interactive map.

Clouds are a 3D density field sampled along view rays, with Beer–Lambert
extinction, coarse self-shadowing, layered density, and gentle wind. This uses
a seeded 64³ noise texture and a lower-resolution cloud render target; the
ground is composited separately at full display resolution. The data is
illustrative and does not represent current weather.

The CPU visibility check samples the same density volume as the shader. Tests
require visible gaps before the flight, less than 0.1% final ground visibility
at sampled rays across three laptop aspect ratios, smooth camera endpoints,
and deterministic replay inputs. Visual quality is left to the user to assess.
Hidden tabs pause time. Reduced motion completes the camera move on request
without automatically starting an animation. All WebGL resources are disposed
when the lab is unmounted.
