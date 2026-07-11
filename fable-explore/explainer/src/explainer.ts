/**
 * One Writer, No Lies — session 1
 *
 * The reducer below owns causal state only. Packet positions are emitted as
 * transitions for the renderer; no reducer branch reads a pixel, DOM node, or
 * rendered packet position.
 */

export type ActId = 1 | 3;

interface ActRules {
  queryBeforeWrite: boolean;
  idempotencyKeys: boolean;
  remoteDeduplicates: boolean;
}

interface ActConfig {
  unlockedToggles: string[];
  rules: ActRules;
  predictBeat: string;
}

export const ACTS: Record<ActId, ActConfig> = {
  1: {
    unlockedToggles: ["drop one ack"],
    rules: { queryBeforeWrite: false, idempotencyKeys: false, remoteDeduplicates: false },
    predictBeat: "The tool retries the row. What does the record look like after?",
  },
  3: {
    unlockedToggles: ["drop one ack", "duplicate delivery", "kill process mid-write"],
    rules: { queryBeforeWrite: true, idempotencyKeys: true, remoteDeduplicates: true },
    predictBeat: "one page or two?",
  },
};

const PROJECTS = ["Project A", "Project B", "Project C"] as const;
const TRANSIT_TICKS = 3;

interface EventEntry {
  id: number;
  tick: number;
  text: string;
}

export interface OutboxRow {
  id: string;
  payload: string;
  syncKey?: string;
  receipt?: string;
  status?: "recovered" | "confirmed";
}

export interface RemoteRow {
  id: string;
  content: string;
  syncKey?: string;
}

type PacketKind = "write" | "ack";
type MotionKind = PacketKind | "query";

export interface Packet {
  id: string;
  kind: MotionKind;
  rowRef: string;
  position: number;
  dropped: boolean;
}

interface Transition {
  id: string;
  kind: MotionKind;
  rowRef: string;
  from: number;
  to: number;
  startTick: number;
  endTick: number;
  dropped: boolean;
}

type OperationStage = "sendQuery" | "queryArrived" | "sendWrite" | "writeArrived" | "sendAck" | "ackLost" | "ackArrived";

interface Operation {
  id: string;
  rowRef: string;
  stage: OperationStage;
  dueTick: number;
  packetId?: string;
  remoteId?: string;
  recovered?: boolean;
  duplicateDelivery?: boolean;
}

interface Toggles {
  dropOneAck: boolean;
  duplicateDelivery: boolean;
}

export interface SimState {
  act: ActId;
  outbox: OutboxRow[];
  remote: RemoteRow[];
  packets: Packet[];
  transitions: Transition[];
  operations: Operation[];
  events: EventEntry[];
  lastTick: number;
  nextRemote: number;
  nextPacket: number;
  nextOperation: number;
  nextEvent: number;
  nextSignal: number;
  pass: number;
  halted: boolean;
  toggles: Toggles;
}

function event(state: SimState, text: string): SimState {
  const entry: EventEntry = { id: state.nextEvent, tick: state.lastTick, text };
  return {
    ...state,
    nextEvent: state.nextEvent + 1,
    events: [entry, ...state.events].slice(0, 5),
  };
}

function schedule(state: SimState, operation: Omit<Operation, "id">): SimState {
  const next: Operation = { ...operation, id: `operation-${state.nextOperation}` };
  return {
    ...state,
    nextOperation: state.nextOperation + 1,
    operations: [...state.operations, next],
  };
}

function emitMotion(
  state: SimState,
  kind: MotionKind,
  rowRef: string,
  from: number,
  to: number,
  dropped: boolean = false,
): { state: SimState; motionId: string } {
  const isPacket = kind === "write" || kind === "ack";
  const motionId = isPacket ? `packet-${state.nextPacket}` : `query-${state.nextSignal}`;
  const transition: Transition = {
    id: motionId,
    kind,
    rowRef,
    from,
    to,
    startTick: state.lastTick,
    endTick: state.lastTick + TRANSIT_TICKS,
    dropped,
  };
  let next: SimState = {
    ...state,
    transitions: [...state.transitions, transition].slice(-32),
    nextPacket: state.nextPacket + (isPacket ? 1 : 0),
    nextSignal: state.nextSignal + (isPacket ? 0 : 1),
  };
  if (isPacket) {
    const packet: Packet = { id: motionId, kind, rowRef, position: from, dropped };
    next = { ...next, packets: [...next.packets, packet] };
  }
  return { state: next, motionId };
}

