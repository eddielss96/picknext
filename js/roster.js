// 班級固定名冊：用來輔助 OCR 校正姓名拼字、自動帶入性別
// 因為每學期座位表可能重複上傳好幾次，但班上成員名單是固定的，
// 有了名冊之後，OCR 辨識錯字可以自動修正成名冊中最接近的正確姓名，
// 同時直接帶入性別，不用每次都手動設定一次。

// 標準 Levenshtein 編輯距離
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[n];
}

// 在名冊中找出與 text 最接近的姓名
// 回傳 { entry, distance, ambiguous } ，entry 為 null 代表找不到夠接近的候選
export function findClosestRosterEntry(text, roster) {
  const clean = String(text || "").trim();
  if (!clean || !roster || roster.length === 0) {
    return { entry: null, distance: Infinity, ambiguous: false };
  }

  // 完全相同，直接命中
  const exact = roster.find((r) => r.name === clean);
  if (exact) return { entry: exact, distance: 0, ambiguous: false };

  const maxAllowedDistance = clean.length <= 2 ? 1 : 2;
  let best = null;
  let bestDist = Infinity;
  let secondBestDist = Infinity;

  for (const r of roster) {
    const d = levenshtein(clean, r.name);
    if (d < bestDist) {
      secondBestDist = bestDist;
      bestDist = d;
      best = r;
    } else if (d < secondBestDist) {
      secondBestDist = d;
    }
  }

  if (!best || bestDist > maxAllowedDistance) {
    return { entry: null, distance: Infinity, ambiguous: false };
  }
  // 如果第二接近的候選跟最接近的一樣近，代表無法判斷是哪一位，不要自動套用
  const ambiguous = secondBestDist <= bestDist;
  return { entry: best, distance: bestDist, ambiguous };
}

// 把名冊套用到座位表：修正姓名拼字＋補上性別
// 回傳 { correctedCount, filledGenderCount, unmatched: [原始文字...] }
export function applyRosterToSeating(seating, roster) {
  const report = { correctedCount: 0, filledGenderCount: 0, unmatched: [] };
  if (!roster || roster.length === 0) return report;

  for (const session of seating.sessions || []) {
    for (const row of session.rows || []) {
      for (const seat of row) {
        if (!seat || !seat.name || seat.exclude) continue;
        const { entry, distance, ambiguous } = findClosestRosterEntry(seat.name, roster);
        if (!entry || ambiguous) {
          report.unmatched.push(seat.name);
          continue;
        }
        if (distance > 0 && seat.name !== entry.name) {
          seat.name = entry.name;
          report.correctedCount++;
        }
        if (!seat.gender && entry.gender) {
          seat.gender = entry.gender;
          report.filledGenderCount++;
        }
      }
    }
  }
  return report;
}

// 把「班級名冊」文字框內容解析成 [{name, gender}]
// 支援每行：姓名、姓名 性別、姓名,性別、姓名，性別（性別可以是 男/女/M/F/m/f，留空也可以）
export function parseRosterText(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const roster = [];
  for (const line of lines) {
    const parts = line.split(/[\s,，、]+/).filter(Boolean);
    if (parts.length === 0) continue;
    const name = parts[0];
    let gender = "";
    const g = (parts[1] || "").toUpperCase();
    if (g === "男" || g === "M") gender = "男";
    else if (g === "女" || g === "F") gender = "女";
    roster.push({ name, gender });
  }
  return roster;
}

// 把名冊資料轉回文字框格式，方便編輯
export function rosterToText(roster) {
  return (roster || []).map((r) => `${r.name}${r.gender ? " " + r.gender : ""}`).join("\n");
}
