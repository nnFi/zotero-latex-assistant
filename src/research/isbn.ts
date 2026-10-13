/** Validate the check digit and use ISBN-13 as the edition identity. */
export function normalizeIsbn(input: string): string {
  const isbn = input.trim().replace(/^ISBN(?:-1[03])?\s*:?\s*/i, "").replace(/[\s-]/g, "").toUpperCase();
  if (/^\d{9}[\dX]$/.test(isbn)) {
    const sum = [...isbn].reduce((total, digit, index) => total + (digit === "X" ? 10 : Number(digit)) * (10 - index), 0);
    if (sum % 11 !== 0) throw new Error("Invalid ISBN-10 check digit.");
    const base = `978${isbn.slice(0, 9)}`;
    const check = (10 - [...base].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0) % 10) % 10;
    return `${base}${check}`;
  }
  if (/^97[89]\d{10}$/.test(isbn)) {
    if ([...isbn].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0) % 10 !== 0) {
      throw new Error("Invalid ISBN-13 check digit.");
    }
    return isbn;
  }
  throw new Error("Enter a valid ISBN-10 or ISBN-13.");
}

/** Parse complete lists, including adjacent ISBN-13 values, without dropping malformed parts. */
export function parseIsbnList(input: string): string[] {
  const result: string[] = [];
  for (const part of input.split(/[;,\n]/).map((value) => value.trim()).filter(Boolean)) {
    try { result.push(normalizeIsbn(part)); continue; } catch { /* Try a complete list representation. */ }
    const compact = part.replace(/^ISBN(?:-1[03])?\s*:?\s*/i, "").replace(/[\s-]/g, "");
    if (compact.length <= 130 && /^(?:97[89]\d{10}){2,}$/.test(compact)) result.push(...compact.match(/.{13}/g)!.map(normalizeIsbn));
    else {
      const tokens = part.split(/\s+/);
      if (tokens.length < 2) throw new Error("The ISBN field is not a complete valid ISBN list.");
      result.push(...tokens.map(normalizeIsbn));
    }
    if (result.length > 10) throw new Error("Supply at most ten ISBN values.");
  }
  if (!result.length || result.length > 10) throw new Error("Supply a nonempty valid ISBN list.");
  return [...new Set(result)];
}

export function isbnIdentities(value: string | undefined): string[] {
  if (!value) return [];
  const values = new Set<string>();
  for (const candidate of [value, ...value.split(/[;,\n]/), ...value.split(/\s+/)]) {
    try { values.add(normalizeIsbn(candidate)); } catch { /* Existing library metadata may contain other text. */ }
    // Zotero can expose adjacent print/e-book ISBN-13 values without a separator.
    // Accept only a complete sequence of valid ISBN-13s; never salvage arbitrary substrings.
    const compact = candidate.trim().replace(/^ISBN(?:-1[03])?\s*:?\s*/i, "").replace(/[\s-]/g, "");
    if (compact.length > 13 && compact.length <= 130 && /^(?:97[89]\d{10}){2,}$/.test(compact)) {
      try {
        const separated = compact.match(/.{13}/g)!.map(normalizeIsbn);
        separated.forEach((isbn) => values.add(isbn));
      } catch { /* A bad checksum makes the whole concatenated sequence untrusted. */ }
    }
  }
  return [...values];
}
