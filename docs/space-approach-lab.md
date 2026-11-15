# Isolated space-to-clouds approach

Route: `/lab/approach`.

This isolates the current main-site approach for further iteration. The scene
starts with Earth already visible in the center. `Start approach` plays the
continuous flight toward a bright existing cloud texel over northern Finland.
On reaching the cloud surface it automatically continues through that same
cover over 3 seconds and reveals the final Finland satellite map behind it.
The approach lasts 5 seconds, for an 8-second sequence (50% faster than the
original 7.5-second approach and 4.5-second exit).
There is no manual stop or second button between entry and exit. Both the
Earth scene and the first painted map frame must be ready before starting,
so loading cannot interrupt the crossing. `Replay` restarts the full sequence.

This second attempt removes the independent procedural cloud overlay entirely.
The original spherical cloud mesh and its texture remain in place at constant
opacity from orbit. In this lab, the existing texture is distributed over 24
thin shells, normalized to preserve its original total opacity from above.
From orbit the cloud material follows sunlight with no emissive fill. Near
the clouds, a neutral-white fill blends up to the approved 0.28 to lift gray
shading while leaving opacity and texture transmission unchanged.
The shells are present from the start. Each near surface clears gently as the
camera crosses it, avoiding an abrupt single-plane disappearance. The camera
uses a smoothly eased altitude with no mid-flight time-scale switch. This is
an isolated cloud-cover crossing, not the procedural whiteout handoff.

The actual map renderer prepares a static final view beneath the scene before
exit starts. During exit, the Earth surface fades below the existing cloud
layers; the clouds themselves continue clearing with the unchanged camera
trajectory. The final picture has no analysis controls or interactive picking.
There is no opening reveal or country picker in this lab.
The approved crossing is now also used after choosing Finland on the main site;
see `cloud-main-integration.md`. The main site retains its opening and country
picker, and exposes the interactive map after exit. `/lab/clouds` remains a
separate procedural-cloud experiment. The renderer, trajectory, shell depth,
white fill and timing are shared between the main site and this lab.
Visual checking remains with the user, as requested.
