/**
 * One Writer, No Lies — deterministic explainer simulation.
 *
 * The reducer owns causal state. Packet positions and CSS animation are
 * presentational only. Every act uses the same tick-driven operation queue;
 * the act-specific rules only change what an operation is allowed to do.
 */

export type ActId = 1 | 2 | 3 | 4 | 5 | 6;
export type WriterId = "control-tower" | "signal-sync" | "manual";
export type FieldName = "Queue" | "Review Date" | "Freshness" | "Notes";

interface ActRules {
  queryBeforeWrite: boolean;
  idempotencyKeys: boolean;
  remoteDeduplicates: boolean;
}

interface ActConfig {
  label: string;
  subtitle: string;
  rules: ActRules;
  predictBeat: string;
}

export const ACTS: Record<ActId, ActConfig> = {
  1: {
    label: "the naive sync",
    subtitle: "append on arrival · no key check",
    rules: { queryBeforeWrite: false, idempotencyKeys: false, remoteDeduplicates: false },
    predictBeat: "The tool retries the row. What does the record look like after?",
  },
  2: {
    label: "one writer per field",
    subtitle: "ownership before merge",
    rules: { queryBeforeWrite: false, idempotencyKeys: false, remoteDeduplicates: false },
    predictBeat: "Both bots run at the same moment. Which field can end up wrong?",
  },
  3: {
    label: "the outbox & receipt",
    subtitle: "query by key → create if missing → receipt",
    rules: { queryBeforeWrite: true, idempotencyKeys: true, remoteDeduplicates: true },
    predictBeat: "one page or two?",
  },
  4: {
    label: "the ladder",
    subtitle: "no-op → swap → replace → insert → read-back",
    rules: { queryBeforeWrite: false, idempotencyKeys: true, remoteDeduplicates: true },
    predictBeat: "The firewall rejected the patch because of what the text says. What does the tool do?",
  },
  5: {
    label: "drift and dry run",
    subtitle: "read first · write only what drifted",
    rules: { queryBeforeWrite: true, idempotencyKeys: true, remoteDeduplicates: true },
    predictBeat: "The live pass rewrites — (a) everything, (b) the two drifted fields, (c) the whole page?",
  },
  6: {
    label: "chaos mode",
    subtitle: "all toggles live",
    rules: { queryBeforeWrite: true, idempotencyKeys: true, remoteDeduplicates: true },
    predictBeat: "What should the duplicates counter say after the run?",
  },
};

const PROJECTS = ["Project A", "Project B", "Project C"] as const;
const TRANSIT_TICKS = 3;
const FIELD_NAMES: FieldName[] = ["Queue", "Review Date", "Freshness", "Notes"];
const CHAOS_FAILURES = ["ack", "duplicate", "drift"] as const;

type FieldStatus = "clean" | "drift" | "manual";

export interface FieldState {
  name: FieldName;
  local: string;
  remote: string;
  owner: WriterId;
  status: FieldStatus;
  manuallyEdited: boolean;
}

export interface SectionState {
  id: string;
  heading: string;
  content: string;
  markersIntact: boolean;
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

type OperationStage =
  | "sendQuery"
  | "queryArrived"
  | "sendWrite"
  | "writeArrived"
  | "sendAck"
  | "ackLost"
  | "ackArrived"
  | "fieldPatch"
  | "fieldDone"
  | "ladderRun"
  | "dryRead"
  | "dryPatch"
  | "burst";

interface Operation {
  id: string;
  rowRef: string;
  stage: OperationStage;
  dueTick: number;
  packetId?: string;
  remoteId?: string;
  recovered?: boolean;
  duplicateDelivery?: boolean;
  fieldName?: FieldName;
  writer?: WriterId;
}

export interface SimToggles {
  dropOneAck: boolean;
  duplicateDelivery: boolean;
  killProcess: boolean;
  markersCorrupted: boolean;
  firewallBlocks: boolean;
  transportError: boolean;
  readFailure: boolean;
  renameRemote: boolean;
  chaos: boolean;
}

interface DryRunState {
  complete: boolean;
  failures: number;
  drifted: FieldName[];
  clean: number;
}

interface EventEntry {
  id: number;
  tick: number;
  text: string;
}

export interface SimState {
  act: ActId;
  outbox: OutboxRow[];
  remote: RemoteRow[];
  packets: Packet[];
  transitions: Transition[];
  operations: Operation[];
  events: EventEntry[];
  fields: FieldState[];
  sections: SectionState[];
  ladder: { active: number; resolved: number | undefined; failed: number[] };
  dryRun: DryRunState;
  lastTick: number;
  nextRemote: number;
  nextPacket: number;
  nextOperation: number;
  nextEvent: number;
  nextSignal: number;
  pass: number;
  halted: boolean;
  specialReady: boolean;
  burstSize: number;
  pagesCreated: number;
  recovered: number;
  driftCount: number;
  unrouted: number;
  toggles: SimToggles;
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
  return { ...state, nextOperation: state.nextOperation + 1, operations: [...state.operations, next] };
}

function emitMotion(
  state: SimState,
  kind: MotionKind,
  rowRef: string,
  from: number,
  to: number,
  dropped = false,
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
  return packetId ? { ...state, packets: state.packets.filter((packet) => packet.id !== packetId) } : state;
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
  const remote: RemoteRow = { id: remoteId, content: row.payload, ...(withKey ? { syncKey: row.syncKey } : {}) };
  return { state: { ...state, remote: [...state.remote, remote], nextRemote: state.nextRemote + 1 }, remoteId };
}

function duplicateCount(state: SimState): number {
  const byContent = new Map<string, number>();
  for (const row of state.remote) {
    const logicalKey = state.act === 3 || state.act === 6 ? row.syncKey ?? row.content : row.content;
    byContent.set(logicalKey, (byContent.get(logicalKey) ?? 0) + 1);
  }
  return [...byContent.values()].filter((count) => count > 1).reduce((total, count) => total + count - 1, 0);
}

function initialFields(act: ActId): FieldState[] {
  const fields: Array<[FieldName, string, string, WriterId]> = [
    ["Queue", "Active Build", "Needs Review", "control-tower"],
    ["Review Date", "Today", "Yesterday", "control-tower"],
    ["Freshness", "Fresh", "Stale", "signal-sync"],
    ["Notes", "Operator note", "Operator note", "manual"],
  ];
  return fields.map(([name, local, remote, owner]) => {
    const remoteValue = act === 5 ? local : remote;
    return { name, local, remote: remoteValue, owner, status: "clean", manuallyEdited: false };
  });
}

function initialSections(): SectionState[] {
  return [
    { id: "section-1", heading: "section 1", content: "the stable heading", markersIntact: true },
    { id: "section-2", heading: "section 2", content: "the paragraph LOCAL wants to update", markersIntact: true },
    { id: "section-3", heading: "section 3", content: "the child content that must survive", markersIntact: true },
  ];
}

/** A deterministic opening world shared by every act. */
export function createInitialState(act: ActId): SimState {
  const useKeys = act === 3 || act === 6;
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
    fields: initialFields(act),
    sections: initialSections(),
    ladder: { active: 0, resolved: undefined, failed: [] },
    dryRun: { complete: false, failures: 0, drifted: [], clean: 0 },
    lastTick: 0,
    nextRemote: 1,
    nextPacket: 1,
    nextOperation: 1,
    nextEvent: 1,
    nextSignal: 1,
    pass: 0,
    halted: false,
    specialReady: false,
    burstSize: 3,
    pagesCreated: 0,
    recovered: 0,
    driftCount: 0,
    unrouted: 0,
    toggles: {
      dropOneAck: false,
      duplicateDelivery: false,
      killProcess: false,
      markersCorrupted: false,
      firewallBlocks: false,
      transportError: false,
      readFailure: false,
      renameRemote: false,
      chaos: false,
    },
  };
}