function removePacket(state: SimState, packetId: string | undefined): SimState {
  if (!packetId) return state;
  return { ...state, packets: state.packets.filter((packet) => packet.id !== packetId) };
}

function rowFor(state: SimState, rowRef: string): OutboxRow {
  const row = state.outbox.find((candidate) => candidate.id === rowRef);
  if (!row) throw new Error(`missing outbox row ${rowRef}`);
  return row;
}

function replaceRow(state: SimState, updated: OutboxRow): SimState {
  return { ...state, outbox: state.outbox.map((row) => (row.id === updated.id ? updated : row)) };
}

function appendRemote(state: SimState, row: OutboxRow, withKey: boolean): { state: SimState; remoteId: string } {
  const remoteId = `remote-page-${state.nextRemote}`;
  const remote: RemoteRow = {
    id: remoteId,
    content: row.payload,
    ...(withKey ? { syncKey: row.syncKey } : {}),
  };
  return { state: { ...state, remote: [...state.remote, remote], nextRemote: state.nextRemote + 1 }, remoteId };
}

function duplicateCount(state: SimState): number {
  const byContent = new Map<string, number>();
  for (const row of state.remote) byContent.set(row.content, (byContent.get(row.content) ?? 0) + 1);
  return [...byContent.values()].filter((count) => count > 1).reduce((total, count) => total + count - 1, 0);
}

/** A seeded full world for the clean opening beat. */
export function createInitialState(act: ActId): SimState {
  const useKeys = ACTS[act].rules.idempotencyKeys;
  return {
    act,
    outbox: PROJECTS.map((payload, index) => ({
      id: String(41 + index),
      payload,
      ...(useKeys ? { syncKey: `bridge:cc:${41 + index}` } : {}),
    })),
    remote: [],
    packets: [],
    transitions: [],
    operations: [],
    events: [],
    lastTick: 0,
    nextRemote: 1,
    nextPacket: 1,
    nextOperation: 1,
    nextEvent: 1,
    nextSignal: 1,
    pass: 0,
    halted: false,
    toggles: { dropOneAck: false, duplicateDelivery: false },
  };
}

/** A one-row replay of the precise write-landed / receipt-lost failure. */
export function createFocusedState(act: ActId): SimState {
  const base = createInitialState(act);
  return { ...base, outbox: [base.outbox[0]] };
}

export function setDropOneAck(state: SimState, enabled: boolean): SimState {
  const next = { ...state, toggles: { ...state.toggles, dropOneAck: enabled } };
  return event(next, enabled ? "failure injector armed: drop one ack" : "failure injector cleared: drop one ack");
}

export function setDuplicateDelivery(state: SimState, enabled: boolean): SimState {
  const next = { ...state, toggles: { ...state.toggles, duplicateDelivery: enabled } };
  return event(next, enabled ? "failure injector armed: duplicate delivery" : "failure injector cleared: duplicate delivery");
}

/** Starts a pass; it is intentionally separate from step so reader input stays explicit. */
export function beginSync(state: SimState): SimState {
  if (state.operations.length > 0) return event(state, "sync pass already in flight");
  const unconfirmed = state.outbox.filter((row) => !row.receipt);
  if (unconfirmed.length === 0) return event(state, "sync pass: every outbox row already has a receipt");
  let next = event(
    { ...state, pass: state.pass + 1, halted: false, packets: [] },
    `run ${state.pass + 1}: queued ${unconfirmed.length} unconfirmed outbox row${unconfirmed.length === 1 ? "" : "s"}`,
  );
  const config = ACTS[state.act];
  const interval = config.rules.queryBeforeWrite ? 14 : 1;
  unconfirmed.forEach((row, index) => {
    next = schedule(next, {
      rowRef: row.id,
      stage: config.rules.queryBeforeWrite ? "sendQuery" : "sendWrite",
      dueTick: next.lastTick + 1 + index * interval,
    });
  });
  // The second delivery is deliberately delayed. It still runs the same reducer
  // path, but it observes the first creation and bounces off the key check.
  if (state.act === 3 && state.toggles.duplicateDelivery) {
    const first = unconfirmed[0];
    next = schedule(next, {
      rowRef: first.id,
      stage: "sendQuery",
      dueTick: next.lastTick + 14,
      duplicateDelivery: true,
    });
    next = event(next, `run ${next.pass}: duplicate delivery queued for row ${first.id}`);
  }
  return next;
}

