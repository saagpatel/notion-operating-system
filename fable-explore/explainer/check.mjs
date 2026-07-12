// Headless verification for every storyboard act. The reducer is driven with
// caller-supplied ticks so these checks never depend on a wall clock or RNG.
import {
  createFocusedState,
  createInitialState,
  setDropOneAck,
  setAct4Obstacle,
  setReadFailure,
  handEditField,
  setBurstSize,
  setAct6Toggle,
  beginSync,
  runTicks,
  isIdle,
  duplicateRemoteIds,
} from "./dist/explainer.js";

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  }
}

function settle(state) {
  const settled = runTicks(state, state.lastTick + 1, state.lastTick + 200);
  if (!isIdle(settled)) throw new Error("simulation did not settle within 200 ticks");
  return settled;
}

function droppedAckThenRetry(act) {
  let state = createFocusedState(act);
  state = setDropOneAck(state, true);
  state = beginSync(state);
  state = settle(state);
  state = beginSync(state);
  return settle(state);
}

// --- Act 1: naive sync has no key check, so the retry appends a second page. ---
{
  const state = droppedAckThenRetry(1);
  const duplicates = duplicateRemoteIds(state);
  assert(state.remote.length === 2, `Act 1 expected 2 remote rows, got ${state.remote.length}`);
  assert(duplicates.size === 2, `Act 1 expected both rows flagged as duplicates, got ${duplicates.size}`);
  if (state.remote.length === 2 && duplicates.size === 2) console.log("PASS: Act 1 duplicate after dropped ack + retry");
}

// --- Act 2: ownership partitions writes; the manual field stays untouched. ---
{
  let state = createInitialState(2);
  state = settle(beginSync(state));
  const owned = state.fields.filter((field) => field.owner !== "manual");
  const notes = state.fields.find((field) => field.name === "Notes");
  assert(owned.every((field) => field.local === field.remote), "Act 2 expected owned fields to converge");
  assert(notes?.remote === "Operator note", "Act 2 expected the manual Notes field to remain untouched");
  if (owned.every((field) => field.local === field.remote) && notes?.remote === "Operator note") console.log("PASS: Act 2 ownership partitions fields without touching Notes");
}

// --- Act 3: query-by-key means the retry recovers instead of re-creating. ---
{
  const state = droppedAckThenRetry(3);
  const duplicates = duplicateRemoteIds(state);
  const row = state.outbox[0];
  assert(state.remote.length === 1, `Act 3 expected 1 remote row, got ${state.remote.length}`);
  assert(duplicates.size === 0, `Act 3 expected no duplicates, got ${duplicates.size}`);
  assert(Boolean(row.receipt), "Act 3 expected the outbox row to have a receipt written back");
  assert(row.status === "recovered", `Act 3 expected row status \"recovered\", got ${row.status}`);
  if (state.remote.length === 1 && duplicates.size === 0 && row.receipt && row.status === "recovered") console.log("PASS: Act 3 convergence + receipt after dropped ack + retry");
}

// --- Act 4: the firewall path descends to the anchored insert rung. ---
{
  let markers = settle(beginSync(setAct4Obstacle(createInitialState(4), "markersCorrupted", true)));
  assert(markers.ladder.resolved === 3, `Act 4 markers expected rung 3 to resolve, got ${markers.ladder.resolved}`);
  assert(markers.sections.every((section) => !section.markersIntact), "Act 4 markers expected the page markers to be visibly corrupted");

  let firewall = settle(beginSync(setAct4Obstacle(createInitialState(4), "firewallBlocks", true)));
  assert(firewall.ladder.resolved === 4, `Act 4 firewall expected rung 4 to resolve, got ${firewall.ladder.resolved}`);
  assert(firewall.ladder.active === 4, `Act 4 firewall expected rung 4 active, got ${firewall.ladder.active}`);
  assert(firewall.events.some((entry) => entry.text.includes("403")), "Act 4 expected the WAF 403 event");

  let transport = settle(beginSync(setAct4Obstacle(createInitialState(4), "transportError", true)));
  assert(transport.ladder.resolved === 5, `Act 4 transport expected rung 5 to resolve, got ${transport.ladder.resolved}`);
  assert(transport.events.some((entry) => entry.text.includes("read_back_converged")), "Act 4 expected read-back convergence");
  if (markers.ladder.resolved === 3 && firewall.ladder.resolved === 4 && transport.ladder.resolved === 5) console.log("PASS: Act 4 markers, firewall, and transport paths descend the ladder");
}

// --- Act 5: dry run names owned drift, then live run patches only that drift. ---
{
  let state = createInitialState(5);
  state = handEditField(state, "Queue");
  state = handEditField(state, "Review Date");
  state = handEditField(state, "Notes");
  state = settle(beginSync(state));
  const drifted = state.dryRun.drifted;
  assert(drifted.length === 2, `Act 5 expected 2 owned drifted fields, got ${drifted.length}`);
  assert(state.dryRun.failures === 0, "Act 5 expected a clean preflight");
  assert(state.fields.find((field) => field.name === "Notes")?.remote.includes("hand edit"), "Act 5 expected manual Notes to remain hand-edited");
  state = settle(beginSync(state));
  assert(state.driftCount === 0, `Act 5 expected zero remaining drift, got ${state.driftCount}`);
  assert(state.fields.filter((field) => field.owner !== "manual").every((field) => field.local === field.remote), "Act 5 expected owned fields to converge after live run");
  if (drifted.length === 2 && state.driftCount === 0) console.log("PASS: Act 5 dry run gates surgical drift repair");

  let broken = createInitialState(5);
  broken = handEditField(broken, "Queue");
  broken = setReadFailure(broken, true);
  broken = settle(beginSync(broken));
  const blocked = beginSync(broken);
  assert(broken.dryRun.failures === 1, "Act 5 expected the failed preflight to record one read failure");
  assert(blocked.operations.length === 0 && !blocked.specialReady, "Act 5 expected the failed preflight to block live writes");
}

// --- Act 6: the sandbox keeps key-routed burst rows duplicate-free. ---
{
  let state = createInitialState(6);
  state = setBurstSize(state, 4);
  state = setAct6Toggle(state, "renameRemote", true);
  state = setAct6Toggle(state, "chaos", true);
  state = settle(beginSync(state));
  assert(state.pagesCreated === 4, `Act 6 expected 4 created pages, got ${state.pagesCreated}`);
  assert(duplicateRemoteIds(state).size === 0, "Act 6 expected zero duplicate page ids");
  assert(state.unrouted === 1, `Act 6 expected one unrouted row, got ${state.unrouted}`);
  assert(state.recovered === 4, `Act 6 expected deterministic ack recovery for 4 rows, got ${state.recovered}`);
  if (state.pagesCreated === 4 && duplicateRemoteIds(state).size === 0 && state.unrouted === 1) console.log("PASS: Act 6 burst keeps duplicates at zero while exposing unrouted work");
}

if (process.exitCode) console.error("one or more checks failed");
