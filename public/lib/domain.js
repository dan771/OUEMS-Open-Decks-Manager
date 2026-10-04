export const EXPERIENCE = [
  "absolute beginner",
  "beginner",
  "bedroom",
  "gigging",
];
export const uid = () => crypto.randomUUID();
export const emptyState = () => ({ schemaVersion: 1, version: 0, terms: [] });
const copy = (value) => structuredClone(value);
const clean = (value) => String(value ?? "").trim();
export function validateTerm(code) {
  code = clean(code).toUpperCase();
  if (!/^(MT|HT|TT)\d{2}$/.test(code))
    throw new Error("Use an Oxford term such as MT26, HT27 or TT27.");
  return code;
}
export function nextTerm(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      year: "2-digit",
      month: "numeric",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return `${Number(parts.month) <= 3 ? "HT" : Number(parts.month) <= 7 ? "TT" : "MT"}${parts.year}`;
}
export function parseCSV(text) {
  text = text.replace(/^\ufeff/, "");
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (quoted || cell === "") quoted = !quoted;
      else cell += c;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("The response CSV has an unclosed quote.");
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
const months = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];
export function extractDates(text, year) {
  const out = [];
  const re =
    /(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b(?:\s+(20\d{2}))?/gi;
  for (const m of String(text).matchAll(re)) {
    const month = months.indexOf(m[2].slice(0, 3).toLowerCase());
    const y = Number(m[3] || year),
      day = Number(m[1]);
    const d = new Date(Date.UTC(y, month, day));
    if (d.getUTCDate() !== day) continue;
    const tail = String(text).slice(m.index + m[0].length);
    const week = tail.match(/^\s*\(week\s*(\d+)\)/i);
    out.push({
      date: d.toISOString().slice(0, 10),
      week: week ? Number(week[1]) : null,
    });
  }
  for (const m of String(text).matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)) {
    const d = new Date(m[1] + "T00:00:00Z");
    if (!isNaN(d) && d.toISOString().slice(0, 10) === m[1])
      out.push({ date: m[1], week: null });
  }
  return out;
}
const patterns = {
  name: /^(dj|artist|stage)\s*name/i,
  fullName: /^(full|your|real)\s*name|^name$/i,
  genres: /genre/i,
  college: /college/i,
  ethnicity: /ethnic/i,
  gender: /gender/i,
  experience: /^(?:your )?experience(?: level)?\b|^skill level/i,
  vinyl: /vinyl/i,
  availability:
    /when.*available|which.*(?:date|night)|availability|available.*(?:date|night)/i,
  timestamp: /^timestamp|submission.*(?:time|date)|submitted at/i,
  email: /^email/i,
};
export function normalizeProfileFields(state) {
  for (const term of state.terms || []) {
    for (const profile of term.profiles) {
      const original = profile.original?.fields;
      const vinylAnswer = profile.original?.transcript?.find(({ question }) =>
        term.mappingHeaders?.vinyl
          ? question === term.mappingHeaders.vinyl
          : patterns.vinyl.test(question),
      );
      if (original && vinylAnswer) {
        const vinyl = inferVinyl(vinylAnswer.answer);
        if (profile.vinyl === original.vinyl) profile.vinyl = vinyl;
        original.vinyl = vinyl;
      }
      if (!profile.vinyl || profile.vinyl === "either") profile.vinyl = "learn";
      if (original && (!original.vinyl || original.vinyl === "either"))
        original.vinyl = "learn";
      for (const key of ["college", "ethnicity", "gender"]) {
        const original = profile.original;
        if (original?.fields && !(key in original.fields)) {
          original.fields[key] = clean(
            original.transcript?.find((answer) =>
              patterns[key].test(answer.question),
            )?.answer,
          ).slice(0, 2000);
        }
        if (!(key in profile)) {
          profile[key] = clean(
            profile.transcript?.find((answer) =>
              patterns[key].test(answer.question),
            )?.answer ?? original?.fields?.[key],
          ).slice(0, 2000);
        }
      }
    }
  }
  return state;
}
export function discover(rows, code, overrides = {}) {
  const year = 2000 + Number(validateTerm(code).slice(2));
  const headers = (rows[0] || []).map(clean);
  const mapping = {};
  for (const [key, re] of Object.entries(patterns))
    mapping[key] = headers.findIndex((h) => re.test(h));
  Object.assign(mapping, overrides);
  for (const index of Object.values(mapping)) {
    if (!Number.isInteger(index) || index < -1 || index >= headers.length)
      throw new Error(
        "A mapped column is missing. Preview the response fields again.",
      );
  }
  const dates = new Map();
  for (const h of headers)
    for (const d of extractDates(h, year)) dates.set(d.date, d);
  if (mapping.availability >= 0)
    for (const row of rows.slice(1))
      for (const d of extractDates(row[mapping.availability] || "", year)) {
        const previous = dates.get(d.date);
        dates.set(d.date, {
          ...previous,
          ...d,
          week: d.week ?? previous?.week ?? null,
        });
      }
  return {
    headers,
    mapping,
    dates: [...dates.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}
export function inferExperience(value) {
  const text = clean(value).toLowerCase();
  const withoutNegation = text.replace(
    /(?:never|not|haven't|have not|no|without)\s+(?:ever\s+)?(?:played|done|had)?\s*(?:a\s+|any\s+)?(?:gigs?|clubs?|sets? out|events?)/g,
    "",
  );
  if (
    /absolute|0 experience|no experience|never (?:dj|mixed)|brand new/.test(
      text,
    )
  )
    return { level: "absolute beginner", review: false };
  if (
    /played at|playing out|played out|\bgigging\b|\bgigs?\b|\bclubs?\b|one.off sets|sets.*(?:parties|events)/.test(
      withoutNegation,
    )
  )
    return { level: "gigging", review: false };
  if (/bedroom|at home/.test(text)) return { level: "bedroom", review: false };
  if (/beginner/.test(text)) return { level: "beginner", review: false };
  return { level: "bedroom", review: true };
}
export function inferVinyl(value) {
  const text = clean(value).toLowerCase().replace(/’/g, "'");
  if (
    /\bnot interested\b|\b(?:don't|do not) want to (?:play|learn|try)\b|^digital only\b/.test(
      text,
    )
  )
    return "no";
  // Lack of experience and qualified answers express interest, not a firm yes/no.
  if (
    /\b(?:learn\w*|beginner|inexperienced|no (?:vinyl )?experience|0 experience|never|not|maybe|perhaps|possibly|probably|unsure|uncertain|but|however|although)\b|\b(?:don't|do not|haven't|have not)\b|\?/.test(
      text,
    )
  )
    return "learn";
  if (/^(?:no|nope|nah)\b/.test(text)) return "no";
  if (
    /^(?:yes|yep|yeah|absolutely|definitely)\b|\bvinyl dj\b|\bexperienced\b/.test(
      text,
    )
  )
    return "yes";
  return "learn";
}
export function timeMinutes(time) {
  if (!/^\d{2}:\d{2}$/.test(time)) throw new Error("Enter a valid time.");
  const [h, m] = time.split(":").map(Number);
  if (h > 23 || m > 59) throw new Error("Enter a valid time.");
  return h * 60 + m;
}
export const formatTime = (n) =>
  `${String(Math.floor(n / 60) % 24).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
export function generateSlots(night) {
  const start = timeMinutes(night.start);
  let end = timeMinutes(night.end);
  const length = Number(night.setLength);
  if (start === end || !Number.isInteger(length) || length < 10 || length > 240)
    throw new Error(
      "Choose different start/end times and a set length between 10 and 240 minutes.",
    );
  if (end < start) end += 1440;
  if (end - start > 16 * 60)
    throw new Error("A night can be up to 16 hours long.");
  if (night.plan?.length) {
    let cursor = start;
    return night.plan.map((set) => {
      const duration = Number(set.duration);
      if (
        !Number.isInteger(duration) ||
        duration < (set.instanceIds?.length === 0 ? 1 : 10) ||
        duration > 240
      )
        throw new Error("Each set must be between 10 and 240 minutes.");
      const slot = { start: cursor, end: cursor + duration };
      cursor += duration;
      if (cursor > end)
        throw new Error(
          "The planned sets run past the night’s end. Shorten a set or extend the night.",
        );
      return slot;
    });
  }
  const slots = [];
  for (let s = start; s < end; s += length)
    slots.push({ start: s, end: Math.min(s + length, end) });
  return slots;
}
function timingRange(text) {
  // Handles the actual form's shorthand: 6-9pm, 9pm-11pm, 10pm-12am.
  const m = clean(text).match(
    /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
  );
  if (!m) return null;
  const convert = (h, min, period) => {
    h = Number(h);
    return (
      (period ? (h % 12) + (period.toLowerCase() === "pm" ? 12 : 0) : h) * 60 +
      Number(min || 0)
    );
  };
  let start = convert(m[1], m[2], m[3] || m[6]);
  let end = convert(m[4], m[5], m[6] || m[3]);
  if (start >= end && !m[3] && /am/i.test(m[6] || ""))
    start = convert(m[1], m[2], "pm");
  if (end <= start) end += 1440;
  return { start, end };
}
export function periodBounds(night) {
  const slots = generateSlots({ ...night, plan: null });
  const start = slots[0].start,
    end = slots.at(-1).end;
  let split = Math.floor((start + end) / 2);
  if (night.splitTime) {
    split = timeMinutes(night.splitTime);
    if (split < start) split += 1440;
    if (split <= start || split >= end)
      throw new Error(
        "The Early/Late split must be between the night’s start and end times.",
      );
  }
  return { early: { start, end: split }, late: { start: split, end } };
}
export function slotPeriod(night, slot) {
  return slot.start < periodBounds(night).late.start ? "early" : "late";
}
// Include the unused end of a saved plan as drop targets, without saving it yet.
export function planningSlots(night) {
  const slots = generateSlots(night);
  if (!night.plan?.length) return slots;
  const bounds = periodBounds(night);
  for (let start = slots.at(-1).end; start < bounds.late.end;) {
    const end = Math.min(
      start + Number(night.setLength),
      start < bounds.late.start ? bounds.late.start : bounds.late.end,
    );
    slots.push({ start, end });
    start = end;
  }
  return slots;
}
export function preferredPeriods(profile, night) {
  const pref = profile.availability?.[night.date];
  if (!pref || pref.available == null) return null;
  if (!pref.available) return [];
  const text = clean(pref.timing || "").toLowerCase();
  if (
    /don['’]?t mind|do not mind|any|either|both|flexible|no preference/.test(
      text,
    )
  )
    return ["early", "late"];
  const early = /\bearly\b|first half|1st half/.test(text);
  const late = /\blate\b|second half|2nd half/.test(text);
  if (early || late) return [early && "early", late && "late"].filter(Boolean);
  const range = timingRange(text);
  if (!range) return ["early", "late"];
  const bounds = periodBounds(night);
  if (range.end <= bounds.early.start && bounds.late.end > 1440) {
    range.start += 1440;
    range.end += 1440;
  }
  return ["early", "late"].filter(
    (period) =>
      range.start < bounds[period].end && range.end > bounds[period].start,
  );
}
export function instancePeriod(term, instance) {
  const night = term.nights.find((n) => n.id === instance.nightId);
  if (!night) return null;
  const slot =
    instance.slot == null ? null : generateSlots(night)[instance.slot];
  if (slot) return slotPeriod(night, slot);
  if (["early", "late"].includes(instance.period)) return instance.period;
  // Older saved boards used a night-level queue. Keep every card and infer its half.
  const profile = term.profiles.find((p) => p.id === instance.profileId);
  const periods = preferredPeriods(profile, night);
  return periods?.length === 1 ? periods[0] : "early";
}
export function availabilityFor(profile, night, slot = null) {
  const pref = profile.availability?.[night.date];
  if (!pref || pref.available == null) return "unknown";
  if (!pref.available) return "unavailable";
  const period =
    typeof slot === "string" ? slot : slot ? slotPeriod(night, slot) : null;
  if (period && !preferredPeriods(profile, night).includes(period))
    return "outside";
  if (typeof slot === "string") return "available";
  const range = timingRange(pref.timing || "");
  if (range && slot?.start >= 1440 && range.end <= 1440) {
    range.start += 1440;
    range.end += 1440;
  }
  if (slot && range && (slot.start < range.start || slot.end > range.end))
    return "outside";
  return "available";
}
function profileFromRow(row, headers, mapping, nights, year) {
  const get = (k) => clean(row[mapping[k]]);
  const exp = inferExperience(get("experience"));
  const availability = {};
  const selected = extractDates(get("availability"), year).map((d) => d.date);
  for (const night of nights) {
    const index = headers.findIndex(
      (h) =>
        /timing|time preference|preferred time/i.test(h) &&
        extractDates(h, year).some((d) => d.date === night.date),
    );
    const timing = clean(row[index]);
    availability[night.date] = {
      available: /not applying|unavailable|can't|cannot/i.test(timing)
        ? false
        : mapping.availability >= 0
          ? selected.includes(night.date)
          : index >= 0
            ? !!timing
            : null,
      timing,
    };
  }
  const fields = {
    name: get("name") || get("fullName") || "Unnamed DJ",
    fullName: get("fullName"),
    genres: get("genres"),
    college: get("college").slice(0, 2000),
    ethnicity: get("ethnicity").slice(0, 2000),
    gender: get("gender").slice(0, 2000),
    experience: exp.level,
    needsReview: exp.review,
    vinyl: inferVinyl(get("vinyl")),
    availability,
  };
  const transcript = headers.map((question, i) => ({
    question,
    answer: clean(row[i]),
  }));
  return {
    ...fields,
    id: uid(),
    transcript,
    comments: [],
    original: { fields: copy(fields), transcript: copy(transcript) },
  };
}
export function createTerm(code, sheetUrl, rows, options = {}) {
  code = validateTerm(code);
  const detected = discover(rows, code, options.mapping);
  const dateList = options.dates?.length
    ? options.dates.map((d) =>
        typeof d === "string" ? { date: d, week: null } : d,
      )
    : detected.dates;
  if (!dateList.length)
    throw new Error(
      "No dates found. Add dates in the preview before creating this board.",
    );
  const unique = [...new Map(dateList.map((d) => [d.date, d])).values()];
  for (const d of unique) {
    const parsed = new Date(d.date + "T00:00:00Z");
    if (isNaN(parsed) || parsed.toISOString().slice(0, 10) !== d.date)
      throw new Error("Use dates in YYYY-MM-DD format.");
  }
  const term = {
    id: uid(),
    code,
    sheetUrl: clean(sheetUrl),
    mapping: detected.mapping,
    mappingHeaders: Object.fromEntries(
      Object.entries(detected.mapping).map(([key, index]) => [
        key,
        index < 0 ? null : detected.headers[index],
      ]),
    ),
    nights: unique
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({
        ...d,
        id: uid(),
        start: "18:00",
        end: "00:00",
        setLength: 30,
        venue: clean(options.venue || "Venue to be confirmed").slice(0, 100),
      })),
    profiles: [],
    instances: [],
    seen: [],
    lastImport: null,
    importError: null,
    createdAt: new Date().toISOString(),
  };
  importRows(term, rows);
  return term;
}
export function importRows(term, rows) {
  let mappingOverride = term.mapping;
  if (term.mappingHeaders) {
    const sourceHeaders = (rows[0] || []).map(clean);
    mappingOverride = Object.fromEntries(
      Object.entries(term.mappingHeaders).map(([key, header]) => {
        const index = header === null ? -1 : sourceHeaders.indexOf(header);
        if (header !== null && index < 0)
          throw new Error(
            `The mapped column “${header}” is missing. Restore the source header before importing.`,
          );
        return [key, index];
      }),
    );
  }
  const detected = discover(rows, term.code, mappingOverride);
  const { headers, mapping } = detected;
  if (rows.length > 1 && mapping.timestamp < 0)
    throw new Error(
      "Map a Timestamp column so imports can identify responses without overwriting edits.",
    );
  let added = 0;
  const seen = new Set(term.seen);
  const occurrences = new Map();
  for (const row of rows.slice(1)) {
    if (!row.some((v) => clean(v))) continue;
    const stamp = clean(row[mapping.timestamp]);
    if (!stamp) continue;
    // Timestamp + occurrence stays stable when names/email/other answers are corrected.
    // Keep the response sheet append-only; equal-timestamp rows retain their order.
    const occurrence = occurrences.get(stamp) || 0;
    occurrences.set(stamp, occurrence + 1);
    const key = JSON.stringify([stamp, occurrence]);
    if (seen.has(key)) continue;
    const profile = profileFromRow(
      row,
      headers,
      mapping,
      term.nights,
      2000 + Number(term.code.slice(2)),
    );
    term.profiles.push(profile);
    term.instances.push({
      id: uid(),
      profileId: profile.id,
      nightId: null,
      slot: null,
      confirmed: false,
    });
    seen.add(key);
    added++;
  }
  term.seen = [...seen];
  term.lastImport = new Date().toISOString();
  term.importError = null;
  return { added };
}
export function applyAction(state, action, author = "Team", createSetId = uid) {
  const term = state.terms.find((t) => t.id === action.termId);
  if (!term) throw new Error("Board not found.");
  const profile = term.profiles.find((p) => p.id === action.profileId);
  const instance = term.instances.find((i) => i.id === action.instanceId);
  if (["edit", "comment", "revert"].includes(action.type) && !profile)
    throw new Error("DJ not found.");
  if (["move", "duplicate", "confirm"].includes(action.type) && !instance)
    throw new Error("Card not found.");
  // Fix the inferred half before any edits to a legacy profile can change it.
  for (const card of term.instances)
    if (card.nightId && !["early", "late"].includes(card.period))
      card.period = instancePeriod(term, card);
  switch (action.type) {
    case "delete-board": {
      state.terms = state.terms.filter((t) => t.id !== term.id);
      break;
    }
    case "delete-night": {
      const night = term.nights.find((n) => n.id === action.nightId);
      if (!night) throw new Error("Night not found.");
      for (const card of term.instances) {
        if (card.nightId !== night.id) continue;
        Object.assign(card, { nightId: null, slot: null, confirmed: false });
        delete card.period;
      }
      term.nights = term.nights.filter((n) => n.id !== night.id);
      // Keep submitted availability so re-adding this date can recover it.
      break;
    }
    case "edit": {
      const f = action.fields || {};
      for (const key of [
        "name",
        "fullName",
        "genres",
        "college",
        "ethnicity",
        "gender",
      ])
        if (key in f) profile[key] = clean(f[key]).slice(0, 2000);
      if (!profile.name) throw new Error("DJ name is required.");
      if ("experience" in f) {
        if (!EXPERIENCE.includes(f.experience))
          throw new Error("Choose a valid experience label.");
        profile.experience = f.experience;
        profile.needsReview = false;
      }
      if ("vinyl" in f) {
        if (!["no", "yes", "learn", "either"].includes(f.vinyl))
          throw new Error("Choose a valid vinyl preference.");
        profile.vinyl = f.vinyl === "either" ? "learn" : f.vinyl;
      }
      if (f.availability)
        for (const night of term.nights) {
          const pref = f.availability[night.date];
          if (pref)
            profile.availability[night.date] = {
              available:
                "available" in pref
                  ? pref.available === null
                    ? null
                    : !!pref.available
                  : (profile.availability[night.date]?.available ?? null),
              timing:
                "timing" in pref
                  ? clean(pref.timing).slice(0, 500)
                  : profile.availability[night.date]?.timing || "",
            };
        }
      if (action.transcript) {
        if (
          !Array.isArray(action.transcript) ||
          action.transcript.length !== profile.original.transcript.length
        )
          throw new Error("Transcript fields do not match.");
        profile.transcript = action.transcript.map((a, i) => ({
          question: profile.original.transcript[i].question,
          answer: clean(a.answer).slice(0, 10000),
        }));
      }
      if (action.answers) {
        for (const [index, answer] of Object.entries(action.answers)) {
          if (
            !/^(0|[1-9][0-9]*)$/.test(index) ||
            !profile.transcript[Number(index)]
          )
            throw new Error("Transcript fields do not match.");
          profile.transcript[Number(index)].answer = clean(answer).slice(
            0,
            10000,
          );
        }
      }
      break;
    }
    case "comment": {
      const text = clean(action.text);
      if (!text || text.length > 5000)
        throw new Error("Enter a comment up to 5,000 characters.");
      profile.comments.push({
        id: uid(),
        text,
        author,
        at: new Date().toISOString(),
      });
      break;
    }
    case "revert":
      normalizeProfileFields(state);
      Object.assign(profile, copy(profile.original.fields), {
        transcript: copy(profile.original.transcript),
      });
      break;
    case "duplicate":
      term.instances.push({
        id: uid(),
        profileId: instance.profileId,
        nightId: null,
        slot: null,
        confirmed: false,
      });
      break;
    case "confirm":
      if (!term.nights.some((night) => night.id === instance.nightId))
        throw new Error("Assign this DJ to a night before confirming.");
      if (typeof action.confirmed !== "boolean")
        throw new Error("Choose a valid confirmation status.");
      instance.confirmed = action.confirmed;
      break;
    case "move": {
      const night = action.nightId
        ? term.nights.find((n) => n.id === action.nightId)
        : null;
      if (action.nightId && !night) throw new Error("Night not found.");
      if (
        night &&
        action.period != null &&
        !["early", "late"].includes(action.period)
      )
        throw new Error("Choose Early or Late.");
      let slot =
        night && action.slot !== null && action.slot !== undefined
          ? Number(action.slot)
          : null;
      if (
        slot !== null &&
        (!Number.isInteger(slot) ||
          slot < 0 ||
          slot >= planningSlots(night).length)
      )
        throw new Error("Set not found.");
      if (night?.plan?.length) {
        const slots = planningSlots(night);
        // A half-level drop can only fill a vacancy in the requested half.
        if (slot === null && action.period) {
          const vacancy = slots.findIndex(
            (s, index) =>
              slotPeriod(night, s) === action.period &&
              !night.plan[index]?.instanceIds.length &&
              s.end - s.start >= 10,
          );
          if (vacancy >= 0) slot = vacancy;
        }
        if (slot !== null) {
          for (let index = night.plan.length; index <= slot; index++) {
            const duration = slots[index].end - slots[index].start;
            if (index === slot && duration < 10)
              throw new Error(
                "This gap is too short for a set. Adjust the plan first.",
              );
            night.plan.push({ id: createSetId(), instanceIds: [], duration });
          }
        }
      }
      const occupant =
        slot === null
          ? null
          : term.instances.find(
              (i) =>
                i.id !== instance.id &&
                i.nightId === night.id &&
                i.slot === slot,
            );
      const oldNight = term.nights.find((n) => n.id === instance.nightId);
      const sourceSet = oldNight?.plan?.find((s) =>
        s.instanceIds.includes(instance.id),
      );
      const targetSet = night?.plan?.[slot];
      if (targetSet?.instanceIds.includes(instance.id)) break;
      if (sourceSet)
        sourceSet.instanceIds = sourceSet.instanceIds.filter(
          (id) => id !== instance.id,
        );
      if (targetSet) {
        if (occupant)
          targetSet.instanceIds = targetSet.instanceIds.map((id) =>
            id === occupant.id ? instance.id : id,
          );
        else targetSet.instanceIds.push(instance.id);
      }
      if (occupant && sourceSet) sourceSet.instanceIds.push(occupant.id);
      for (const set of [sourceSet, targetSet].filter(Boolean)) {
        const profiles = set.instanceIds.map(
          (id) => term.instances.find((i) => i.id === id)?.profileId,
        );
        if (new Set(profiles).size !== profiles.length)
          throw new Error("Choose two different DJs for a B2B.");
      }
      if (occupant)
        Object.assign(occupant, {
          confirmed:
            !!instance.nightId &&
            occupant.nightId === instance.nightId &&
            occupant.confirmed === true,
          period: instancePeriod(term, instance),
          nightId: instance.nightId,
          slot: instance.slot,
        });
      const periods = night
        ? preferredPeriods(
            term.profiles.find((p) => p.id === instance.profileId),
            night,
          )
        : null;
      const period = !night
        ? null
        : slot !== null
          ? slotPeriod(night, generateSlots(night)[slot])
          : action.period || (periods?.length === 1 ? periods[0] : "early");
      Object.assign(instance, {
        confirmed:
          !!night &&
          instance.nightId === night.id &&
          instance.confirmed === true,
        nightId: night?.id ?? null,
        slot,
        period,
      });
      for (const n of new Set([oldNight, night].filter(Boolean))) {
        if (n.plan) {
          syncPlan(term, n);
        }
      }
      break;
    }
    case "configure": {
      const night = term.nights.find((n) => n.id === action.nightId);
      if (!night) throw new Error("Night not found.");
      const old = generateSlots(night);
      const next = {
        ...night,
        start: action.start,
        end: action.end,
        setLength: Number(action.setLength),
        venue:
          action.venue === undefined
            ? night.venue || "Venue to be confirmed"
            : clean(action.venue).slice(0, 100),
        splitTime:
          action.splitTime === undefined
            ? night.splitTime || null
            : action.splitTime || null,
      };
      if (!next.venue) throw new Error("Enter a venue name.");
      if (action.autoTime === true || action.autoTime === "true") {
        next.plan = automaticPlan(term, next, next.setLength);
        generateSlots(next);
        periodBounds(next);
        Object.assign(night, next);
        syncPlan(term, night);
        break;
      }
      if (next.plan?.length) {
        generateSlots(next);
        periodBounds(next);
        Object.assign(night, next);
        syncPlan(term, night);
        break;
      }
      const slots = generateSlots(next);
      periodBounds(next);
      for (const card of term.instances.filter((i) => i.nightId === night.id)) {
        card.period = instancePeriod(term, card);
        if (card.slot == null) continue;
        const before = old[card.slot];
        const match = before
          ? slots.findIndex(
              (s) => s.start === before.start && s.end === before.end,
            )
          : -1;
        card.slot = match >= 0 ? match : null;
        if (match >= 0) card.period = slotPeriod(next, slots[match]);
      }
      Object.assign(night, next);
      break;
    }
    case "plan": {
      const night = term.nights.find((n) => n.id === action.nightId);
      if (!night) throw new Error("Night not found.");
      validatePlan(term, night, action.sets);
      night.plan = action.sets.map((s) => ({
        id: uid(),
        instanceIds: [...s.instanceIds],
        duration: Number(s.duration),
      }));
      syncPlan(term, night);
      break;
    }
    case "clear-plan": {
      const night = term.nights.find((n) => n.id === action.nightId);
      if (!night) throw new Error("Night not found.");
      for (const card of term.instances.filter((i) => i.nightId === night.id)) {
        card.period = instancePeriod(term, card);
        card.slot = null;
      }
      delete night.plan;
      break;
    }
    case "add-night": {
      const date = clean(action.date);
      const parsed = new Date(date + "T00:00:00Z");
      if (isNaN(parsed) || parsed.toISOString().slice(0, 10) !== date)
        throw new Error("Use a valid night date.");
      if (term.nights.some((n) => n.date === date))
        throw new Error("A night already exists for this date.");
      const venue = clean(action.venue).slice(0, 100);
      if (!venue) throw new Error("Enter a venue name.");
      const night = {
        id: uid(),
        date,
        venue,
        start: action.start || "18:00",
        end: action.end || "00:00",
        setLength: Number(action.setLength || 30),
      };
      generateSlots(night);
      term.nights.push(night);
      term.nights.sort((a, b) => a.date.localeCompare(b.date));
      for (const p of term.profiles)
        p.availability[date] ||= { available: null, timing: "" };
      break;
    }
    case "add": {
      const fields = action.fields || {};
      const name = clean(fields.name);
      if (!name) throw new Error("DJ name is required.");
      const initial = {
        name,
        fullName: clean(fields.fullName),
        genres: clean(fields.genres),
        college: clean(fields.college).slice(0, 2000),
        ethnicity: clean(fields.ethnicity).slice(0, 2000),
        gender: clean(fields.gender).slice(0, 2000),
        experience: EXPERIENCE.includes(fields.experience)
          ? fields.experience
          : "beginner",
        needsReview: false,
        vinyl: ["yes", "no", "learn", "either"].includes(fields.vinyl)
          ? fields.vinyl === "either"
            ? "learn"
            : fields.vinyl
          : "learn",
        availability: Object.fromEntries(
          term.nights.map((n) => [n.date, { available: null, timing: "" }]),
        ),
      };
      const p = {
        ...initial,
        id: uid(),
        comments: [],
        transcript: [{ question: "Manually added by", answer: author }],
        original: {
          fields: copy(initial),
          transcript: [{ question: "Manually added by", answer: author }],
        },
      };
      if (action.nightId && !term.nights.some((n) => n.id === action.nightId))
        throw new Error("Night not found.");
      if (
        action.nightId &&
        action.period != null &&
        !["early", "late"].includes(action.period)
      )
        throw new Error("Choose Early or Late.");
      term.profiles.push(p);
      term.instances.push({
        id: uid(),
        profileId: p.id,
        nightId: action.nightId || null,
        slot: null,
        confirmed: false,
        period: action.nightId ? action.period || "early" : null,
      });
      break;
    }
    default:
      throw new Error("Unknown action.");
  }
  return state;
}

export function automaticPlan(term, night, duration = null) {
  const setDuration = Number(duration ?? night.setLength);
  if (!Number.isInteger(setDuration) || setDuration < 10 || setDuration > 240)
    throw new Error("Choose a set length between 10 and 240 minutes.");
  const bounds = periodBounds(night);
  const cards = term.instances.filter((i) => i.nightId === night.id);
  const used = new Set();
  const result = (night.plan || []).map((s) => ({
    ...s,
    duration:
      duration !== null && s.instanceIds.length
        ? setDuration
        : Number(s.duration),
    instanceIds: [...s.instanceIds],
  }));
  for (const set of result) for (const id of set.instanceIds) used.add(id);
  const rest = cards
    .filter((i) => !used.has(i.id))
    .sort((a, b) => {
      const rank = (i) =>
        (instancePeriod(term, i) === "late" ? 1000 : 0) + (i.slot ?? 500);
      return rank(a) - rank(b);
    });
  for (const card of rest) {
    const period = instancePeriod(term, card);
    let start = timeMinutes(night.start);
    const slots = result.map((set) => {
      const slot = { start, end: start + Number(set.duration) };
      start = slot.end;
      return slot;
    });
    const vacancy = result.findIndex(
      (set, index) =>
        !set.instanceIds.length &&
        set.duration >= 10 &&
        (slots[index].start < bounds.late.start ? "early" : "late") === period,
    );
    if (vacancy >= 0) {
      result[vacancy].instanceIds.push(card.id);
      continue;
    }
    const cursor = slots.at(-1)?.end ?? timeMinutes(night.start);
    const gap = bounds.late.start - cursor;
    if (period === "late" && gap > 0) {
      // Preserve the unfilled Early half when timing Late DJs.
      let remaining = gap;
      while (remaining > 0) {
        const length = Math.min(setDuration, remaining);
        result.push({ id: uid(), instanceIds: [], duration: length });
        remaining -= length;
      }
    }
    result.push({
      id: uid(),
      instanceIds: [card.id],
      duration: setDuration,
    });
  }
  return result;
}
export function validatePlan(term, night, sets) {
  if (!Array.isArray(sets) || sets.length > 96)
    throw new Error("Invalid set plan.");
  const assigned = term.instances.filter((i) => i.nightId === night.id);
  const used = new Set();
  for (const set of sets) {
    if (!Array.isArray(set.instanceIds) || set.instanceIds.length > 2)
      throw new Error("A set can be empty, or have one DJ or two for B2B.");
    const profiles = new Set();
    for (const id of set.instanceIds) {
      const card = assigned.find((i) => i.id === id);
      if (!card || used.has(id))
        throw new Error(
          "Each assigned card must appear exactly once in the plan.",
        );
      if (profiles.has(card.profileId))
        throw new Error("Choose two different DJs for a B2B.");
      used.add(id);
      profiles.add(card.profileId);
    }
  }
  if (used.size !== assigned.length)
    throw new Error("Include every DJ assigned to this night.");
  generateSlots({ ...night, plan: sets });
}
function syncPlan(term, night) {
  if (!night.plan?.length) return;
  const slots = generateSlots(night);
  night.plan.forEach((set, index) => {
    for (const id of set.instanceIds) {
      const card = term.instances.find((i) => i.id === id);
      if (card)
        Object.assign(card, {
          nightId: night.id,
          slot: index,
          period: slotPeriod(night, slots[index]),
        });
    }
  });
}
