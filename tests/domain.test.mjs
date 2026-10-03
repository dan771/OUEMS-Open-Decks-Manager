import test from "node:test";
import assert from "node:assert/strict";
import { headers, row, sheet } from "./fixture.mjs";
import {
  parseCSV,
  discover,
  createTerm,
  importRows,
  applyAction,
  generateSlots,
  availabilityFor,
  preferredPeriods,
  periodBounds,
  instancePeriod,
  inferExperience,
  validateTerm,
  emptyState,
  normalizeProfileFields,
} from "../public/lib/domain.js";

test("CSV handles quoted commas, escaped quotes, newlines and UTF-8", () => {
  assert.deepEqual(
    parseCSV('\ufeffName,Notes\r\n"König","hi, ""friend""\nbye"\r\n'),
    [
      ["Name", "Notes"],
      ["König", 'hi, "friend"\nbye'],
    ],
  );
});
test("Oxford terms and four dates are inferred from headers without responses", () => {
  assert.equal(validateTerm("mt26"), "MT26");
  assert.throws(() => validateTerm("WT26"));
  assert.deepEqual(
    discover([headers], "MT26").dates.map((d) => d.date),
    ["2026-10-16", "2026-10-29", "2026-11-12", "2026-11-23"],
  );
  assert.equal(
    discover([["Preferred timing for 12th February"]], "HT27").dates[0].date,
    "2027-02-12",
  );
});
test("experience classification prioritises evidence of gigs and flags ambiguity", () => {
  assert.equal(inferExperience("Absolute beginner").level, "absolute beginner");
  assert.equal(inferExperience("Beginner").level, "beginner");
  assert.equal(inferExperience("4 years bedroom DJing").level, "bedroom");
  assert.equal(
    inferExperience("Intermediate - have played at Bully").level,
    "gigging",
  );
  assert.equal(inferExperience("Intermediate").review, true);
  assert.equal(
    inferExperience("Never played a gig, just bedroom").level,
    "bedroom",
  );
});
function setup() {
  const term = createTerm("MT26", "", sheet);
  const state = emptyState();
  state.terms.push(term);
  return {
    state,
    term,
    instance: term.instances[0],
    profile: term.profiles[0],
  };
}
test("final confirmations are independent per appearance and reset on reassignment", () => {
  const { state, term, instance } = setup();
  const act = (type, data = {}) =>
    applyAction(
      state,
      { termId: term.id, instanceId: instance.id, type, ...data },
      "Tester",
    );
  assert.throws(() => act("confirm", { confirmed: true }), /Assign this DJ/);
  act("move", { nightId: term.nights[0].id, period: "early", slot: null });
  assert.throws(
    () => act("confirm", { confirmed: "yes" }),
    /valid confirmation/,
  );
  act("confirm", { confirmed: true });
  act("duplicate");
  const duplicate = term.instances.at(-1);
  assert.equal(duplicate.confirmed, false);
  act("move", {
    instanceId: duplicate.id,
    nightId: term.nights[1].id,
    period: "late",
    slot: null,
  });
  act("confirm", { instanceId: duplicate.id, confirmed: true });
  act("confirm", { confirmed: false });
  assert.equal(instance.confirmed, false);
  assert.equal(duplicate.confirmed, true);
  act("confirm", { confirmed: true });
  act("plan", {
    nightId: term.nights[0].id,
    sets: [{ instanceIds: [instance.id], duration: 30 }],
  });
  assert.equal(instance.confirmed, true);
  act("move", { nightId: term.nights[1].id, period: "early", slot: null });
  assert.equal(instance.confirmed, false);
  assert.equal(duplicate.confirmed, true);
  act("move", { instanceId: duplicate.id, nightId: null, slot: null });
  assert.equal(duplicate.confirmed, false);
  assert.throws(
    () => act("confirm", { instanceId: "missing", confirmed: true }),
    /Card not found/,
  );
});
test("swapping appearances between nights clears both final confirmations", () => {
  const term = createTerm("MT26", "", [
    headers,
    row,
    ["another-response", ...row.slice(1)],
  ]);
  const state = { ...emptyState(), terms: [term] };
  const [first, second] = term.instances;
  const act = (instanceId, type, data) =>
    applyAction(
      state,
      { termId: term.id, instanceId, type, ...data },
      "Tester",
    );
  act(first.id, "move", { nightId: term.nights[0].id, slot: 0 });
  act(second.id, "move", { nightId: term.nights[1].id, slot: 0 });
  for (const card of [first, second])
    act(card.id, "confirm", { confirmed: true });
  act(first.id, "move", { nightId: term.nights[1].id, slot: 0 });
  assert.equal(first.confirmed, false);
  assert.equal(second.confirmed, false);
  assert.equal(second.nightId, term.nights[0].id);
});
test("ethnicity and gender import, survive source reordering and edits, and restore with original fields", () => {
  const demographicHeaders = [
    ...headers,
    "Ethnic background",
    "Gender identity",
    "Oxford college",
  ];
  const demographicRow = [...row, "Mixed heritage", "Non-binary", "Wadham"];
  const term = createTerm("MT26", "", [demographicHeaders, demographicRow]);
  const state = { ...emptyState(), terms: [term] };
  const profile = term.profiles[0];
  assert.equal(profile.ethnicity, "Mixed heritage");
  assert.equal(profile.gender, "Non-binary");
  assert.equal(profile.college, "Wadham");
  assert.equal(term.mapping.ethnicity, headers.length);
  assert.equal(term.mapping.gender, headers.length + 1);
  applyAction(
    state,
    {
      type: "edit",
      termId: term.id,
      profileId: profile.id,
      fields: { ethnicity: "  South Asian  ", gender: "", college: "Balliol" },
    },
    "Tester",
  );
  const newRow = [...demographicRow];
  newRow[0] = "demographics-new-response";
  const reordered = [demographicHeaders, demographicRow, newRow].map((r) =>
    [...r].reverse(),
  );
  assert.equal(importRows(term, reordered).added, 1);
  assert.equal(profile.ethnicity, "South Asian");
  assert.equal(profile.gender, "");
  assert.equal(profile.college, "Balliol");
  assert.equal(term.profiles[1].ethnicity, "Mixed heritage");
  assert.equal(term.profiles[1].gender, "Non-binary");
  assert.equal(term.profiles[1].college, "Wadham");
  applyAction(
    state,
    { type: "revert", termId: term.id, profileId: profile.id },
    "Tester",
  );
  assert.equal(profile.ethnicity, "Mixed heritage");
  assert.equal(profile.gender, "Non-binary");
  assert.equal(profile.college, "Wadham");
  applyAction(
    state,
    {
      type: "add",
      termId: term.id,
      fields: {
        name: "Manual demographics",
        ethnicity: "  White British  ",
        gender: "  Woman  ",
        college: "  St Anne's  ",
      },
    },
    "Tester",
  );
  assert.equal(term.profiles.at(-1).ethnicity, "White British");
  assert.equal(term.profiles.at(-1).original.fields.gender, "Woman");
  assert.equal(term.profiles.at(-1).college, "St Anne's");
});
test("legacy demographic answers become fields without guessing or replacing explicit blanks", () => {
  const { state, profile, term } = setup();
  delete profile.ethnicity;
  delete profile.gender;
  delete profile.college;
  delete profile.original.fields.ethnicity;
  delete profile.original.fields.gender;
  delete profile.original.fields.college;
  profile.transcript.push(
    { question: "What is your ethnicity?", answer: "Mixed heritage" },
    { question: "Your gender", answer: "Agender" },
    { question: "Which college?", answer: "Wadham" },
  );
  profile.original.transcript.push(
    { question: "What is your ethnicity?", answer: "South Asian" },
    { question: "Your gender", answer: "Non-binary" },
    { question: "Which college?", answer: "Balliol" },
  );
  normalizeProfileFields(state);
  assert.equal(profile.ethnicity, "Mixed heritage");
  assert.equal(profile.gender, "Agender");
  assert.equal(profile.college, "Wadham");
  profile.ethnicity = "";
  normalizeProfileFields(state);
  assert.equal(profile.ethnicity, "");
  applyAction(
    state,
    { type: "revert", termId: term.id, profileId: profile.id },
    "Tester",
  );
  assert.equal(profile.ethnicity, "South Asian");
  assert.equal(profile.gender, "Non-binary");
  assert.equal(profile.college, "Balliol");
  const unspecified = setup();
  delete unspecified.profile.ethnicity;
  delete unspecified.profile.gender;
  normalizeProfileFields(unspecified.state);
  assert.equal(unspecified.profile.ethnicity, "");
  assert.equal(unspecified.profile.gender, "");
});
test("mapped columns survive reordering; missing headers fail instead of importing incorrect data", () => {
  const { term } = setup();
  const newer = [...row];
  newer[0] = "9/30/2026 10:00:00";
  const reordered = [headers, row, newer].map((r) => [...r].reverse());
  assert.equal(importRows(term, reordered).added, 1);
  assert.equal(term.profiles[1].experience, "beginner");
  assert.throws(
    () => importRows(term, [headers.slice(1), row.slice(1)]),
    /mapped column/,
  );
});
test("experience column does not match the earlier availability question mentioning experience", () => {
  const { profile } = setup();
  assert.equal(profile.experience, "beginner");
  assert.equal(profile.needsReview, false);
  assert.equal(profile.name, "Night Shift");
});
test("source corrections to name and email do not create a duplicate; equal timestamps support separate responses", () => {
  const { term } = setup();
  const changed = [...row];
  changed[1] = "Correction";
  changed[2] = "Changed";
  changed[3] = "corrected@example.invalid";
  assert.equal(importRows(term, [headers, changed]).added, 0);
  assert.equal(importRows(term, [headers, changed, row]).added, 1);
  assert.equal(importRows(term, [headers, changed, row]).added, 0);
});
test("append-only import preserves edits, original transcript, comments and placement", () => {
  const { term, profile, instance } = setup();
  profile.name = "Edited";
  profile.comments.push({ text: "Keep this" });
  instance.nightId = term.nights[0].id;
  const changed = [...row];
  changed[2] = "Source changed";
  assert.equal(importRows(term, [headers, changed]).added, 0);
  assert.equal(profile.name, "Edited");
  assert.equal(profile.original.fields.name, "Night Shift");
  assert.equal(profile.comments.length, 1);
  const newer = [...row];
  newer[0] = "9/29/2026 10:00:00";
  assert.equal(importRows(term, [headers, changed, newer]).added, 1);
  assert.equal(term.instances.length, 2);
  assert.equal(instance.nightId, term.nights[0].id);
});
test("movement, explicit duplication, shared edits, comments and revert", () => {
  const { state, term, profile, instance } = setup();
  const base = { termId: term.id };
  applyAction(
    state,
    {
      ...base,
      type: "move",
      instanceId: instance.id,
      nightId: term.nights[0].id,
      slot: 0,
    },
    "Tester",
  );
  assert.equal(term.instances.length, 1);
  applyAction(
    state,
    { ...base, type: "duplicate", instanceId: instance.id },
    "Tester",
  );
  assert.equal(term.instances.length, 2);
  assert.equal(term.instances[1].profileId, profile.id);
  applyAction(
    state,
    {
      ...base,
      type: "edit",
      profileId: profile.id,
      fields: { name: "New name" },
    },
    "Tester",
  );
  applyAction(
    state,
    { ...base, type: "comment", profileId: profile.id, text: "Shared note" },
    "Tester",
  );
  applyAction(
    state,
    { ...base, type: "revert", profileId: profile.id },
    "Tester",
  );
  assert.equal(profile.name, "Night Shift");
  assert.equal(profile.comments.length, 1);
  assert.equal(instance.slot, 0);
});
test("slots cross midnight, shorter final set, validation and reconfiguration", () => {
  assert.equal(
    generateSlots({ start: "18:00", end: "00:00", setLength: 45 }).length,
    8,
  );
  assert.equal(
    generateSlots({ start: "23:00", end: "01:10", setLength: 45 }).at(-1).end,
    1510,
  );
  assert.throws(() =>
    generateSlots({ start: "18:00", end: "18:00", setLength: 0 }),
  );
  const { state, term, instance } = setup();
  instance.nightId = term.nights[0].id;
  instance.slot = 5;
  applyAction(
    state,
    {
      type: "configure",
      termId: term.id,
      nightId: instance.nightId,
      start: "18:00",
      end: "19:00",
      setLength: 30,
    },
    "Tester",
  );
  assert.equal(instance.nightId, term.nights[0].id);
  assert.equal(instance.slot, null);
});
test("availability combines selected nights with timing and permits overrides", () => {
  const { state, term, profile, instance } = setup();
  const night = term.nights[0];
  assert.equal(
    availabilityFor(profile, night, generateSlots(night)[0]),
    "available",
  );
  assert.equal(
    availabilityFor(profile, night, { start: 1260, end: 1290 }),
    "outside",
  );
  assert.equal(availabilityFor(profile, term.nights[2]), "unavailable");
  applyAction(
    state,
    {
      type: "move",
      termId: term.id,
      instanceId: instance.id,
      nightId: term.nights[2].id,
      slot: 0,
    },
    "Tester",
  );
  assert.equal(instance.nightId, term.nights[2].id);
});
test("occupied slots swap placements without losing either instance", () => {
  const { state, term, instance } = setup();
  applyAction(
    state,
    { type: "duplicate", termId: term.id, instanceId: instance.id },
    "Tester",
  );
  const second = term.instances[1];
  instance.nightId = term.nights[0].id;
  instance.slot = 0;
  second.nightId = term.nights[1].id;
  second.slot = 1;
  applyAction(
    state,
    {
      type: "move",
      termId: term.id,
      instanceId: instance.id,
      nightId: second.nightId,
      slot: 1,
    },
    "Tester",
  );
  assert.equal(second.nightId, term.nights[0].id);
  assert.equal(second.slot, 0);
});

