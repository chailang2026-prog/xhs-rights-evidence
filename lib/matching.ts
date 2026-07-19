type TextSource = { title: string; text: string };

function normalizeText(value: string) {
  return value.toLowerCase().replace(/https?:\/\/\S+/g, "").replace(/[\s\p{P}\p{S}]+/gu, "");
}

function ngrams(value: string, size = 2) {
  const normalized = normalizeText(value);
  const result = new Set<string>();
  for (let index = 0; index <= normalized.length - size; index += 1) result.add(normalized.slice(index, index + size));
  return result;
}

export function textSimilarity(source: string, candidate: string) {
  const left = normalizeText(source);
  const right = normalizeText(candidate);
  if (!left || !right) return 0;
  if (left.includes(right) && right.length >= 12) return Math.min(0.98, 0.7 + right.length / Math.max(left.length, 40) * 0.28);
  if (right.includes(left) && left.length >= 12) return 0.96;
  const leftSet = ngrams(left);
  const rightSet = ngrams(right);
  let overlap = 0;
  for (const item of leftSet) if (rightSet.has(item)) overlap += 1;
  return leftSet.size + rightSet.size ? (2 * overlap) / (leftSet.size + rightSet.size) : 0;
}

export function extractSearchPhrases(note: TextSource) {
  const parts = `${note.title}。${note.text}`
    .split(/[。！？!?；;\n]/)
    .map((part) => part.replace(/#[^#\s]+/g, "").trim())
    .filter((part) => part.length >= 10)
    .map((part) => part.slice(0, 42));
  return [...new Set(parts)].sort((a, b) => b.length - a.length).slice(0, 3);
}

