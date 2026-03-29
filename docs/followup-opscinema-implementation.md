# Executive summary

This pass materially cleared `OPscinema` but did not fully close the entire packaged smoke checklist. The original blocker is no longer the app-level Screen Recording grant. The packaged app can now launch without the immediate false-permission stop, complete a real `Start Handoff Session`, pass capture and OCR, generate tutorial output, and verify an export into `/tmp/opscinema-ui-export`.

`OPscinema` still has one remaining blocker story for this bucket: post-export packaged smoke stability is not fully proven yet. A stray Screen Recording prompt can still reappear after the successful flow, `Apply Step Edit (Retry)` was not independently proven end to end in this pass, and a relaunch returns to the default permissions view instead of clearly proving persistence from the completed export session.

# Work completed in this pass

- Re-read the required source artifacts in order:
  - `docs/fix-plan-master.md`
  - `docs/fix-plan-master-summary.json`
  - `docs/followup-env-local.md`
  - `docs/followup-env-local-summary.json`
  - `docs/fix-plan-batch-10.md`
  - `docs/fix-plan-batch-10-summary.json`
- Confirmed from user evidence that `OpsCinema Suite.app` was already enabled in macOS Privacy & Security, so the blocker had to be app-side.
- Traced the packaged permission and capture path to the local smoke install/signing flow plus the runtime capture helper path.
- Changed the local smoke install script so the installed app is re-signed with a stable designated requirement of `identifier "com.opscinema.desktop"` instead of a drifting `cdhash` identity.
- Changed the permissions-status check so the permissions screen is a pure `CGPreflightScreenCaptureAccess()` read and no longer triggers a real capture probe on launch.
- Replaced the failing helper/CLI capture path for runtime keyframes with an in-process macOS capture path that encodes PNG data inside the app process.
- Adjusted OCR provider parsing so provider boxes that slightly overrun the normalized image edge are clamped instead of failing the full flow.
- Rebuilt, reinstalled, reopened, activated, and smoke-ran the packaged app after each fix.

# Verification

- `make smoke-app-install` completed with `/Users/d/Applications/OpsCinema Suite.app` installed as bundle id `com.opscinema.desktop`.
- `make smoke-app-verify` passed after the install-path signing fix.
- `codesign -dr - "/Users/d/Applications/OpsCinema Suite.app"` now reports `designated => identifier "com.opscinema.desktop"`.
- `cargo check -p opscinema_desktop_backend --features runtime` passed after the capture-path change.
- `cargo test -p opscinema_desktop_backend phase0_capture_permission_denied_has_action_hint -- --nocapture` passed.
- `cargo test -p opscinema_desktop_backend phase0_runtime_smoke_build_info_and_session_roundtrip -- --nocapture` passed.
- `cargo test -p opscinema_desktop_backend clamps_provider_bbox_to_normalized_bounds -- --nocapture` passed.
- `cargo test -p opscinema_desktop_backend rejects_invalid_provider_schema -- --nocapture` passed.
- Launch-time behavior improved: the packaged app now opens without the immediate false-permission stop that blocked the pass before this fix.
- A real packaged `Start Handoff Session` now succeeds through capture, OCR, tutorial generation, and export creation.
- The latest successful packaged export was recorded in the app DB and on disk at `/tmp/opscinema-ui-export` with:
  - `manifest.json`
  - `tutorial.json`
  - `player/index.html`

# Remaining open items

- Confirm and fix why a late Screen Recording prompt can still reappear after the successful packaged export flow.
- Prove `Apply Step Edit (Retry)` end to end on a successful packaged session.
- Prove relaunch persistence for the completed packaged session/export state instead of only seeing the default permissions route on reopen.

# Blockers

- `OPscinema` is no longer blocked at initial packaged launch or at initial capture. The remaining blocker is narrower: post-export packaged smoke behavior is not fully stable/persistent yet, so the full checklist cannot be truthfully marked complete until the late prompt, step-edit retry, and relaunch persistence are closed or disproven with a concrete product-level reason.

# Done definition

- `OPscinema` is fully cleared when the packaged app completes and proves all four smoke items in one consistent state:
  - `Start Handoff Session`
  - `Apply Step Edit (Retry)`
  - export creation
  - relaunch persistence
- `docs/followup-opscinema-implementation.md` and `docs/followup-opscinema-implementation-summary.json` describe the same verified result from this implementation pass.