test("selected dates combine with early, late and flexible preferences", () => {
  const { profile, term } = setup();
  const night = term.nights[0];
  for (const [timing, expected] of [
    ["prefer late", ["late"]],
    ["Second half - 10pm-12am", ["late"]],
    ["First half - 6-9pm", ["early"]],
    ["Don't mind", ["early", "late"]],
    ["Don’t mind", ["early", "late"]],
    ["early or late", ["early", "late"]],
    ["18:00-21:00", ["early"]],
    ["9pm-12am", ["late"]],
    ["8pm-10pm", ["early", "late"]],
  ]) {
    profile.availability[night.date] = { available: true, timing };
    assert.deepEqual(preferredPeriods(profile, night), expected, timing);
    for (const period of ["early", "late"])
      assert.equal(
        availabilityFor(profile, night, period),
        expected.includes(period) ? "available" : "outside",
        timing,
      );
  }
  profile.availability[night.date] = { available: false, timing: "Don't mind" };
  assert.deepEqual(preferredPeriods(profile, night), []);
  assert.equal(availabilityFor(profile, night, "early"), "unavailable");
  profile.availability[night.date].available = null;
  assert.equal(preferredPeriods(profile, night), null);
  assert.equal(availabilityFor(profile, night, "late"), "unknown");
});

