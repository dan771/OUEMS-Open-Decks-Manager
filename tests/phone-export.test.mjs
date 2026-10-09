import test from "node:test";
import assert from "node:assert/strict";
import { nightPhoneNumbers } from "../public/lib/phone-export.js";

const profile = (id, answer, question = "Phone number") => ({
  id,
  transcript: [{ question, answer }],
});

test("night phone export includes both halves and B2B partners once, excluding other nights and unassigned DJs", () => {
  const term = {
    profiles: [
      profile("a", "07123 456789"),
      profile("b", "+44 7123 456789"),
      profile("c", "+33 6 12 34 56 78", "WhatsApp number"),
      profile("d", "07999 111222"),
      profile("e", "07888 111222"),
    ],
    instances: [
      { profileId: "a", nightId: "night", period: "early" },
      { profileId: "a", nightId: "night", period: "late" },
      { profileId: "b", nightId: "night", slot: 0 },
      { profileId: "c", nightId: "night", slot: 0 },
      { profileId: "d", nightId: "other" },
      { profileId: "e", nightId: null },
    ],
  };
  assert.deepEqual(nightPhoneNumbers(term, "night"), {
    numbers: ["07123 456789", "+33 6 12 34 56 78"],
    missing: 0,
    assigned: 3,
  });
  assert.deepEqual(nightPhoneNumbers(term, "empty"), {
    numbers: [],
    missing: 0,
    assigned: 0,
  });
});

test("export uses current contact answers, ignores non-contact digits and blanks, and preserves leading zeros", () => {
  const term = {
    profiles: [
      profile("a", "No number"),
      {
        ...profile("b", ""),
        original: {
          transcript: [{ question: "Phone number", answer: "07111 222333" }],
        },
      },
      profile("c", "12345678901", "Student number"),
      profile(
        "d",
        "07123-456789, +44 (0)7123 456789; 0044 7123 456789",
        "Contact number",
      ),
      profile("e", "0123 / 12345678901234567890", "Mobile number"),
    ],
    instances: ["a", "b", "c", "d", "e"].map((profileId) => ({
      profileId,
      nightId: "night",
    })),
  };
  assert.deepEqual(nightPhoneNumbers(term, "night"), {
    numbers: ["07123-456789"],
    missing: 4,
    assigned: 5,
  });
});
