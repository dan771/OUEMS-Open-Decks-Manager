import {
  instancePeriod,
  planningSlots,
  slotPeriod,
  preferredPeriods,
} from "./domain.js";

const copy = (value) => structuredClone(value ?? null);
export const equal = (a, b) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
// A queued move may materialise previously empty timeline slots. Both clients
// and the server need the same IDs so later queued moves can guard that layout.
// Authenticated user IDs scope operation identifiers across different editors.
export const setIds = (userId, operationId) => {
  let sequence = 0;
  return () => `set-${userId}-${operationId}-${sequence++}`;
};
const placement = (term, card) =>
  card
    ? {
        id: card.id,
        profileId: card.profileId,
        nightId: card.nightId,
        slot: card.slot ?? null,
        period: card.nightId ? instancePeriod(term, card) : null,
      }
    : null;
const schedule = (night) =>
  night
    ? {
        id: night.id,
        date: night.date,
        start: night.start,
        end: night.end,
        setLength: night.setLength,
        splitTime: night.splitTime ?? null,
        layout:
          night.plan?.map((set) => ({ id: set.id, duration: set.duration })) ??
          null,
      }
    : null;
const members = (term, nightId) =>
  term.instances
    .filter((i) => i.nightId === nightId)
    .map((i) => placement(term, i))
    .sort((a, b) => a.id.localeCompare(b.id));
const defaultPeriod = (term, card, night) => {
  const periods = preferredPeriods(
    term.profiles.find((p) => p.id === card?.profileId),
    night,
  );
  return periods?.length === 1 ? periods[0] : "early";
};

// The server derives the same read set from the command. Unrelated fields are
// deliberately excluded; every value a scheduling command depends on is included.
export function actionBasis(state, action) {
  const term = state.terms.find((t) => t.id === action.termId);
  const base = { epoch: state.epoch || 0, termId: term?.id ?? null };
  if (!term) return base;
  const profile = term.profiles.find((p) => p.id === action.profileId);
  const card = term.instances.find((i) => i.id === action.instanceId);
  const night = term.nights.find((n) => n.id === action.nightId);
  switch (action.type) {
    case "edit": {
      base.profileId = profile?.id ?? null;
      base.fields = {};
      for (const key of Object.keys(action.fields || {})) {
        if (key === "availability") {
          base.fields.availability = {};
          for (const [date, values] of Object.entries(
            action.fields.availability || {},
          )) {
            base.fields.availability[date] = Object.fromEntries(
              Object.keys(values).map((key) => [
                key,
                copy(profile?.availability?.[date]?.[key]),
              ]),
            );
          }
        } else base.fields[key] = copy(profile?.[key]);
      }
      base.answers = Object.fromEntries(
        Object.keys(action.answers || {}).map((index) => [
          index,
          copy(profile?.transcript?.[index]),
        ]),
      );
      if (action.transcript) base.transcript = copy(profile?.transcript);
      break;
    }
    case "comment":
      base.profileId = profile?.id ?? null;
      break;
    case "duplicate":
      base.source = card ? { id: card.id, profileId: card.profileId } : null;
      break;
    case "confirm":
      base.card = card
        ? { id: card.id, nightId: card.nightId, confirmed: !!card.confirmed }
        : null;
      break;
    case "move": {
      base.card = placement(term, card);
      const source = term.nights.find((n) => n.id === card?.nightId);
      base.source = schedule(source);
      base.target = schedule(night);
      if (night && card && action.period == null && action.slot == null)
        base.defaultPeriod = defaultPeriod(term, card, night);
      let slot = action.slot == null ? null : Number(action.slot);
      if (night?.plan?.length && slot === null && action.period) {
        const slots = planningSlots(night);
        const vacancy = slots.findIndex(
          (s, index) =>
            slotPeriod(night, s) === action.period &&
            !night.plan[index]?.instanceIds.length &&
            s.end - s.start >= 10,
        );
        if (vacancy >= 0) slot = vacancy;
      }
      base.slot = slot;
      base.sourceSet = copy(
        source?.plan?.find((s) => s.instanceIds.includes(card?.id)),
      );
      base.targetSet = copy(slot === null ? null : night?.plan?.[slot]);
      base.occupants =
        slot === null
          ? []
          : term.instances
              .filter(
                (i) =>
                  i.id !== card?.id &&
                  i.nightId === night?.id &&
                  i.slot === slot,
              )
              .map((i) => placement(term, i))
              .sort((a, b) => a.id.localeCompare(b.id));
      break;
    }
    case "configure":
    case "plan":
    case "clear-plan":
      base.night = copy(night);
      base.members = members(term, action.nightId);
      break;
    case "add-night":
      base.date = term.nights.find((n) => n.date === action.date)?.id ?? null;
      break;
    case "add":
      base.nightId = action.nightId ? (night?.id ?? null) : null;
      break;
    case "revert": {
      const { comments, ...fields } = profile || {};
      base.profile = copy(fields);
      break;
    }
    case "delete-board":
    case "delete-night": {
      base.version = state.version;
      if (action.type === "delete-night") base.nightId = night?.id ?? null;
      break;
    }
    default:
      base.version = state.version;
  }
  return base;
}