test("periods cross midnight and validate a custom early/late boundary", () => {
  const night = { start: "23:00", end: "03:00", setLength: 30 };
  assert.deepEqual(periodBounds(night), {
    early: { start: 1380, end: 1500 },
    late: { start: 1500, end: 1620 },
  });
  assert.equal(periodBounds({ ...night, splitTime: "00:30" }).early.end, 1470);
  assert.throws(
    () => periodBounds({ ...night, splitTime: "22:00" }),
    /between/,
  );
});

test("legacy cards migrate into a half without losing placements; moves and adds do not duplicate", () => {
  const { state, term, instance, profile } = setup();
  const night = term.nights[0];
  instance.nightId = night.id;
  instance.slot = null;
  profile.availability[night.date] = { available: true, timing: "late" };
  assert.equal(instancePeriod(term, instance), "late");
  instance.slot = 0;
  assert.equal(instancePeriod(term, instance), "early");
  const base = { termId: term.id, nightId: night.id };
  applyAction(
    state,
    { ...base, type: "move", instanceId: instance.id, period: "late" },
    "Tester",
  );
  assert.equal(instance.period, "late");
  assert.equal(instance.slot, null);
  assert.equal(term.instances.length, 1);
  applyAction(
    state,
    { ...base, type: "configure", start: "18:00", end: "19:00", setLength: 30 },
    "Tester",
  );
  assert.equal(instancePeriod(term, instance), "late");
  applyAction(
    state,
    { ...base, type: "add", period: "early", fields: { name: "Manual" } },
    "Tester",
  );
  assert.equal(term.instances.at(-1).period, "early");
  assert.throws(
    () =>
      applyAction(
        state,
        { ...base, type: "move", instanceId: instance.id, period: "nope" },
        "Tester",
      ),
    /Early or Late/,
  );
  applyAction(
    state,
    { termId: term.id, type: "move", instanceId: instance.id, nightId: null },
    "Tester",
  );
  assert.equal(instance.period, null);
});

