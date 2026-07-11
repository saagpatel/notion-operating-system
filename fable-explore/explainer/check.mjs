// Headless verification for the shared reducer: drives Act 1 (naive sync) and
// Act 3 (outbox + receipt) through the identical dropped-ack-then-retry failure
// and asserts the two convergence properties the storyboard requires.
import {
  createFocusedState,
  setDropOneAck,
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
  if (!isIdle(settled)) {
    throw new Error("simulation did not settle within 200 ticks");
  }
  return settled;
}

function droppedAckThenRetry(act) {
  let state = createFocusedState(act);
  state = setDropOneAck(state, true);
  state = beginSync(state);
  state = settle(state); // first pass: write lands, ack is dropped
  state = beginSync(state); // retry the same unconfirmed row
  state = settle(state); // second pass completes
  return state;
}

// --- Act 1: naive sync has no key check, so the retry appends a second page. ---
{
  const state = droppedAckThenRetry(1);
  const duplicates = duplicateRemoteIds(state);
  assert(state.remote.length === 2, `Act 1 expected 2 remote rows, got ${state.remote.length}`);
  assert(duplicates.size === 2, `Act 1 expected both rows flagged as duplicates, got ${duplicates.size}`);
  if (state.remote.length === 2 && duplicates.size === 2) {
    console.log("PASS: Act 1 duplicate after dropped ack + retry");
  }
}

// --- Act 3: query-by-key means the retry recovers instead of re-creating. ---
{
  const state = droppedAckThenRetry(3);
  const duplicates = duplicateRemoteIds(state);
  const row = state.outbox[0];
  assert(state.remote.length === 1, `Act 3 expected 1 remote row, got ${state.remote.length}`);
  assert(duplicates.size === 0, `Act 3 expected no duplicates, got ${duplicates.size}`);
  assert(Boolean(row.receipt), "Act 3 expected the outbox row to have a receipt written back");
  assert(row.status === "recovered", `Act 3 expected row status "recovered", got ${row.status}`);
  if (state.remote.length === 1 && duplicates.size === 0 && row.receipt && row.status === "recovered") {
    console.log("PASS: Act 3 convergence + receipt after dropped ack + retry");
  }
}

if (process.exitCode) {
  console.error("one or more checks failed");
} 