// Convert an editor form into a patch relative to the form that was opened,
// including individual availability values and transcript answers.
export function prepareAction(snapshot, input) {
  const action = structuredClone(input);
  if (
    action.type === "move" &&
    action.nightId &&
    action.slot == null &&
    action.period == null
  ) {
    const term = snapshot.terms.find((t) => t.id === action.termId);
    const night = term?.nights.find((n) => n.id === action.nightId);
    const card = term?.instances.find((i) => i.id === action.instanceId);
    // Freeze a default drop's intended half when the organiser makes it. A later
    // availability edit must not redirect a queued card into a different half.
    if (night && card) action.period = defaultPeriod(term, card, night);
  }
  if (action.type === "edit") {
    const profile = snapshot.terms
      .find((t) => t.id === action.termId)
      ?.profiles.find((p) => p.id === action.profileId);
    const fields = {};
    for (const [key, value] of Object.entries(action.fields || {})) {
      if (key === "availability") {
        const dates = {};
        for (const [date, preferences] of Object.entries(value)) {
          const changes = Object.fromEntries(
            Object.entries(preferences).filter(
              ([key, value]) =>
                !equal(value, profile?.availability?.[date]?.[key]),
            ),
          );
          if (Object.keys(changes).length) dates[date] = changes;
        }
        if (Object.keys(dates).length) fields.availability = dates;
      } else if (!equal(value, profile?.[key] ?? "")) fields[key] = value;
    }
    action.fields = fields;
    action.answers = Object.fromEntries(
      (action.transcript || []).flatMap((answer, index) =>
        equal(answer.answer, profile?.transcript?.[index]?.answer)
          ? []
          : [[index, answer.answer]],
      ),
    );
    delete action.transcript;
  }
  action.base = actionBasis(snapshot, action);
  return action;
}

export function conflictFields(expected, actual) {
  const paths = [];
  function visit(a, b, path) {
    if (equal(a, b)) return;
    if (
      a &&
      b &&
      typeof a === "object" &&
      typeof b === "object" &&
      !Array.isArray(a) &&
      !Array.isArray(b)
    ) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
        visit(a[key], b[key], path ? `${path}.${key}` : key);
    } else paths.push(path);
  }
  visit(expected, actual, "");
  return paths.slice(0, 30);
}

export function applyChanges(previous, patch) {
  const state = structuredClone(previous);
  const boards = new Map(state.terms.map((term) => [term.id, term]));
  const lists = { profile: "profiles", card: "instances", night: "nights" };
  for (const change of patch.entities.filter(
    (entry) => entry.kind === "board",
  )) {
    if (!change.data) boards.delete(change.id);
    else
      boards.set(change.id, {
        ...boards.get(change.id),
        ...change.data,
        profiles: boards.get(change.id)?.profiles || [],
        instances: boards.get(change.id)?.instances || [],
        nights: boards.get(change.id)?.nights || [],
      });
  }
  for (const change of patch.entities.filter(
    (entry) => entry.kind !== "board",
  )) {
    const board = boards.get(change.boardId),
      key = lists[change.kind];
    if (!board || !key) continue;
    const index = board[key].findIndex((entry) => entry.id === change.id);
    if (!change.data) {
      if (index >= 0) board[key].splice(index, 1);
    } else if (index >= 0) board[key][index] = change.data;
    else board[key].push(change.data);
  }
  for (const board of boards.values())
    if (board.entityOrder) {
      for (const key of Object.values(lists)) {
        const order = new Map(
          (board.entityOrder[key] || []).map((id, index) => [id, index]),
        );
        board[key].sort(
          (a, b) =>
            (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity),
        );
      }
      delete board.entityOrder;
    }
  state.terms = patch.termIds.map((id) => boards.get(id)).filter(Boolean);
  state.version = patch.version;
  state.epoch = patch.epoch;
  return state;
}