/** Halts only after create (or during the receipt's return) so restart can prove recovery. */
export function killProcess(state: SimState): SimState {
  const canKill = state.act === 3 && state.operations.some((operation) => operation.stage === "sendAck" || operation.stage === "ackArrived");
  if (!canKill) return event(state, "kill switch waiting: create a page first, then stop before its receipt docks");
  const next = { ...state, operations: [], packets: [], halted: true };
  return event(next, "✕ process stopped after create, before receipt writeback");
}

function queueReceipt(state: SimState, operation: Operation, remoteId: string, recovered: boolean): SimState {
  return schedule(state, {
    rowRef: operation.rowRef,
    stage: "sendAck",
    dueTick: state.lastTick,
    remoteId,
    recovered,
    duplicateDelivery: operation.duplicateDelivery,
  });
}

function advance(state: SimState, operation: Operation): SimState {
  const config = ACTS[state.act];
  const row = rowFor(state, operation.rowRef);
  switch (operation.stage) {
    case "sendQuery": {
      const emitted = emitMotion(state, "query", row.id, 0, 1);
      return schedule(event(emitted.state, `row ${row.id}: query REMOTE by key ${row.syncKey}`), {
        ...operation,
        stage: "queryArrived",
        dueTick: state.lastTick + TRANSIT_TICKS,
      });
    }
    case "queryArrived": {
      const found = state.remote.find((remote) => remote.syncKey === row.syncKey);
      if (found) {
        const recovered = !row.receipt;
        const text = recovered
          ? `row ${row.id}: key hit — recover by writing the receipt only`
          : `row ${row.id}: duplicate delivery bounced off key ${row.syncKey}`;
        return queueReceipt(event(state, text), operation, found.id, recovered);
      }
      return schedule(event(state, `row ${row.id}: key miss — create is allowed`), {
        ...operation,
        stage: "sendWrite",
        dueTick: state.lastTick,
      });
    }
    case "sendWrite": {
      const emitted = emitMotion(state, "write", row.id, 0, 1);
      return schedule(event(emitted.state, `row ${row.id}: write packet sent`), {
        ...operation,
        stage: "writeArrived",
        dueTick: state.lastTick + TRANSIT_TICKS,
        packetId: emitted.motionId,
      });
    }
    case "writeArrived": {
      let next = removePacket(state, operation.packetId);
      if (config.rules.remoteDeduplicates) {
        const alreadyCreated = next.remote.find((remote) => remote.syncKey === row.syncKey);
        if (alreadyCreated) {
          return queueReceipt(event(next, `row ${row.id}: idempotent consumer rejected a second create`), operation, alreadyCreated.id, true);
        }
      }
      const created = appendRemote(next, row, config.rules.idempotencyKeys);
      next = event(created.state, `row ${row.id}: created REMOTE page ${created.remoteId}`);
      return queueReceipt(next, operation, created.remoteId, false);
    }
    case "sendAck": {
      const drop = state.toggles.dropOneAck;
      const emitted = emitMotion(state, "ack", row.id, 1, drop ? 0.5 : 0, drop);
      const afterToggle = drop ? { ...emitted.state, toggles: { ...emitted.state.toggles, dropOneAck: false } } : emitted.state;
      return schedule(event(afterToggle, drop ? `row ${row.id}: receipt packet is crossing the wire — it will be lost` : `row ${row.id}: receipt packet sent`), {
        ...operation,
        stage: drop ? "ackLost" : "ackArrived",
        dueTick: state.lastTick + TRANSIT_TICKS,
        packetId: emitted.motionId,
      });
    }
    case "ackLost": {
      const next = removePacket(state, operation.packetId);
      return event(next, `row ${row.id}: ✕ ack lost; the write landed but the receipt slot is still empty`);
    }
    case "ackArrived": {
      let next = removePacket(state, operation.packetId);
      const receipt = operation.remoteId;
      if (!receipt) throw new Error(`missing receipt target for ${row.id}`);
      const status = operation.recovered ? "recovered" : "confirmed";
      next = replaceRow(next, { ...row, receipt, status });
      return event(next, `row ${row.id}: ${status === "recovered" ? "recovered ✓" : "confirmed ●"}; receipt ${receipt} docked`);
    }
  }
}

