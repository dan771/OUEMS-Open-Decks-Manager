import { createTerm, applyAction, emptyState } from "../public/lib/domain.js";
export const demoHeaders = [
  "Timestamp",
  "Full name",
  "DJ name (if applicable)",
  "Email",
  "When are you available to play? (regardless of experience)",
  "Preferred timing for Friday 16th Oct",
  "Preferred timing for Thursday 29th Oct",
  "Preferred timing for Thursday 12th Nov",
  "Preferred timing for Monday 23rd Nov",
  "Some genre(s) you like to play",
  "Experience level",
  "Would you be interested in playing vinyl?",
  "Anything else?",
];
const dates = [
  "Friday 16th Oct (week 1)",
  "Thursday 29th Oct (week 3)",
  "Thursday 12th Nov (week 5)",
  "Monday 23rd Nov (week 7)",
];
export const demoRows = [
  demoHeaders,
  ...[
    ["Night Shift", "UK garage, breaks", "Beginner", "No", [0, 1, 2, 3]],
    [
      "Moss",
      "Dub techno, ambient",
      "Absolute beginner",
      "Would like to learn but have 0 experience",
      [0, 2],
    ],
    ["LO-FREQ", "Jungle, drum & bass", "Bedroom DJ", "Yes", [0, 1, 3]],
    ["Orbit", "House, disco", "Have played at clubs", "Yes", [1, 2, 3]],
    ["Signal / Noise", "Electro, acid", "Intermediate", "No", [0, 1, 2]],
    [
      "Velvet FM",
      "Soulful house, garage",
      "Beginner",
      "Yes although I have no experience",
      [0, 3],
    ],
    ["After Hours", "Minimal, deep house", "Bedroom DJ", "No", [1, 2]],
    [
      "Patchwork",
      "Breakbeat, UK funky",
      "Have played at events",
      "Yes",
      [0, 1, 2, 3],
    ],
    ["Blue Hour", "Trance, progressive", "Beginner", "No", [2, 3]],
    [
      "Static Bloom",
      "Techno, leftfield",
      "Absolute beginner",
      "Would like to learn",
      [0, 1],
    ],
    ["Daylight", "Disco, house", "Bedroom DJ", "No", [1, 3]],
    ["Echo Chamber", "Dubstep, bass", "Gigging", "Yes", [2, 3]],
  ].map(([name, genres, exp, vinyl, available], i) => [
    `2026-09-28 10:${String(i).padStart(2, "0")}:00`,
    `Demo DJ ${i + 1}`,
    name,
    `dj${i + 1}@example.invalid`,
    available.map((d) => dates[d]).join(", "),
    ...dates.map((d, n) =>
      available.includes(n)
        ? i === 0 && n === 0
          ? "First half - 6-9pm"
          : "Don't mind"
        : "Not applying",
    ),
    genres,
    exp,
    vinyl,
    "Synthetic demo response. Try editing, duplicating and scheduling this DJ.",
  ]),
];
export function demoState() {
  const state = emptyState();
  const term = createTerm("MT26", "", demoRows);
  term.demo = true;
  state.terms.push(term);
  for (const [index, night, slot] of [
    [2, 0, 0],
    [3, 1, 0],
    [7, 2, 0],
    [11, 3, 0],
  ])
    applyAction(state, {
      type: "move",
      termId: term.id,
      instanceId: term.instances[index].id,
      nightId: term.nights[night].id,
      slot,
    });
  applyAction(
    state,
    {
      type: "comment",
      termId: term.id,
      profileId: term.profiles[0].id,
      text: "First Open Decks! Pair with someone experienced for a quick soundcheck.",
    },
    "OUEMS demo",
  );
  return state;
}
