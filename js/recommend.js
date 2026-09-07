// 推薦下一位被點名的人選
//
// 教授的四條規則：
// 1. 同一個 seating session（座位表中左/中/右三個倒三角形區塊之一）不能連續被點兩次
//    → 點完一人後，下一位必須換到不同的 session
// 2. 不能連續點同一性別（下一位性別需與剛剛回答完的人不同）
// 3. 已經被點過的人不能再被點
// 4. 必須在 3 秒內決定 → 由 UI 呈現負責，本模組只需快速算出候選名單

export function flattenSeats(seating) {
  const flat = [];
  for (const session of seating.sessions || []) {
    (session.rows || []).forEach((row, rowIdx) => {
      row.forEach((seat, colIdx) => {
        if (seat && seat.name && seat.name.trim() !== "") {
          flat.push({
            id: seat.id,
            name: seat.name,
            gender: seat.gender || "",
            exclude: !!seat.exclude,
            sessionId: session.id,
            sessionLabel: session.label,
            rowIdx,
            colIdx,
          });
        }
      });
    });
  }
  return flat;
}

export function findSeatById(seating, id) {
  return flattenSeats(seating).find((s) => s.id === id) || null;
}

// 回傳 { lastCalled, primary, genderUnknown, sessionViolation, allCalled, remainingCount }
export function getRecommendation(seating, callLog) {
  const flat = flattenSeats(seating).filter((s) => !s.exclude);
  const calledIds = new Set((callLog || []).map((c) => c.seatId));
  const remaining = flat.filter((s) => !calledIds.has(s.id));

  const lastEntry = callLog && callLog.length ? callLog[callLog.length - 1] : null;
  const lastCalled = lastEntry
    ? flat.find((s) => s.id === lastEntry.seatId) || {
        id: lastEntry.seatId,
        name: lastEntry.name,
        gender: lastEntry.gender,
        sessionId: lastEntry.sessionId,
      }
    : null;

  if (remaining.length === 0) {
    return {
      lastCalled,
      primary: [],
      genderUnknown: [],
      sessionViolation: [],
      allCalled: flat.length > 0,
      remainingCount: 0,
    };
  }

  if (!lastCalled) {
    // 一開始自由選擇，全部人都是候選人
    return {
      lastCalled: null,
      primary: remaining,
      genderUnknown: [],
      sessionViolation: [],
      allCalled: false,
      remainingCount: remaining.length,
    };
  }

  const sessionOk = (s) => s.sessionId !== lastCalled.sessionId;
  const genderKnown = (s) => !!s.gender;
  const genderOk = (s) => s.gender !== lastCalled.gender;

  const primary = remaining.filter((s) => sessionOk(s) && genderKnown(s) && genderOk(s));
  const genderUnknown = remaining.filter((s) => sessionOk(s) && !genderKnown(s));
  const sessionViolation = remaining.filter((s) => !sessionOk(s));

  return {
    lastCalled,
    primary,
    genderUnknown,
    sessionViolation,
    allCalled: false,
    remainingCount: remaining.length,
  };
}

// 從候選名單中隨機挑一位作為「建議首選」，避免每次都選同一種順序、讓學生猜到規律
export function pickSuggested(list) {
  if (!list || list.length === 0) return null;
  const idx = Math.floor(Math.random() * list.length);
  return list[idx];
}