/**
 * Pure deterministic reducer. Tick is caller-supplied; this function contains
 * no wall-clock or RNG dependency.
 */
export function step(state: SimState, tick: number): SimState {
  if (tick <= state.lastTick) return state;
  let next = { ...state, lastTick: tick };
  const due = next.operations.filter((operation) => operation.dueTick <= tick);
  next = { ...next, operations: next.operations.filter((operation) => operation.dueTick > tick) };
  for (const operation of due) next = advance(next, operation);
  return next;
}

/** Headless helper used by check.mjs; the UI owns requestAnimationFrame. */
export function runTicks(state: SimState, fromTick: number, throughTick: number): SimState {
  let next = state;
  for (let tick = fromTick; tick <= throughTick; tick += 1) next = step(next, tick);
  return next;
}

export function isIdle(state: SimState): boolean {
  return state.operations.length === 0 && state.packets.length === 0;
}

export function duplicateRemoteIds(state: SimState): Set<string> {
  const seen = new Map<string, string[]>();
  for (const row of state.remote) {
    const logicalKey = state.act === 3 ? row.syncKey ?? row.content : row.content;
    seen.set(logicalKey, [...(seen.get(logicalKey) ?? []), row.id]);
  }
  return new Set([...seen.values()].filter((ids) => ids.length > 1).flat());
}

