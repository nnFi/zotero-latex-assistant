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

export function isbnIdentities(value: string | undefined): string[] {
  if (!value) return [];
  const values = new Set<string>();
  for (const candidate of [value, ...value.split(/[;,\n]/), ...value.split(/\s+/)]) {
    try { values.add(normalizeIsbn(candidate)); } catch { /* Existing library metadata may contain other text. */ }
  }
  return [...values];
}