/** A one-row replay of the precise write-landed / receipt-lost failure. */
export function createFocusedState(act: 1 | 3): SimState {
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

export function setAct4Obstacle(state: SimState, obstacle: "markersCorrupted" | "firewallBlocks" | "transportError", enabled: boolean): SimState {
  const sections = obstacle === "markersCorrupted"
    ? state.sections.map((section) => ({ ...section, markersIntact: !enabled }))
    : state.sections;
  const next = { ...state, sections, specialReady: false, toggles: { ...state.toggles, [obstacle]: enabled } };
  const labels = { markersCorrupted: "markers corrupted", firewallBlocks: "firewall blocks the patch", transportError: "transport error" };
  return event(next, enabled ? `obstacle armed: ${labels[obstacle]}` : `obstacle cleared: ${labels[obstacle]}`);
}

export function setReadFailure(state: SimState, enabled: boolean): SimState {
  const next = { ...state, toggles: { ...state.toggles, readFailure: enabled } };
  return event(next, enabled ? "failure injector armed: make one read fail" : "failure injector cleared: make one read fail");
}

export function setAct6Toggle(state: SimState, toggle: "renameRemote" | "chaos", enabled: boolean): SimState {
  const next = { ...state, toggles: { ...state.toggles, [toggle]: enabled } };
  return event(next, enabled ? `sandbox injector armed: ${toggle}` : `sandbox injector cleared: ${toggle}`);
}

export function setBurstSize(state: SimState, value: number): SimState {
  const burstSize = Math.max(1, Math.min(20, Math.round(value)));
  return { ...state, burstSize };
}

export function moveFieldOwnership(state: SimState, fieldName: FieldName, owner: Exclude<WriterId, "manual">): SimState {
  const fields: FieldState[] = state.fields.map((field) => field.name === fieldName ? { ...field, owner, status: (field.local === field.remote ? "clean" : "drift") as FieldStatus } : field);
  return event({ ...state, fields, specialReady: false }, `${fieldName} ownership moved to ${owner}`);
}

export function handEditField(state: SimState, fieldName: FieldName): SimState {
  const fields = state.fields.map((field) => {
    if (field.name !== fieldName) return field;
    const remote = `${field.local} · hand edit`;
    return { ...field, remote, manuallyEdited: true, status: (field.owner === "manual" ? "manual" : "drift") as FieldStatus };
  });
  return event({ ...state, fields, specialReady: false }, `hand edit: ${fieldName} changed on REMOTE`);
}

function queueReceipt(state: SimState, operation: Operation, remoteId: string, recovered: boolean): SimState {
  return schedule(state, { rowRef: operation.rowRef, stage: "sendAck", dueTick: state.lastTick, remoteId, recovered, duplicateDelivery: operation.duplicateDelivery });
}

/** Starts an at-least-once page pass for Acts 1 and 3. */
function beginPageSync(state: SimState): SimState {
  const unconfirmed = state.outbox.filter((row) => !row.receipt);
  if (unconfirmed.length === 0) return event(state, "sync pass: every outbox row already has a receipt");
  let next = event({ ...state, pass: state.pass + 1, halted: false, packets: [] }, `run ${state.pass + 1}: queued ${unconfirmed.length} unconfirmed outbox row${unconfirmed.length === 1 ? "" : "s"}`);
  const config = ACTS[state.act];
  const interval = config.rules.queryBeforeWrite ? 14 : 1;
  unconfirmed.forEach((row, index) => {
    next = schedule(next, { rowRef: row.id, stage: config.rules.queryBeforeWrite ? "sendQuery" : "sendWrite", dueTick: next.lastTick + 1 + index * interval });
  });
  if (state.act === 3 && state.toggles.duplicateDelivery) {
    const first = unconfirmed[0];
    next = schedule(next, { rowRef: first.id, stage: "sendQuery", dueTick: next.lastTick + 14, duplicateDelivery: true });
    next = event(next, `run ${next.pass}: duplicate delivery queued for row ${first.id}`);
  }
  return next;
}

function beginFieldSync(state: SimState): SimState {
  let next = { ...state, pass: state.pass + 1, specialReady: false };
  const targets = next.fields.filter((field) => field.owner !== "manual" && field.local !== field.remote);
  if (targets.length === 0) return event({ ...next, specialReady: true }, "control-tower + signal-sync: no shared field collision");
  targets.forEach((field, index) => {
    next = schedule(next, { rowRef: `field:${field.name}`, fieldName: field.name, writer: field.owner, stage: "fieldPatch", dueTick: next.lastTick + 1 + index * 2 });
  });
  return event(next, `run ${next.pass}: writers diff only the fields they own`);
}

function beginLadderSync(state: SimState): SimState {
  return schedule(event({ ...state, pass: state.pass + 1, specialReady: false }, `run ${state.pass + 1}: fallback ladder armed`), {
    rowRef: "section-2",
    stage: "ladderRun",
    dueTick: state.lastTick + 1,
  });
}

function beginDryRun(state: SimState): SimState {
  if (state.dryRun.complete && state.dryRun.failures > 0) {
    return event({ ...state, specialReady: false }, "a broken preflight never escalates to writes");
  }
  const stage = state.dryRun.complete ? "dryPatch" : "dryRead";
  return schedule(event({ ...state, pass: state.pass + 1, specialReady: false }, stage === "dryRead" ? `dry run ${state.pass + 1}: reads only` : `live run ${state.pass + 1}: patch drifted fields only`), {
    rowRef: "dry-run",
    stage,
    dueTick: state.lastTick + 1,
  });
}

function beginBurst(state: SimState): SimState {
  return schedule(event({ ...state, pass: state.pass + 1, specialReady: false }, `run ${state.pass + 1}: burst ${state.burstSize} rows`), {
    rowRef: "burst",
    stage: "burst",
    dueTick: state.lastTick + 1,
  });
}

/** Starts a pass; all act variants still enter the same deterministic queue. */
export function beginSync(state: SimState): SimState {
  if (state.operations.length > 0) return event(state, "sync pass already in flight");
  if (state.act === 1 || state.act === 3) return beginPageSync(state);
  if (state.act === 2) return beginFieldSync(state);
  if (state.act === 4) return beginLadderSync(state);
  if (state.act === 5) return beginDryRun(state);
  return beginBurst(state);
}

/** Halts only after create (or during the receipt's return) so restart can prove recovery. */
export function killProcess(state: SimState): SimState {
  const canKill = state.act === 3 && state.operations.some((operation) => operation.stage === "sendAck" || operation.stage === "ackArrived");
  if (!canKill) return event(state, "kill switch waiting: create a page first, then stop before its receipt docks");
  return event({ ...state, operations: [], packets: [], halted: true }, "✕ process stopped after create, before receipt writeback");
}

function advancePage(state: SimState, operation: Operation): SimState {
  const config = ACTS[state.act];
  const row = rowFor(state, operation.rowRef);
  switch (operation.stage) {
    case "sendQuery": {
      const emitted = emitMotion(state, "query", row.id, 0, 1);
      return schedule(event(emitted.state, `row ${row.id}: query REMOTE by key ${row.syncKey}`), { ...operation, stage: "queryArrived", dueTick: state.lastTick + TRANSIT_TICKS });
    }
    case "queryArrived": {
      const found = state.remote.find((remote) => remote.syncKey === row.syncKey);
      if (found) {
        const recovered = !row.receipt;
        const text = recovered ? `row ${row.id}: key hit — recover by writing the receipt only` : `row ${row.id}: duplicate delivery bounced off key ${row.syncKey}`;
        return queueReceipt(event(state, text), operation, found.id, recovered);
      }
      return schedule(event(state, `row ${row.id}: key miss — create is allowed`), { ...operation, stage: "sendWrite", dueTick: state.lastTick });
    }
    case "sendWrite": {
      const emitted = emitMotion(state, "write", row.id, 0, 1);
      return schedule(event(emitted.state, `row ${row.id}: write packet sent`), { ...operation, stage: "writeArrived", dueTick: state.lastTick + TRANSIT_TICKS, packetId: emitted.motionId });
    }
    case "writeArrived": {
      let next = removePacket(state, operation.packetId);
      if (config.rules.remoteDeduplicates) {
        const alreadyCreated = next.remote.find((remote) => remote.syncKey === row.syncKey);
        if (alreadyCreated) return queueReceipt(event(next, `row ${row.id}: idempotent consumer rejected a second create`), operation, alreadyCreated.id, true);
      }
      const created = appendRemote(next, row, config.rules.idempotencyKeys);
      next = event(created.state, `row ${row.id}: created REMOTE page ${created.remoteId}`);
      return queueReceipt(next, operation, created.remoteId, false);
    }
    case "sendAck": {
      const drop = state.toggles.dropOneAck;
      const emitted = emitMotion(state, "ack", row.id, 1, drop ? 0.5 : 0, drop);
      const afterToggle = drop ? { ...emitted.state, toggles: { ...emitted.state.toggles, dropOneAck: false } } : emitted.state;
      return schedule(event(afterToggle, drop ? `row ${row.id}: receipt packet is crossing the wire — it will be lost` : `row ${row.id}: receipt packet sent`), { ...operation, stage: drop ? "ackLost" : "ackArrived", dueTick: state.lastTick + TRANSIT_TICKS, packetId: emitted.motionId });
    }
    case "ackLost":
      return event(removePacket(state, operation.packetId), `row ${row.id}: ✕ ack lost; the write landed but the receipt slot is still empty`);
    case "ackArrived": {
      let next = removePacket(state, operation.packetId);
      if (!operation.remoteId) throw new Error(`missing receipt target for ${row.id}`);
      const status = operation.recovered ? "recovered" : "confirmed";
      next = replaceRow(next, { ...row, receipt: operation.remoteId, status });
      return event(next, `row ${row.id}: ${status === "recovered" ? "recovered ✓" : "confirmed ●"}; receipt ${operation.remoteId} docked`);
    }
    default:
      return state;
  }
}

function advanceField(state: SimState, operation: Operation): SimState {
  if (!operation.fieldName || !operation.writer) return state;
  if (operation.stage === "fieldPatch") {
    const emitted = emitMotion(state, "write", `field:${operation.fieldName}`, 0, 1);
    const fields: FieldState[] = state.fields.map((field) => field.name === operation.fieldName ? { ...field, remote: field.local, status: "clean", manuallyEdited: false } : field);
    return schedule(event({ ...emitted.state, fields }, `${operation.writer} patched ${operation.fieldName} only`), { ...operation, stage: "fieldDone", dueTick: state.lastTick + TRANSIT_TICKS, packetId: emitted.motionId });
  }
  const next = removePacket(state, operation.packetId);
  return event({ ...next, specialReady: next.operations.length === 0 }, `${operation.writer} settled ${operation.fieldName}; no collision`);
}

function advanceLadder(state: SimState): SimState {
  const { markersCorrupted, firewallBlocks, transportError } = state.toggles;
  const failed: number[] = [];
  const fail = (rung: number): void => {
    if (!failed.includes(rung)) failed.push(rung);
  };
  let active = 1;
  let resolved = 1;
  let next = state;
  if (markersCorrupted || firewallBlocks) {
    fail(2);
    active = 2;
    resolved = 3;
    next = event(next, "rung 2 · swap: markers are not trustworthy");
  }
  if (markersCorrupted) {
    if (markersCorrupted) next = event(next, "rung 3 · replace: guard passed; no child pages dropped");
    active = 3;
    resolved = 3;
  }
  if (firewallBlocks) {
    fail(3);
    active = 4;
    resolved = 4;
    next = event(next, "403 packet: the request was unpalatable");
    if (firewallBlocks && !transportError) next = event(next, "rung 4 · insert: anchored after the heading");
  }
  if (transportError) {
    fail(4);
    active = 5;
    resolved = 5;
    next = event(next, "write packet landed; response died in transit");
    next = event(next, "rung 5 · read-back: normalized-equal · read_back_converged");
  }
  if (!markersCorrupted && !firewallBlocks && !transportError) next = event(next, "rung 1 · no-op: normalized sections already equal");
  return { ...next, ladder: { active, resolved, failed }, specialReady: true };
}

function advanceDryRun(state: SimState, stage: "dryRead" | "dryPatch"): SimState {
  if (stage === "dryRead") {
    const drifted = state.fields.filter((field) => field.owner !== "manual" && field.local !== field.remote).map((field) => field.name);
    const failures = state.toggles.readFailure ? 1 : 0;
    const clean = state.fields.length - drifted.length;
    const statuses = state.fields.map((field) => field.owner === "manual" ? { ...field, status: "manual" as const } : { ...field, status: drifted.includes(field.name) ? "drift" as const : "clean" as const });
    const next = { ...state, fields: statuses, dryRun: { complete: true, failures, drifted, clean }, driftCount: drifted.length, specialReady: true };
    return event(next, failures ? `dry run: ${clean} clean · ${drifted.length} drift · 1 read failed` : `dry run: ${clean} clean · ${drifted.length} drift`);
  }
  if (state.dryRun.failures > 0) return event({ ...state, specialReady: false }, "a broken preflight never escalates to writes");
  const drifted = new Set(state.dryRun.drifted);
  const fields = state.fields.map((field) => drifted.has(field.name) ? { ...field, remote: field.local, status: "clean" as const, manuallyEdited: false } : field);
  return event({ ...state, fields, driftCount: 0, specialReady: true }, `live run: patched ${state.dryRun.drifted.length} drifted field${state.dryRun.drifted.length === 1 ? "" : "s"}`);
}

function advanceBurst(state: SimState): SimState {
  const rows = Array.from({ length: state.burstSize }, (_, index) => ({
    id: `remote-page-${state.nextRemote + index}`,
    content: `Project ${String.fromCharCode(65 + (index % 3))} · burst ${state.pass}`,
    syncKey: `bridge:cc:burst:${state.pass}:${index}`,
  }));
  let next: SimState = { ...state, remote: [...state.remote, ...rows], nextRemote: state.nextRemote + rows.length, pagesCreated: state.pagesCreated + rows.length, specialReady: true };
  if (state.toggles.renameRemote) {
    next = event(next, "remote page renamed; key route held · title-matched row unrouted, retrying forever, nagging you");
    next = { ...next, unrouted: next.unrouted + 1 };
  }
  if (state.toggles.chaos) {
    const failure = CHAOS_FAILURES[(state.pass - 1) % CHAOS_FAILURES.length];
    if (failure === "ack") next = event({ ...next, recovered: next.recovered + rows.length }, "chaos: ack drop recovered by key");
    if (failure === "duplicate") next = event(next, "chaos: duplicate delivery bounced; duplicates 0");
    if (failure === "drift") next = event({ ...next, driftCount: next.driftCount + 1 }, "chaos: drift surfaced in the HUD");
  }
  return next;
}

/** Pure deterministic reducer. Tick is caller-supplied; there is no wall clock or RNG dependency. */
export function step(state: SimState, tick: number): SimState {
  if (tick <= state.lastTick) return state;
  let next = { ...state, lastTick: tick };
  const due = next.operations.filter((operation) => operation.dueTick <= tick);
  next = { ...next, operations: next.operations.filter((operation) => operation.dueTick > tick) };
  for (const operation of due) {
    if (state.act === 1 || state.act === 3) next = advancePage(next, operation);
    else if (state.act === 2) next = advanceField(next, operation);
    else if (state.act === 4 && operation.stage === "ladderRun") next = advanceLadder(next);
    else if (state.act === 5 && (operation.stage === "dryRead" || operation.stage === "dryPatch")) next = advanceDryRun(next, operation.stage);
    else if (state.act === 6 && operation.stage === "burst") next = advanceBurst(next);
  }
  return next;
}

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
    const logicalKey = state.act === 3 || state.act === 6 ? row.syncKey ?? row.content : row.content;
    seen.set(logicalKey, [...(seen.get(logicalKey) ?? []), row.id]);
  }
  return new Set([...seen.values()].filter((ids) => ids.length > 1).flat());
}

