function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function matchesHiddenPhrase(comment: string, phrase: string) {
  const normalizedComment = ` ${normalizeText(comment)} `;
  const normalizedPhrase = normalizeText(phrase);
  return normalizedPhrase.length > 0 && normalizedComment.includes(` ${normalizedPhrase} `);
}

export function findHiddenPhrase(comment: string, phrases: readonly string[]) {
  return phrases.find((phrase) => matchesHiddenPhrase(comment, phrase)) ?? null;
}
