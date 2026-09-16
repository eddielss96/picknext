// 本機資料儲存（localStorage）+ 匯出/匯入 JSON
const KEY = "picknext.state.v1";

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function defaultState() {
  return {
    version: 1,
    me: "林欣學",
    seating: { sessions: [] },
    callLog: [], // { seatId, name, gender, sessionId, ts }
    roster: [], // { name, gender } 班級固定名冊，用來輔助 OCR 校正姓名與帶入性別
  };
}

// 確保 roster 是乾淨的 { name, gender } 陣列（去除空白姓名、重複姓名只留最後一筆）
function normalizeRoster(roster) {
  if (!Array.isArray(roster)) return [];
  const byName = new Map();
  for (const entry of roster) {
    if (!entry || !entry.name) continue;
    const name = String(entry.name).trim();
    if (!name) continue;
    const gender = entry.gender === "男" || entry.gender === "女" ? entry.gender : "";
    byName.set(name, { name, gender });
  }
  return Array.from(byName.values());
}

// 確保每個座位（非 null）都有唯一 id、gender 欄位存在
function normalizeSeating(seating) {
  if (!seating || !Array.isArray(seating.sessions)) return { sessions: [] };
  for (const session of seating.sessions) {
    session.rows = session.rows || [];
    for (const row of session.rows) {
      for (let i = 0; i < row.length; i++) {
        const seat = row[i];
        if (seat && typeof seat === "object") {
          if (!seat.id) seat.id = uid();
          if (seat.gender === undefined) seat.gender = "";
          if (seat.exclude === undefined) seat.exclude = false;
        }
      }
    }
  }
  return seating;
}

export function loadState() {
  let raw;
  try {
    raw = localStorage.getItem(KEY);
  } catch (e) {
    console.warn("localStorage 無法使用", e);
  }
  if (!raw) return defaultState();
  try {
    const parsed = JSON.parse(raw);
    const state = { ...defaultState(), ...parsed };
    state.seating = normalizeSeating(state.seating);
    if (!Array.isArray(state.callLog)) state.callLog = [];
    state.roster = normalizeRoster(state.roster);
    return state;
  } catch (e) {
    console.warn("讀取本機資料失敗，改用預設值", e);
    return defaultState();
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.error("儲存本機資料失敗", e);
    alert("儲存失敗：瀏覽器儲存空間可能已滿或被封鎖。建議立即匯出 JSON 備份。");
  }
}

export function exportStateToFile(state) {
  const blob = new Blob([JSON.stringify(state, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  a.href = url;
  a.download = `picknext-座位表-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function importStateFromObject(obj) {
  const state = { ...defaultState(), ...obj };
  state.seating = normalizeSeating(state.seating);
  if (!Array.isArray(state.callLog)) state.callLog = [];
  state.roster = normalizeRoster(state.roster);
  return state;
}

export function newSeatId() {
  return uid();
}

export { normalizeSeating, normalizeRoster, defaultState };