// --- DOM wiring. It is guarded so Node can import the reducer for headless checks. ---
if (typeof document !== "undefined") {
  const SIM_SPEED_MS = 220;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = <T extends HTMLElement>(selector: string): T => {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`missing element ${selector}`);
    return element;
  };

  const tabs = ([1, 2, 3, 4, 5, 6] as ActId[]).map((act) => $<HTMLButtonElement>(`#act-${act}-tab`));
  const beatLabel = $("#beat-label");
  const ruleLabel = $("#rule-label");
  const projectCards = $("#project-cards");
  const specialLocal = $("#special-local");
  const outboxCount = $("#outbox-count");
  const outboxList = $("#outbox-list");
  const remoteCount = $("#remote-count");
  const remoteList = $("#remote-list");
  const specialRemote = $("#special-remote");
  const wireTrack = $("#wire-track");
  const toggleControls = $("#toggle-controls");
  const syncButton = $<HTMLButtonElement>("#sync-button");
  const againButton = $<HTMLButtonElement>("#again-button");
  const resetButton = $<HTMLButtonElement>("#reset-button");
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
  let draggedField: FieldName | undefined;
  const packetNodes = new Map<string, HTMLElement>();
  const queryNodes = new Map<string, HTMLElement>();

  function focusedFailureReady(): boolean {
    return state.remote.length === 1 && !state.outbox[0]?.receipt && isIdle(state);
  }

  function revealReady(): boolean {
    if (!selectedPrediction || !isIdle(state)) return false;
    if (activeAct === 1 || activeAct === 3) return state.outbox[0]?.receipt !== undefined;
    return state.specialReady;
  }

  function readyForNext(): boolean {
    return activeAct === 1 || activeAct === 3 ? (beat === 0 || focusedFailureReady()) : state.specialReady;
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

  function resetForBeat(): void {
    selectedPrediction = undefined;
    if (activeAct === 1 || activeAct === 3) state = beat === 0 ? createInitialState(activeAct) : createFocusedState(activeAct);
    clearWire();
  }

  function nextBeat(): void {
    if (beat === 0 && readyForNext()) {
      beat = 1;
      resetForBeat();
    } else if (beat === 1 && readyForNext()) {
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
    projectCards.innerHTML = PROJECTS.map((name) => {
      const row = state.outbox.find((candidate) => candidate.payload === name);
      const status = row?.receipt ? "● receipt" : row ? "○ queued" : "○ idle";
      const fields = activeAct === 2
        ? `<div class="project-fields">${FIELD_NAMES.map((fieldName) => {
          const field = state.fields.find((candidate) => candidate.name === fieldName);
          return `<span class="project-field-chip ${field?.status ?? "clean"}">${fieldName}</span>`;
        }).join("")}</div>`
        : "";
      return `<div class="project-card"><strong>${name}</strong><span class="project-state">${status}</span>${fields}</div>`;
    }).join("");
  }

  function renderOutbox(): void {
    outboxCount.textContent = `${state.outbox.length} rows`;
    outboxList.innerHTML = state.outbox.map((row) => {
      const receipt = row.receipt ? `<span class="receipt">● ${row.receipt}</span>` : `<span class="receipt empty">○ empty</span>`;
      const recovered = row.status === "recovered" ? `<span class="recovered">✓ recovered</span>` : "";
      const key = state.act === 3 || state.act === 6 ? `<span class="key-tag">${row.syncKey}</span>` : "";
      return `<li class="outbox-row"><span class="row-id">#${row.id}</span><div><p class="row-title">${row.payload}</p><div class="row-meta">${key}${receipt}${recovered}</div></div></li>`;
    }).join("");
  }

  function renderRemote(): void {
    if (activeAct === 4) {
      remoteCount.textContent = "1 page";
      remoteList.innerHTML = state.sections.map((section) => `<li class="remote-row section-row"><span class="row-id">${section.id}</span><p class="row-title">▤ ${section.heading}</p><span class="section-marker">${section.markersIntact ? "<!-- start/end -->" : "markers corrupted"}</span><p>${section.content}</p></li>`).join("");
      return;
    }
    remoteCount.textContent = `${state.remote.length} pages`;
    if (state.remote.length === 0) {
      remoteList.innerHTML = `<li class="empty-remote">▤ no pages yet</li>`;
      return;
    }
    const duplicates = duplicateRemoteIds(state);
    remoteList.innerHTML = state.remote.map((row) => {
      const duplicate = duplicates.has(row.id);
      const key = activeAct === 3 || activeAct === 6 ? `<span class="key-slot">key slot: ${row.syncKey}</span>` : "";
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

  function renderSpecialPanels(): void {
    specialLocal.replaceChildren();
    specialRemote.replaceChildren();
    if (activeAct === 2) {
      specialLocal.innerHTML = `<div class="writer-grid"><div class="writer-lane" data-writer="control-tower" draggable="false"><strong>control-tower</strong><span class="writer-badge local-badge">owns Queue + Review Date</span></div><div class="writer-lane" data-writer="signal-sync" draggable="false"><strong>signal-sync</strong><span class="writer-badge remote-badge">owns Freshness</span></div><div class="writer-lane manual-lane" data-writer="manual" draggable="false"><strong>manual</strong><span class="writer-badge">✍ Notes</span></div></div><p class="drag-hint">drag a field chip to move ownership</p>${state.fields.map((field) => `<div class="field-chip" draggable="true" data-field="${field.name}"><strong>${field.name}</strong><span>${field.owner}</span></div>`).join("")}`;
      specialRemote.innerHTML = `<div class="remote-field-groups"><strong>REMOTE fields</strong>${PROJECTS.map((project) => `<div class="remote-field-group"><b>${project}</b>${state.fields.map((field) => `<span class="field-line ${field.status}"><span>${field.name}</span><span>${field.remote}</span><em>${field.status}</em></span>`).join("")}</div>`).join("")}</div>`;
      specialLocal.querySelectorAll<HTMLElement>(".field-chip").forEach((chip) => {
        chip.addEventListener("dragstart", () => { draggedField = chip.dataset.field as FieldName; });
      });
      specialLocal.querySelectorAll<HTMLElement>(".writer-lane").forEach((lane) => {
        lane.addEventListener("dragover", (dragEvent) => dragEvent.preventDefault());
        lane.addEventListener("drop", (dropEvent) => {
          dropEvent.preventDefault();
          const owner = lane.dataset.writer;
          if (draggedField && (owner === "control-tower" || owner === "signal-sync")) state = moveFieldOwnership(state, draggedField, owner);
          draggedField = undefined;
          render();
        });
      });
    }
    if (activeAct === 4) {
      const ladder = ["no-op", "swap", "replace", "insert", "read-back"];
      specialRemote.innerHTML = `<div class="ladder"><strong>fallback ladder</strong>${ladder.map((rung, index) => `<div class="ladder-rung ${state.ladder.active === index + 1 ? "active" : ""} ${state.ladder.resolved === index + 1 ? "resolved" : ""} ${state.ladder.failed.includes(index + 1) ? "failed" : ""}"><span>${index + 1}</span>${rung}</div>`).join("")}</div>`;
    }
    if (activeAct === 5) {
      specialLocal.innerHTML = `<p class="hand-edit-hint">hand-edit any REMOTE field; Notes is unowned</p>`;
      specialRemote.innerHTML = `<div class="field-table editable-fields"><strong>REMOTE fields · click to hand-edit</strong>${state.fields.map((field) => `<button class="field-line ${field.status}" type="button" data-edit-field="${field.name}"><span>${field.name}</span><span>${field.remote}</span><em>${field.owner === "manual" ? "unowned" : field.status}</em></button>`).join("")}</div><div class="dry-status">${state.dryRun.complete ? `${state.dryRun.clean} clean · ${state.dryRun.drifted.length} drift${state.dryRun.failures ? " · 1 read failed" : ""}` : "dry run not started"}</div>`;
      specialRemote.querySelectorAll<HTMLButtonElement>("[data-edit-field]").forEach((button) => button.addEventListener("click", () => { state = handEditField(state, button.dataset.editField as FieldName); render(); }));
    }
    if (activeAct === 6) {
      const duplicates = duplicateCount(state);
      specialLocal.innerHTML = `<div class="hud"><strong>HUD</strong><span>pages: ${state.pagesCreated}</span><span>duplicates: ${duplicates}</span><span>recovered: ${state.recovered}</span><span>drift: ${state.driftCount}</span><span>unrouted: ${state.unrouted}</span></div>${state.unrouted ? `<p class="purgatory">unrouted, retrying forever, nagging you</p>` : ""}`;
      specialRemote.innerHTML = `<p class="rename-note">${state.toggles.renameRemote ? "key-carrying rows still route" : "key routing is ready"}</p>`;
    }
  }

  function renderToggles(): void {
    const controls: string[] = [];
    if (activeAct === 1 || activeAct === 3) controls.push(`<button class="toggle" type="button" data-toggle="drop" aria-pressed="${state.toggles.dropOneAck}">✕ drop one ack</button>`);
    if (activeAct === 3) {
      controls.push(`<button class="toggle" type="button" data-toggle="duplicate" aria-pressed="${state.toggles.duplicateDelivery}">↯ duplicate delivery</button>`);
      const canKill = state.operations.some((operation) => operation.stage === "sendAck" || operation.stage === "ackArrived");
      controls.push(`<button class="toggle kill" type="button" data-toggle="kill" ${canKill ? "" : "disabled"}>✕ kill process mid-write</button>`);
    }
    if (activeAct === 4) {
      controls.push(`<button class="toggle" type="button" data-toggle="markers" aria-pressed="${state.toggles.markersCorrupted}">markers corrupted</button>`);
      controls.push(`<button class="toggle" type="button" data-toggle="firewall" aria-pressed="${state.toggles.firewallBlocks}">firewall blocks the patch</button>`);
      controls.push(`<button class="toggle" type="button" data-toggle="transport" aria-pressed="${state.toggles.transportError}">transport error</button>`);
    }
    if (activeAct === 5) controls.push(`<button class="toggle" type="button" data-toggle="read" aria-pressed="${state.toggles.readFailure}">make one read fail</button>`);
    if (activeAct === 6) {
      controls.push(`<button class="toggle" type="button" data-toggle="rename" aria-pressed="${state.toggles.renameRemote}">rename remote page</button>`);
      controls.push(`<button class="toggle" type="button" data-toggle="chaos" aria-pressed="${state.toggles.chaos}">CHAOS</button>`);
      controls.push(`<label class="burst-control">event burst <input type="range" min="1" max="20" value="${state.burstSize}" data-burst /></label>`);
    }
    toggleControls.innerHTML = controls.join("");
    toggleControls.querySelectorAll<HTMLButtonElement>("button[data-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const toggle = button.dataset.toggle;
        if (toggle === "drop") state = setDropOneAck(state, !state.toggles.dropOneAck);
        if (toggle === "duplicate") state = setDuplicateDelivery(state, !state.toggles.duplicateDelivery);
        if (toggle === "kill") state = killProcess(state);
        if (toggle === "markers") state = setAct4Obstacle(state, "markersCorrupted", !state.toggles.markersCorrupted);
        if (toggle === "firewall") state = setAct4Obstacle(state, "firewallBlocks", !state.toggles.firewallBlocks);
        if (toggle === "transport") state = setAct4Obstacle(state, "transportError", !state.toggles.transportError);
        if (toggle === "read") state = setReadFailure(state, !state.toggles.readFailure);
        if (toggle === "rename") state = setAct6Toggle(state, "renameRemote", !state.toggles.renameRemote);
        if (toggle === "chaos") state = setAct6Toggle(state, "chaos", !state.toggles.chaos);
        render();
      });
    });
    const burst = toggleControls.querySelector<HTMLInputElement>("[data-burst]");
    burst?.addEventListener("input", () => { state = setBurstSize(state, Number(burst.value)); renderSpecialPanels(); });
  }

  function predictionOptions(): string[] {
    if (activeAct === 1) return ["one page", "two pages", "an error"];
    if (activeAct === 3) return ["one page", "two pages", "an error"];
    if (activeAct === 2) return ["Queue", "Freshness", "none of them"];
    if (activeAct === 4) return ["give up and alert", "try a blunter write shape", "wait and retry the same thing"];
    if (activeAct === 5) return ["everything", "the two drifted fields", "the whole page"];
    return ["duplicates", "zero", "unrouted"];
  }

  function correctPrediction(): string {
    if (activeAct === 1) return "two pages";
    if (activeAct === 3) return "one page";
    if (activeAct === 2) return "none of them";
    if (activeAct === 4) return "try a blunter write shape";
    if (activeAct === 5) return "the two drifted fields";
    return "zero";
  }

  function renderNarrative(): void {
    narrative.classList.toggle("act-three", activeAct === 3);
    const prompt = ACTS[activeAct].predictBeat;
    const copy = activeAct === 1
      ? (beat === 0 ? "works fine, ship it." : beat === 1 ? "Toggle \"drop one ack\", then run one sync pass. The write should arrive while its receipt is lost." : prompt)
      : activeAct === 3
        ? (beat === 0 ? "works fine, ship it." : beat === 1 ? "Re-run Act 1's betrayal: drop the ack, then retry the same outbox row under query-by-key rules." : prompt)
        : activeAct === 2
          ? (beat === 0 ? "Concurrency control by org chart. Conflicts aren't resolved here. They're unemployable." : beat === 1 ? "Both writers run concurrently (interleaved packets)." : prompt)
          : activeAct === 4
            ? (beat === 0 ? "The most common outcome is the boring one; say so." : prompt)
            : activeAct === 5
              ? (beat === 0 ? "hand-edit two fields, then run dry." : prompt)
              : "Rent the view. Own the truth.";
    beatCopy.textContent = copy;
    const isPredictionBeat = beat === 2;
    prediction.hidden = !isPredictionBeat;
    if (isPredictionBeat) {
      const options = predictionOptions();
      prediction.innerHTML = `<p>WHAT HAPPENS NEXT?</p><div class="prediction-options">${options.map((option) => `<button class="prediction-button" type="button" data-answer="${option}" ${selectedPrediction ? "disabled" : ""}>${option}</button>`).join("")}</div>${selectedPrediction ? `<p class="guess-note">your guess: ${selectedPrediction}</p>` : ""}`;
      prediction.querySelectorAll<HTMLButtonElement>("button").forEach((button) => button.addEventListener("click", () => choosePrediction(button.dataset.answer ?? "")));
    }
    const showReveal = isPredictionBeat && revealReady();
    reveal.hidden = !showReveal;
    if (showReveal) {
      const correct = selectedPrediction === correctPrediction();
      if (activeAct === 1) reveal.innerHTML = `<p><strong>${correct ? "✓" : "✗"} ${correct ? "Correct." : "The record says two pages."}</strong> ${duplicateCount(state) > 0 ? "⚠ duplicate remains flagged on REMOTE." : ""}</p><p>"The write succeeded. Only the <em>receipt</em> was lost. The tool couldn't tell the difference, so it lied by repetition."</p>`;
      else if (activeAct === 3) reveal.innerHTML = `<p><strong>${correct ? "✓" : "✗"} ${correct ? "Correct." : "The key check converges to one page."}</strong> The retry queried the key, found the existing page, and returned only a receipt. ✓ recovered</p><p>"You don't prevent the duplicate delivery. You make it converge."</p><p>"The receipt is the queue's proof it was drained — provenance pointing both directions."</p><p>"The real system shipped for months with rung 3 missing its key check. Here's the run that found it."</p>`;
      else if (activeAct === 2) reveal.innerHTML = `<p><strong>${correct ? "✓" : "✗"} ${correct ? "Correct." : "the owner badge decides."}</strong></p><p>"Concurrency control by org chart. Conflicts aren't resolved here. They're unemployable."</p>`;
      else if (activeAct === 4) reveal.innerHTML = `<p><strong>${correct ? "✓" : "✗"} ${correct ? "Correct." : "the ladder keeps descending."}</strong> The request wasn't wrong. It was <em>unpalatable</em>. Rung four exists because arguing with a firewall is not a strategy.</p><p>"Five ways to write one paragraph, tried politest-first. The ladder is what 'robust' actually looks like: not one perfect write, but a stack of acceptable ones."</p>`;
      else if (activeAct === 5) reveal.innerHTML = `<p><strong>${correct ? "✓" : "✗"} ${correct ? "Correct." : "the dry run names the drift."}</strong></p><p>"Run the whole thing dry and you get the most useful report infrastructure can produce: a map of everywhere the view has stopped telling the truth."</p>`;
      else reveal.innerHTML = `<p><strong>${correct ? "✓" : "✗"} ${correct ? "Correct." : "the HUD keeps the count honest."}</strong></p><p>"Rent the view. Own the truth."</p>`;
    }
    if (activeAct === 1 || activeAct === 3) {
      if (beat === 0) { nextButton.textContent = "set up a lost receipt →"; nextButton.disabled = false; }
      else if (beat === 1) { nextButton.textContent = "predict the retry →"; nextButton.disabled = !focusedFailureReady(); }
      else { nextButton.textContent = revealReady() ? "restart this act ↺" : "waiting for the reveal…"; nextButton.disabled = !revealReady(); }
    } else if (beat < 2) {
      nextButton.textContent = beat === 0 ? "set up the next beat →" : "predict →";
      nextButton.disabled = !state.specialReady;
    } else {
      nextButton.textContent = revealReady() ? "restart this act ↺" : "waiting for the reveal…";
      nextButton.disabled = !revealReady();
    }
  }

  function render(): void {
    tabs.forEach((tab, index) => tab.setAttribute("aria-selected", String(activeAct === index + 1)));
    beatLabel.textContent = `ACT ${activeAct} · BEAT ${beat + 1} OF 3`;
    ruleLabel.textContent = ACTS[activeAct].subtitle;
    renderProjects();
    renderOutbox();
    renderRemote();
    renderSpecialPanels();
    renderPackets();
    renderToggles();
    renderNarrative();
    eventLog.innerHTML = state.events.map((entry) => `<li>t${entry.tick} · ${entry.text}</li>`).join("") || "<li>ready: choose a sync pass</li>";
    const inFlight = !isIdle(state);
    const dryBlocked = activeAct === 5 && state.dryRun.complete && state.dryRun.failures > 0;
    syncButton.textContent = activeAct === 5 ? (state.dryRun.complete ? "▶ live run" : "▶ dry run") : activeAct === 2 ? "▶ run both writers" : activeAct === 4 ? "▶ run fallback ladder" : activeAct === 6 ? "▶ run burst" : "▶ run one sync pass";
    againButton.textContent = activeAct === 5 ? "⟳ dry run again" : "⟳ run again";
    syncButton.disabled = inFlight || dryBlocked || (beat === 2 && Boolean(selectedPrediction));
    againButton.disabled = inFlight || (beat === 2 && Boolean(selectedPrediction));
  }

  tabs.forEach((tab, index) => tab.addEventListener("click", () => setAct((index + 1) as ActId)));
  syncButton.addEventListener("click", () => { state = beginSync(state); render(); });
  againButton.addEventListener("click", () => { state = beginSync(state); render(); });
  resetButton.addEventListener("click", () => { state = createInitialState(activeAct); beat = 0; selectedPrediction = undefined; clearWire(); render(); });
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