test("reconfiguring a set keeps its card in the same half if that exact set disappears", () => {
  const { state, term, instance } = setup();
  instance.nightId = term.nights[0].id;
  instance.slot = 8;
  assert.equal(instancePeriod(term, instance), "late");
  applyAction(
    state,
    {
      type: "configure",
      termId: term.id,
      nightId: instance.nightId,
      start: "18:00",
      end: "22:00",
      setLength: 45,
    },
    "Tester",
  );
  assert.equal(instance.slot, null);
  assert.equal(instance.period, "late");
});

test("editing availability on a legacy queued card keeps its inferred placement", () => {
  const { state, term, instance, profile } = setup();
  const night = term.nights[0];
  instance.nightId = night.id;
  profile.availability[night.date] = { available: true, timing: "late" };
  applyAction(
    state,
    {
      type: "edit",
      termId: term.id,
      profileId: profile.id,
      fields: {
        availability: {
          ...profile.availability,
          [night.date]: { available: true, timing: "early" },
        },
      },
    },
    "Tester",
  );
  assert.equal(instance.period, "late");
  assert.equal(availabilityFor(profile, night, instance.period), "outside");
});

test("set plans validate membership, support B2B, ordering and a manual closing hour across midnight", () => {
  const { state, term, instance } = setup();
  const night = term.nights[0];
  instance.nightId = night.id;
  for (const name of ["Partner", "Closer"])
    applyAction(state, {
      type: "add",
      termId: term.id,
      nightId: night.id,
      fields: { name },
    });
  const [first, partner, closer] = term.instances;
  applyAction(state, {
    type: "configure",
    termId: term.id,
    nightId: night.id,
    venue: "The Bullingdon",
    start: "23:00",
    end: "02:00",
    setLength: 30,
    autoTime: true,
  });
  assert.equal(night.plan.length, 3);
  assert.equal(night.venue, "The Bullingdon");
  const sets = [
    { instanceIds: [partner.id, first.id], duration: 120 },
    { instanceIds: [closer.id], duration: 60 },
  ];
  applyAction(state, {
    type: "plan",
    termId: term.id,
    nightId: night.id,
    sets,
  });
  assert.deepEqual(generateSlots(night), [
    { start: 1380, end: 1500 },
    { start: 1500, end: 1560 },
  ]);
  assert.equal(first.slot, 0);
  assert.equal(partner.slot, 0);
  assert.equal(closer.slot, 1);
  assert.equal(instancePeriod(term, closer), "late");
  assert.throws(
    () =>
      applyAction(state, {
        type: "plan",
        termId: term.id,
        nightId: night.id,
        sets: [{ instanceIds: [first.id], duration: 30 }],
      }),
    /every DJ/,
  );
  assert.throws(
    () =>
      applyAction(state, {
        type: "plan",
        termId: term.id,
        nightId: night.id,
        sets: [
          { instanceIds: [first.id, partner.id], duration: 200 },
          { instanceIds: [closer.id], duration: 60 },
        ],
      }),
    /past/,
  );
  applyAction(state, {
    type: "move",
    termId: term.id,
    instanceId: first.id,
    nightId: null,
  });
  assert.equal(first.nightId, null);
  assert.deepEqual(night.plan[0].instanceIds, [partner.id]);
  applyAction(state, {
    type: "move",
    termId: term.id,
    instanceId: partner.id,
    nightId: null,
  });
  assert.equal(night.plan.length, 1);
  assert.equal(closer.slot, 0);
});

test("adding a named venue night preserves old placements and starts availability as unknown", () => {
  const { state, term, instance, profile } = setup();
  instance.nightId = term.nights[0].id;
  const original = instance.nightId;
  applyAction(state, {
    type: "add-night",
    termId: term.id,
    date: "2026-12-01",
    venue: "The Library",
    start: "19:00",
    end: "23:00",
    setLength: 30,
  });
  const night = term.nights.at(-1);
  assert.equal(night.venue, "The Library");
  assert.equal(instance.nightId, original);
  assert.equal(profile.availability[night.date].available, null);
  assert.throws(
    () =>
      applyAction(state, {
        type: "add-night",
        termId: term.id,
        date: "2026-12-01",
        venue: "Duplicate",
      }),
    /already exists/,
  );
});
