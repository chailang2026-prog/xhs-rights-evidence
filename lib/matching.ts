type TextSource = { title: string; text: string };

const platformBoilerplate = /(?:creator\s+academy|小红书创作助手|小红书创作学院|打开(?:小红书|大众点评|携程|去哪儿|高德|飞猪)App?(?:查看)?|复制(?:本条)?(?:信息|链接).*?打开小红书|点赞|收藏|关注|转发|欢迎评论|记得三连)/gi;

export function cleanComparableText(value: string) {
  return value
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/#[^#\n]{1,80}(?:\[话题\])?#/gu, " ")
    .replace(/#[^#\s]{1,50}/gu, " ")
    .replace(/@[\p{L}\p{N}_·.-]{1,40}/gu, " ")
    .replace(/\[[^\]\n]{0,20}话题\]/gu, " ")
    .replace(/(?:^|\s)\d{1,2}(?:\.\d{1,2})?\s*live\b/gi, " ")
    .replace(platformBoilerplate, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

function normalizeText(value: string) {
  return cleanComparableText(value)
    .toLowerCase()
    .replace(/(?:公共交通)?(?:优先)?选择/gu, "")
    .replace(/口出站/gu, "口出")
    .replace(/(?:步行|前行|行走)/gu, "走")
    .replace(/(?:抵达|到达)/gu, "到")
    .replace(/入园/gu, "进门")
    .replace(/向右(?:转)?/gu, "右转")
    .replace(/向左(?:转)?/gu, "左转")
    .replace(/沿着/gu, "沿")
    .replace(/(?:大约|约)/gu, "")
    .replace(/(?:就能|即可|可以)/gu, "")
    .replace(/园区/gu, "区")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
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
  return cleanComparableText(value)
    .replace(/\s+/g, " ")
    .replace(/^[\s\p{P}\p{S}\p{M}]+|[\s\p{P}\p{S}\p{M}]+$/gu, "")
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
  const bodyParts = cleanComparableText(note.text)
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

function signalWindows(value: string) {
  const compact = [...cleanSearchSegment(value).replace(/[\s\p{P}\p{S}]+/gu, "")];
  if (compact.length < 4) return [];
  const joined = compact.join("");
  const anchors = /[A-Za-z]\d+[A-Za-z\d-]*|[一二三四五六七八九十\d]+号线|公园|景区|花田|花海|北园|南园|西门|东门|出口|口出|步行|分钟|公里|米|路线|定位|向东|向西|向南|向北|左转|右转|入口|观景台|门牌/gu;
  const windows: string[] = [];
  for (const match of joined.matchAll(anchors)) {
    const index = match.index || 0;
    const start = Math.max(0, index - 5);
    const end = Math.min(compact.length, index + [...match[0]].length + 7);
    const window = compact.slice(start, end).join("");
    if ([...window].length >= 5) windows.push(window);
  }
  return windows;
}

function keywordOverlap(left: string, right: string) {
  const leftNormalized = normalizeText(left);
  const rightNormalized = normalizeText(right);
  if (Math.min([...leftNormalized].length, [...rightNormalized].length) < 5) return 0;
  if (leftNormalized.includes(rightNormalized) || rightNormalized.includes(leftNormalized)) return 1;
  const leftSet = ngrams(leftNormalized, 3);
  const rightSet = ngrams(rightNormalized, 3);
  let overlap = 0;
  for (const item of leftSet) if (rightSet.has(item)) overlap += 1;
  return Math.min(leftSet.size, rightSet.size) ? overlap / Math.min(leftSet.size, rightSet.size) : 0;
}

export function extractSearchKeywords(note: TextSource) {
  const candidates: string[] = [];
  const identifiers: string[] = [];
  const phrases = extractSearchPhrases(note);
  const values = [cleanSearchSegment(note.title), ...phrases];
  for (const value of values) {
    for (const token of value.match(/[A-Za-z]+\d+[A-Za-z\d-]*|\d{2,}[A-Za-z\d-]*/g) || []) identifiers.push(token);
    candidates.push(...signalWindows(value));
  }
  if (!candidates.length) {
    for (const phrase of phrases.slice(0, 3)) {
      const characters = [...phrase.replace(/[\s\p{P}\p{S}]+/gu, "")];
      if (characters.length >= 5) candidates.push(characters.slice(0, Math.min(10, characters.length)).join(""));
    }
  }
  const ranked = [...new Set(candidates)].sort((left, right) => phraseScore(right) - phraseScore(left));
  const selected: string[] = [];
  for (const value of [...new Set([...identifiers, ...ranked])]) {
    if (/(?:旅行攻略|探店打卡|周末去哪|值得收藏|一定要去|推荐大家)/.test(value)) continue;
    if (selected.every((other) => keywordOverlap(other, value) < 0.42)) selected.push(value);
    if (selected.length === 8) break;
  }
  return selected;
}

function passageWindows(value: string) {
  const parts = cleanComparableText(value)
    .split(/[。！？!?；;\n]/)
    .map(cleanSearchSegment)
    .filter((part) => [...part].length >= 6);
  return [...new Set(parts.flatMap(phraseWindows))].slice(0, 40);
}

export function bestPassageSimilarity(source: TextSource, candidate: string) {
  const sourcePassages = [cleanSearchSegment(source.title), ...extractSearchPhrases(source)]
    .filter((part) => [...part].length >= 6);
  const candidatePassages = passageWindows(candidate);
  if (!sourcePassages.length || !candidatePassages.length) return 0;
  let best = 0;
  for (const left of sourcePassages) {
    for (const right of candidatePassages) {
      best = Math.max(best, textSimilarity(left, right));
    }
  }
  return best;
}