// --- DOM wiring. It is intentionally guarded so Node can import the reducer. ---
if (typeof document !== "undefined") {
  const SIM_SPEED_MS = 220;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const $ = <T extends HTMLElement>(selector: string): T => {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`missing element ${selector}`);
    return element;
  };

  const act1Tab = $("#act-1-tab");
  const act3Tab = $("#act-3-tab");
  const beatLabel = $("#beat-label");
  const ruleLabel = $("#rule-label");
  const projectCards = $("#project-cards");
  const outboxCount = $("#outbox-count");
  const outboxList = $("#outbox-list");
  const remoteCount = $("#remote-count");
  const remoteList = $("#remote-list");
  const wireTrack = $("#wire-track");
  const toggleControls = $("#toggle-controls");
  const syncButton = $<HTMLButtonElement>("#sync-button");
  const againButton = $<HTMLButtonElement>("#again-button");
  const resetButton = $("#reset-button");
  const narrative = $(".narrative");
  const beatCopy = $("#beat-copy");
  const prediction = $("#prediction");
  const reveal = $("#reveal");
  const nextButton = $<HTMLButtonElement>("#next-button");
  const eventLog = $("#event-log");

  let activeAct: ActId = 1;
  let beat = 0;
  let state = createInitialState(activeAct);
  let selectedPrediction: string | undefined;
  let lastFrame = 0;
  const packetNodes = new Map<string, HTMLElement>();
  const queryNodes = new Map<string, HTMLElement>();

  function focusedFailureReady(): boolean {
    return state.remote.length === 1 && !state.outbox[0]?.receipt && isIdle(state);
  }

  function revealReady(): boolean {
    return Boolean(selectedPrediction) && isIdle(state) && state.outbox[0]?.receipt !== undefined;
  }

  function resetForBeat(): void {
    selectedPrediction = undefined;
    state = beat === 0 ? createInitialState(activeAct) : createFocusedState(activeAct);
    clearWire();
  }

  function clearWire(): void {
    packetNodes.clear();
    queryNodes.clear();
    wireTrack.replaceChildren();
  }

  function setAct(act: ActId): void {
    activeAct = act;
    beat = 0;
    state = createInitialState(act);
    selectedPrediction = undefined;
    clearWire();
    render();
  }

  function nextBeat(): void {
    if (beat === 0) {
      beat = 1;
      resetForBeat();
    } else if (beat === 1 && focusedFailureReady()) {
      beat = 2;
      selectedPrediction = undefined;
    } else if (beat === 2 && revealReady()) {
      beat = 0;
      resetForBeat();
    }
    render();
  }

  function choosePrediction(answer: string): void {
    if (selectedPrediction) return;
    selectedPrediction = answer;
    state = beginSync(state);
    render();
  }

  function renderProjects(): void {
    projectCards.innerHTML = PROJECTS.map((name, index) => {
      const row = state.outbox.find((candidate) => candidate.payload === name);
      const status = row?.receipt ? "● receipt" : row ? "○ queued" : "○ idle";
      return `<div class="project-card"><strong>${name}</strong><span class="project-state">${status}</span></div>`;
    }).join("");
  }

  function renderOutbox(): void {
    outboxCount.textContent = `${state.outbox.length} rows`;
    outboxList.innerHTML = state.outbox.map((row) => {
      const receipt = row.receipt
        ? `<span class="receipt">● ${row.receipt}</span>`
        : `<span class="receipt empty">○ empty</span>`;
      const recovered = row.status === "recovered" ? `<span class="recovered">✓ recovered</span>` : "";
      const key = activeAct === 3 ? `<span class="key-tag">${row.syncKey}</span>` : "";
      return `<li class="outbox-row"><span class="row-id">#${row.id}</span><div><p class="row-title">${row.payload}</p><div class="row-meta">${key}${receipt}${recovered}</div></div></li>`;
    }).join("");
  }

  function renderRemote(): void {
    remoteCount.textContent = `${state.remote.length} pages`;
    if (state.remote.length === 0) {
      remoteList.innerHTML = `<li class="empty-remote">▤ no pages yet</li>`;
      return;
    }
    const duplicates = duplicateRemoteIds(state);
    remoteList.innerHTML = state.remote.map((row) => {
      const duplicate = duplicates.has(row.id);
      const key = activeAct === 3 ? `<span class="key-slot">key slot: ${row.syncKey}</span>` : "";
      return `<li class="remote-row${duplicate ? " duplicate" : ""}"><span class="row-id">${row.id}</span><p class="row-title">▤ ${row.content}</p>${key}</li>`;
    }).join("");
  }

  function renderPackets(): void {
    const activePackets = new Set(state.packets.map((packet) => packet.id));
    for (const [id, node] of packetNodes) {
      if (!activePackets.has(id)) {
        node.remove();
        packetNodes.delete(id);
      }
    }
    for (const packet of state.packets) {
      if (packetNodes.has(packet.id)) continue;
      const motion = state.transitions.find((transition) => transition.id === packet.id);
      if (!motion) continue;
      const node = document.createElement("span");
      node.className = `packet ${packet.kind}${packet.dropped ? " dropped" : ""}`;
      node.setAttribute("aria-hidden", "true");
      node.textContent = packet.kind === "write" ? "→" : "●";
      node.style.setProperty("--packet-pos", `${motion.from * 100}%`);
      wireTrack.append(node);
      packetNodes.set(packet.id, node);
      requestAnimationFrame(() => {
        node.style.setProperty("--packet-pos", `${motion.to * 100}%`);
        if (reducedMotion) node.classList.add("reduced");
      });
    }
    const activeQueries = state.transitions.filter((motion) => motion.kind === "query" && state.lastTick - motion.startTick <= TRANSIT_TICKS);
    const activeQueryIds = new Set(activeQueries.map((motion) => motion.id));
    for (const [id, node] of queryNodes) {
      if (!activeQueryIds.has(id)) {
        node.remove();
        queryNodes.delete(id);
      }
    }
    for (const motion of activeQueries) {
      if (queryNodes.has(motion.id)) continue;
      const node = document.createElement("span");
      node.className = "query-signal";
      node.setAttribute("aria-hidden", "true");
      node.textContent = "LOOKUP";
      wireTrack.append(node);
      queryNodes.set(motion.id, node);
    }
  }

  function renderToggles(): void {
    const canKill = state.act === 3 && state.operations.some((operation) => operation.stage === "sendAck" || operation.stage === "ackArrived");
    const controls = [
      `<button class="toggle" type="button" data-toggle="drop" aria-pressed="${state.toggles.dropOneAck}">✕ drop one ack</button>`,
    ];
    if (activeAct === 3) {
      controls.push(`<button class="toggle" type="button" data-toggle="duplicate" aria-pressed="${state.toggles.duplicateDelivery}">↯ duplicate delivery</button>`);
      controls.push(`<button class="toggle kill" type="button" data-toggle="kill" ${canKill ? "" : "disabled"}>✕ kill process mid-write</button>`);
    }
    toggleControls.innerHTML = controls.join("");
    toggleControls.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => {
        const toggle = button.dataset.toggle;
        if (toggle === "drop") state = setDropOneAck(state, !state.toggles.dropOneAck);
        if (toggle === "duplicate") state = setDuplicateDelivery(state, !state.toggles.duplicateDelivery);
        if (toggle === "kill") state = killProcess(state);
        render();
      });
    });
  }

  function renderNarrative(): void {
    narrative.classList.toggle("act-three", activeAct === 3);
    const config = ACTS[activeAct];
    const cleanCopy = "works fine, ship it.";
    const failureCopy = activeAct === 1
      ? "Toggle \"drop one ack\", then run one sync pass. The write should arrive while its receipt is lost."
      : "Re-run Act 1's betrayal: drop the ack, then retry the same outbox row under query-by-key rules.";
    const prompt = activeAct === 1 ? config.predictBeat : config.predictBeat;
    beatCopy.textContent = beat === 0 ? cleanCopy : beat === 1 ? failureCopy : prompt;
    const isPredictionBeat = beat === 2;
    prediction.hidden = !isPredictionBeat;
    if (isPredictionBeat) {
      const options = ["one page", "two pages", "an error"];
      prediction.innerHTML = `<p>WHAT HAPPENS NEXT?</p><div class="prediction-options">${options.map((option) => `<button class="prediction-button" type="button" data-answer="${option}" ${selectedPrediction ? "disabled" : ""}>${option}</button>`).join("")}</div>${selectedPrediction ? `<p class="guess-note">your guess: ${selectedPrediction}</p>` : ""}`;
      prediction.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => choosePrediction(button.dataset.answer ?? "")));
    }
    const showReveal = isPredictionBeat && revealReady();
    reveal.hidden = !showReveal;
    if (showReveal && activeAct === 1) {
      const correct = selectedPrediction === "two pages";
      reveal.innerHTML = `<p><strong>${correct ? "✓" : "✗"} ${correct ? "Correct." : "The record says two pages."}</strong> ${duplicateCount(state) > 0 ? "⚠ duplicate remains flagged on REMOTE." : ""}</p><p>"The write succeeded. Only the <em>receipt</em> was lost. The tool couldn't tell the difference, so it lied by repetition."</p>`;
    } else if (showReveal) {
      const correct = selectedPrediction === "one page";
      reveal.innerHTML = `<p><strong>${correct ? "✓" : "✗"} ${correct ? "Correct." : "The key check converges to one page."}</strong> The retry queried the key, found the existing page, and returned only a receipt. ✓ recovered</p><p>"You don't prevent the duplicate delivery. You make it converge."</p><p>"The receipt is the queue's proof it was drained — provenance pointing both directions."</p><p>"The real system shipped for months with rung 3 missing its key check. Here's the run that found it."</p>`;
    }
    if (beat === 0) {
      nextButton.textContent = "set up a lost receipt →";
      nextButton.disabled = false;
    } else if (beat === 1) {
      nextButton.textContent = "predict the retry →";
      nextButton.disabled = !focusedFailureReady();
    } else {
      nextButton.textContent = revealReady() ? "restart this act ↺" : "waiting for the reveal…";
      nextButton.disabled = !revealReady();
    }
  }

  function render(): void {
    act1Tab.setAttribute("aria-selected", String(activeAct === 1));
    act3Tab.setAttribute("aria-selected", String(activeAct === 3));
    beatLabel.textContent = `ACT ${activeAct} · BEAT ${beat + 1} OF 3`;
    ruleLabel.textContent = activeAct === 1 ? "append on arrival · no key check" : "query by key → create if missing → receipt";
    renderProjects();
    renderOutbox();
    renderRemote();
    renderPackets();
    renderToggles();
    renderNarrative();
    eventLog.innerHTML = state.events.map((entry) => `<li>t${entry.tick} · ${entry.text}</li>`).join("") || "<li>ready: choose a sync pass</li>";
    const inFlight = !isIdle(state);
    syncButton.disabled = inFlight || (beat === 2 && Boolean(selectedPrediction));
    againButton.disabled = inFlight || (beat === 2 && Boolean(selectedPrediction));
  }

  act1Tab.addEventListener("click", () => setAct(1));
  act3Tab.addEventListener("click", () => setAct(3));
  syncButton.addEventListener("click", () => { state = beginSync(state); render(); });
  againButton.addEventListener("click", () => { state = beginSync(state); render(); });
  resetButton.addEventListener("click", () => { resetForBeat(); render(); });
  nextButton.addEventListener("click", nextBeat);

  function frame(now: number): void {
    if (now - lastFrame >= SIM_SPEED_MS) {
      lastFrame = now;
      state = step(state, state.lastTick + 1);
      render();
    }
    requestAnimationFrame(frame);
  }

  render();
  requestAnimationFrame(frame);
}
