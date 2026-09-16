/** "1 cell" / "3 cells". Pass an explicit plural for irregular nouns ("entry", "entries"). */
export function plural(n: number, noun: string, pluralNoun = `${noun}s`): string {
  return `${n} ${n === 1 ? noun : pluralNoun}`;
}
