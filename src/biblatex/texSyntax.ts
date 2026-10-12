/** Hide comments and literal examples while retaining every source offset. */
export function texCode(text: string): string {
  const characters = text.split("");
  const mask = (start: number, end: number): void => {
    for (let i = start; i < end; i++) if (characters[i] !== "\n" && characters[i] !== "\r") characters[i] = " ";
  };
  for (let i = 0; i < text.length; i++) {
    const character = text[i]!;
    if (character === "%") {
      let slashes = 0;
      for (let j = i - 1; j >= 0 && text[j] === "\\"; j--) slashes++;
      if (slashes % 2 === 0) {
        let end = text.indexOf("\n", i);
        if (end < 0) end = text.length;
        mask(i, end); i = end - 1;
      }
      continue;
    }
    if (character !== "\\") continue;
    if (text[i + 1] === "\\") { i++; continue; }
    const begin = /^\\begin\s*\{(verbatim\*?|Verbatim\*?|lstlisting|minted)\}/.exec(text.slice(i));
    if (begin) {
      const close = new RegExp(`\\\\end\\s*\\{${begin[1]!.replace("*", "\\*")}\\}`).exec(text.slice(i + begin[0].length));
      if (!close) throw new Error("Unclosed literal LaTeX environment. Fix the document before continuing.");
      const end = i + begin[0].length + close.index + close[0].length;
      mask(i, end); i = end - 1; continue;
    }
    const verb = /^\\verb\*?([^\w\s])/.exec(text.slice(i));
    if (verb) {
      const end = text.indexOf(verb[1]!, i + verb[0].length);
      if (end < 0) throw new Error("Unclosed literal LaTeX command. Fix the document before continuing.");
      mask(i, end + 1); i = end;
    }
  }
  return characters.join("");
}

/** Match real commands in texCode output, excluding escaped backslashes. */
export function texCommandMatches(code: string, pattern: RegExp): RegExpMatchArray[] {
  return [...code.matchAll(pattern)].filter((match) => {
    let slashes = 0;
    for (let i = match.index! - 1; i >= 0 && code[i] === "\\"; i--) slashes++;
    return slashes % 2 === 0;
  });
}

export interface TexArgument { readonly start: number; readonly end: number; readonly content: string }
export function texArgument(code: string, start: number, open: string, close: string): TexArgument | undefined {
  while (start < code.length && /\s/.test(code[start]!)) start++;
  if (code[start] !== open) return undefined;
  let depth = 1;
  let braces = 0;
  for (let i = start + 1; i < code.length; i++) {
    if (code[i] === "\\") { i++; continue; }
    if (open !== "{") {
      if (code[i] === "{") braces++;
      if (code[i] === "}") braces--;
      if (braces) continue;
    }
    if (code[i] === open) depth++;
    if (code[i] === close && --depth === 0) return { start, end: i + 1, content: code.slice(start + 1, i) };
  }
  throw new Error("Unbalanced LaTeX argument. Fix the document before continuing.");
}
