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

function cleanSearchSegment(value: string) {
  return value
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/#[^#\s]{1,50}#/g, " ")
    .replace(/#[^#\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function phraseWindows(value: string) {
  const characters = [...value];
  const size = 42;
  if (characters.length <= size) return [value];
  const starts = [0, Math.floor((characters.length - size) / 2), characters.length - size];
  return [...new Set(starts.map((start) => characters.slice(start, start + size).join("").trim()))];
}

function phraseScore(value: string) {
  const normalized = [...normalizeText(value)];
  const uniqueRatio = normalized.length ? new Set(normalized).size / normalized.length : 0;
  const specificMarks = value.match(/[0-9A-Za-z「」《》【】]/g)?.length || 0;
  const genericPhrases = value.match(/(?:点赞|收藏|关注|转发|欢迎评论|希望大家|今天给大家|姐妹们|宝子们|记得)/g)?.length || 0;
  return normalized.length + uniqueRatio * 18 + Math.min(8, specificMarks) * 0.8 - genericPhrases * 10;
}

export function extractSearchPhrases(note: TextSource) {
  const bodyParts = note.text
    .split(/[。！？!?；;\n]/)
    .map(cleanSearchSegment)
    .filter((part) => [...part].length >= 10);
  const title = cleanSearchSegment(note.title);
  const segments = [...([...title].length >= 6 ? [title] : []), ...bodyParts];
  const candidates = [...new Set(segments.flatMap(phraseWindows))]
    .sort((left, right) => phraseScore(right) - phraseScore(left));
  const selected: string[] = [];
  for (const candidate of candidates) {
    if (selected.every((existing) => textSimilarity(existing, candidate) < 0.72)) selected.push(candidate);
    if (selected.length === 6) break;
  }
  return selected;
}

export function extractSearchKeywords(note: TextSource) {
  const candidates: string[] = [];
  const identifiers: string[] = [];
  const values = [cleanSearchSegment(note.title), ...extractSearchPhrases(note).slice(0, 3)];
  for (const value of values) {
    for (const token of value.match(/[A-Za-z]+\d+[A-Za-z\d-]*|\d{2,}[A-Za-z\d-]*/g) || []) identifiers.push(token);
    const characters = [...value.replace(/[\s\p{P}\p{S}]+/gu, "")];
    if (characters.length < 4) continue;
    const size = Math.min(9, characters.length);
    const starts = characters.length <= size
      ? [0]
      : [0, Math.floor((characters.length - size) / 2), characters.length - size];
    for (const start of starts) candidates.push(characters.slice(start, start + size).join(""));
  }
  const ranked = [...new Set(candidates)].sort((left, right) => phraseScore(right) - phraseScore(left));
  return [...new Set([...identifiers, ...ranked])]
    .filter((value) => !/(?:旅行攻略|探店打卡|周末去哪|值得收藏|一定要去|推荐大家)/.test(value))
    .filter((value, index, all) => all.slice(0, index).every((other) => Math.min([...other].length, [...value].length) < 6 || (!other.includes(value) && !value.includes(other))))
    .slice(0, 5);
}
