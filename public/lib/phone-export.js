export function nightPhoneNumbers(term, nightId) {
  const assigned = new Set(
    term.instances.filter((i) => i.nightId === nightId).map((i) => i.profileId),
  );
  const numbers = new Map();
  let missing = 0;
  for (const profile of term.profiles) {
    if (!assigned.has(profile.id)) continue;
    let found = false;
    // Use edited answers, so removed numbers never return from the original response.
    for (const { question, answer } of profile.transcript || []) {
      if (
        !/\b(?:phone|telephone|tel|mobile|whatsapp)\b|\bcontact\s+(?:number|no\.?)/i.test(
          question,
        )
      )
        continue;
      for (const match of String(answer ?? "").matchAll(
        /(?:\+|00)?\d[\d () .-]*\d/g,
      )) {
        const number = match[0].trim();
        const digits = number.replace(/\D/g, "");
        if (digits.length < 7 || digits.length > 15) continue;
        found = true;
        // Deduplicate UK national and international spellings.
        const key = digits.replace(/^00/, "").replace(/^440/, "44");
        const canonical = key.startsWith("0") ? "44" + key.slice(1) : key;
        if (!numbers.has(canonical)) numbers.set(canonical, number);
      }
    }
    if (!found) missing++;
  }
  return { numbers: [...numbers.values()], missing, assigned: assigned.size };
}
