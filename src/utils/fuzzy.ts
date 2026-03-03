export const levenshteinDistance = (left: string, right: string) => {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[a.length][b.length];
};

export const isFuzzyMatch = (input: string, target: string, maxDistance = 1) =>
  levenshteinDistance(input, target) <= maxDistance;

export const normalizeWithDictionary = (text: string, dictionary: Record<string, string>) => {
  const tokens = text.split(/\s+/);
  return tokens
    .map((token) => {
      const normalized = token.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!normalized) return token;
      const direct = dictionary[normalized];
      if (direct) return direct;

      const nearest = Object.keys(dictionary).find(
        (key) =>
          Math.abs(key.length - normalized.length) <= 2 &&
          levenshteinDistance(normalized, key) <= 1
      );
      return nearest ? dictionary[nearest] : token;
    })
    .join(" ");
};

