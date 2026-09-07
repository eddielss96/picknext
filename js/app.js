import { loadState, saveState, exportStateToFile, importStateFromObject, newSeatId } from "./storage.js";
import { recognizeSeatingImage } from "./ocr.js";
import { flattenSeats, getRecommendation, pickSuggested } from "./recommend.js";
import { nameToRubyHtml } from "./zhuyin.js";

let state = loadState();
let draftSeating = cloneSeating(state.seating);
let selectedImageFile = null;
let lastSuggested = null; // 記住目前畫面上顯示的建議人選（讓「就是他」按鈕知道要記錄誰）
let tesseractReady = false;

function cloneSeating(seating) {
  return JSON.parse(JSON.stringify(seating || { sessions: [] }));
}

// ---------------- 初始化 ----------------

document.addEventListener("DOMContentLoaded", () => {
  wireTabs();
  wireSetupTab();
  wireRollcallTab();
  wireSettingsTab();
  wireOcrEngineStatus();

  renderSeatEditor();
  renderSettings();
  renderRollcall();
});

function wireOcrEngineStatus() {
  const statusEl = document.getElementById("ocrEngineStatus");
  const btnRecognize = document.getElementById("btnRecognize");

  if (window.Tesseract) {
    tesseractReady = true;
  }
  updateOcrButtonState();

  window.addEventListener("tesseract-ready", () => {
    tesseractReady = true;
    statusEl.textContent = "OCR 引擎已就緒";
    updateOcrButtonState();
  });
  window.addEventListener("tesseract-load-failed", () => {
    tesseractReady = false;
    statusEl.textContent = "⚠️ OCR 引擎載入失敗（可能是網路問題），請直接用下方表格手動輸入座位表";
    updateOcrButtonState();
  });

  function updateOcrButtonState() {
    btnRecognize.disabled = !(tesseractReady && selectedImageFile);
    if (tesseractReady) statusEl.textContent = "OCR 引擎已就緒";
  }

  // 讓 imageInput 的 change 事件也能重新檢查按鈕狀態
  document.getElementById("imageInput").addEventListener("change", updateOcrButtonState);
}

// ---------------- Tabs ----------------

function wireTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
      if (btn.dataset.tab === "rollcall") renderRollcall();
    });
  });
}

// ---------------- Step 1：座位表設定 ----------------

function wireSetupTab() {
  const imageInput = document.getElementById("imageInput");
  const btnRecognize = document.getElementById("btnRecognize");
  const btnLoadSample = document.getElementById("btnLoadSample");
  const btnSaveSeating = document.getElementById("btnSaveSeating");
  const preview = document.getElementById("imagePreview");

  imageInput.addEventListener("change", () => {
    const file = imageInput.files && imageInput.files[0];
    selectedImageFile = file || null;
    if (file) {
      preview.src = URL.createObjectURL(file);
      preview.hidden = false;
    } else {
      preview.hidden = true;
    }
    // 按鈕的 disabled 狀態統一由 wireOcrEngineStatus() 的 updateOcrButtonState 控制
  });

  btnRecognize.addEventListener("click", async () => {
    if (!selectedImageFile) return;
    const progressWrap = document.getElementById("ocrProgress");
    const progressFill = document.getElementById("ocrProgressFill");
    const progressText = document.getElementById("ocrProgressText");
    progressWrap.hidden = false;
    btnRecognize.disabled = true;
    try {
      const result = await recognizeSeatingImage(selectedImageFile, {
        onProgress: (m) => {
          const pct = Math.round((m.progress || 0) * 100);
          progressFill.style.width = pct + "%";
          progressText.textContent = `${translateOcrStatus(m.status)}...${pct}%`;
        },
      });
      if (result.wordCount === 0) {
        alert("辨識不到任何文字，請確認圖片清晰，或直接手動輸入座位表。");
      } else {
        assignSeatIds(result.sessions);
        draftSeating = { sessions: result.sessions };
        renderSeatEditor();
        alert(
          `辨識完成，共偵測到 ${result.wordCount} 個文字區塊。\n請務必逐一檢查姓名是否正確，並手動設定每個人的性別（圖片顏色不會被用來判斷性別）。`
        );
      }
    } catch (e) {
      console.error(e);
      alert("辨識失敗：" + e.message);
    } finally {
      btnRecognize.disabled = false;
      progressWrap.hidden = true;
    }
  });

  btnLoadSample.addEventListener("click", async () => {
    if (!confirm("套用範例資料將覆蓋目前校正表中的內容，確定要繼續嗎？")) return;
    try {
      const res = await fetch("data/sample-seating.json");
      const json = await res.json();
      assignSeatIds(json.sessions);
      draftSeating = { sessions: json.sessions };
      renderSeatEditor();
    } catch (e) {
      alert("載入範例資料失敗：" + e.message);
    }
  });

  document.getElementById("btnAddSession").addEventListener("click", () => {
    if (!draftSeating.sessions) draftSeating.sessions = [];
    const n = draftSeating.sessions.length + 1;
    draftSeating.sessions.push({ id: newSeatId(), label: `新區塊 ${n}`, rows: [[]] });
    renderSeatEditor();
  });

  btnSaveSeating.addEventListener("click", () => {
    state.seating = cloneSeating(draftSeating);
    saveState(state);
    renderRollcall();
    document.querySelector('.tab-btn[data-tab="rollcall"]').click();
  });
}

function translateOcrStatus(status) {
  const map = {
    "loading tesseract core": "載入辨識引擎",
    "initializing tesseract": "初始化",
    "loading language traineddata": "載入語言資料",
    "initializing api": "準備中",
    "recognizing text": "辨識文字中",
  };
  return map[status] || status || "處理中";
}

function assignSeatIds(sessions) {
  for (const session of sessions) {
    for (const row of session.rows) {
      for (const seat of row) {
        if (seat && !seat.id) seat.id = newSeatId();
      }
    }
  }
}

function renderSeatEditor() {
  const container = document.getElementById("sessionEditors");
  container.innerHTML = "";

  if (!draftSeating.sessions || draftSeating.sessions.length === 0) {
    container.innerHTML = `<p class="hint">尚未有座位表資料。請上傳圖片辨識，或點「套用範例資料」快速開始。</p>`;
    return;
  }

  draftSeating.sessions.forEach((session, sIdx) => {
    const sec = document.createElement("div");
    sec.className = "session-editor";

    const header = document.createElement("div");
    header.className = "session-editor-header";
    header.innerHTML = `
      <input type="text" class="session-label-input" value="${escapeAttr(session.label)}" />
      <button class="btn-icon del-session-btn" title="刪除整個區塊">🗑 刪除區塊</button>
    `;
    const labelInput = header.querySelector(".session-label-input");
    labelInput.addEventListener("input", () => {
      session.label = labelInput.value;
    });
    header.querySelector(".del-session-btn").addEventListener("click", () => {
      if (!confirm(`確定要刪除「${session.label}」整個區塊嗎？`)) return;
      draftSeating.sessions.splice(sIdx, 1);
      renderSeatEditor();
    });
    sec.appendChild(header);

    const rowsWrap = document.createElement("div");
    rowsWrap.className = "rows-wrap";

    session.rows.forEach((row, rIdx) => {
      rowsWrap.appendChild(renderRowEditor(session, sIdx, row, rIdx));
    });

    sec.appendChild(rowsWrap);

    const addRowBtn = document.createElement("button");
    addRowBtn.className = "btn btn-secondary btn-small";
    addRowBtn.textContent = "＋ 新增一列";
    addRowBtn.addEventListener("click", () => {
      session.rows.push([]);
      renderSeatEditor();
    });
    sec.appendChild(addRowBtn);

    container.appendChild(sec);
  });
}

function renderRowEditor(session, sIdx, row, rIdx) {
  const rowEl = document.createElement("div");
  rowEl.className = "seat-row-editor";

  row.forEach((seat, cIdx) => {
    rowEl.appendChild(renderSeatCellEditor(session, row, seat, cIdx));
  });

  const addSeatBtn = document.createElement("button");
  addSeatBtn.className = "btn-icon add-seat-btn";
  addSeatBtn.title = "新增座位";
  addSeatBtn.textContent = "＋";
  addSeatBtn.addEventListener("click", () => {
    row.push({ id: newSeatId(), name: "", gender: "" });
    renderSeatEditor();
  });
  rowEl.appendChild(addSeatBtn);

  const delRowBtn = document.createElement("button");
  delRowBtn.className = "btn-icon del-row-btn";
  delRowBtn.title = "刪除整列";
  delRowBtn.textContent = "🗑";
  delRowBtn.addEventListener("click", () => {
    session.rows.splice(rIdx, 1);
    renderSeatEditor();
  });
  rowEl.appendChild(delRowBtn);

  return rowEl;
}

function renderSeatCellEditor(session, row, seat, cIdx) {
  const wrap = document.createElement("div");
  wrap.className = "seat-cell-editor";

  if (!seat) {
    wrap.classList.add("empty-cell");
    wrap.innerHTML = `<span class="empty-label">空位</span>`;
    const fillBtn = document.createElement("button");
    fillBtn.className = "btn-icon";
    fillBtn.textContent = "✎";
    fillBtn.title = "填入姓名";
    fillBtn.addEventListener("click", () => {
      row[cIdx] = { id: newSeatId(), name: "", gender: "" };
      renderSeatEditor();
    });
    wrap.appendChild(fillBtn);
    return wrap;
  }

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "seat-name-input";
  nameInput.placeholder = "姓名";
  nameInput.value = seat.name || "";
  nameInput.addEventListener("input", () => {
    seat.name = nameInput.value;
  });
  wrap.appendChild(nameInput);

  const genderSelect = document.createElement("select");
  genderSelect.className = "seat-gender-select";
  genderSelect.innerHTML = `
    <option value="">性別?</option>
    <option value="男">男</option>
    <option value="女">女</option>
  `;
  genderSelect.value = seat.gender || "";
  genderSelect.addEventListener("change", () => {
    seat.gender = genderSelect.value;
  });
  wrap.appendChild(genderSelect);

  const excludeLabel = document.createElement("label");
  excludeLabel.className = "exclude-label";
  excludeLabel.title = "非學生座位（例如 TA），不會被納入點名";
  excludeLabel.innerHTML = `<input type="checkbox" ${seat.exclude ? "checked" : ""}/> 排除`;
  excludeLabel.querySelector("input").addEventListener("change", (e) => {
    seat.exclude = e.target.checked;
  });
  wrap.appendChild(excludeLabel);

  const delBtn = document.createElement("button");
  delBtn.className = "btn-icon";
  delBtn.textContent = "✕";
  delBtn.title = "刪除此座位";
  delBtn.addEventListener("click", () => {
    row.splice(cIdx, 1);
    renderSeatEditor();
  });
  wrap.appendChild(delBtn);

  return wrap;
}

function escapeAttr(s) {
  return String(s || "").replace(/"/g, "&quot;");
}

// ---------------- Step 2：點名 ----------------

function wireRollcallTab() {
  document.getElementById("btnClearLog").addEventListener("click", () => {
    if (state.callLog.length === 0) return;
    if (!confirm("確定要清除全部點名記錄嗎？這個動作無法復原（可先到「設定」匯出備份）。")) return;
    state.callLog = [];
    saveState(state);
    renderRollcall();
  });

  document.getElementById("btnUndo").addEventListener("click", () => {
    if (state.callLog.length === 0) return;
    state.callLog.pop();
    saveState(state);
    renderRollcall();
  });
}

function renderRollcall() {
  document.getElementById("meNameDisplay").textContent = state.me || "（尚未設定）";
  renderRecommendCard();
  renderSeatingChart();
  renderCallHistory();
}

function renderRecommendCard() {
  const card = document.getElementById("recommendCard");
  const flat = flattenSeats(state.seating).filter((s) => !s.exclude);

  if (flat.length === 0) {
    card.innerHTML = `<p class="hint">尚未設定座位表，請先到「1. 座位表設定」上傳圖片或套用範例資料。</p>`;
    lastSuggested = null;
    return;
  }

  const rec = getRecommendation(state.seating, state.callLog);

  if (rec.allCalled) {
    card.innerHTML = `<p class="all-called">🎉 全班都點過了！可以清除點名記錄開始新的一輪。</p>`;
    lastSuggested = null;
    return;
  }

  let pool = rec.primary;
  let tierNote = "";
  if (pool.length === 0 && rec.genderUnknown.length > 0) {
    pool = rec.genderUnknown;
    tierNote = `⚠️ 這些人選性別尚未設定，請自行確認是否與上一位不同性別。`;
  } else if (pool.length === 0 && rec.sessionViolation.length > 0) {
    pool = rec.sessionViolation;
    tierNote = `⚠️ 找不到完全符合規則的人選，以下是退而求其次的建議（會違反規則1：同區塊連續點名）。`;
  }

  const suggested = pickSuggested(pool);
  lastSuggested = suggested;

  const lastHtml = rec.lastCalled
    ? `<p class="last-called">剛剛回答：<strong>${escapeHtml(rec.lastCalled.name)}</strong>（${escapeHtml(
        rec.lastCalled.sessionId ? sessionLabelOf(rec.lastCalled) : ""
      )} ・ ${escapeHtml(rec.lastCalled.gender || "性別未設")}）</p>`
    : `<p class="last-called">目前還沒有人被點名，請自由選第一位。</p>`;

  let suggestedHtml;
  if (suggested) {
    suggestedHtml = `
      <div class="suggested-name">${nameToRubyHtml(suggested.name)}</div>
      <div class="suggested-meta">${escapeHtml(suggested.sessionLabel)} ・ ${escapeHtml(suggested.gender || "性別未設")}</div>
      <button id="btnConfirmSuggested" class="btn btn-primary btn-large">✅ 就是他／她（記錄點到）</button>
    `;
  } else {
    suggestedHtml = `<p class="hint">目前沒有可推薦的人選。</p>`;
  }

  card.innerHTML = `
    ${lastHtml}
    ${tierNote ? `<p class="tier-note">${tierNote}</p>` : ""}
    <div class="suggested-box">${suggestedHtml}</div>
    ${renderCandidateChips(pool, suggested)}
  `;

  const confirmBtn = document.getElementById("btnConfirmSuggested");
  if (confirmBtn) {
    confirmBtn.addEventListener("click", () => {
      if (lastSuggested) recordCall(lastSuggested);
    });
  }

  card.querySelectorAll(".candidate-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const seat = pool.find((s) => s.id === chip.dataset.id);
      if (seat) recordCall(seat);
    });
  });
}

function sessionLabelOf(seat) {
  const session = (state.seating.sessions || []).find((s) => s.id === seat.sessionId);
  return session ? session.label : seat.sessionId || "";
}

function renderCandidateChips(pool, suggested) {
  if (!pool || pool.length <= 1) return "";
  const others = pool.filter((s) => !suggested || s.id !== suggested.id);
  if (others.length === 0) return "";
  return `
    <div class="candidate-chips">
      <p class="hint">其他符合規則的人選（點擊也可以直接記錄）：</p>
      <div class="chips">
        ${others
          .map(
            (s) =>
              `<button class="candidate-chip" data-id="${s.id}">${escapeHtml(s.name)}（${escapeHtml(
                s.sessionLabel
              )}・${escapeHtml(s.gender || "?")}）</button>`
          )
          .join("")}
      </div>
    </div>
  `;
}

function recordCall(seat) {
  state.callLog.push({
    seatId: seat.id,
    name: seat.name,
    gender: seat.gender || "",
    sessionId: seat.sessionId,
    ts: Date.now(),
  });
  saveState(state);
  renderRollcall();
}

function renderSeatingChart() {
  const container = document.getElementById("seatingChart");
  container.innerHTML = "";

  const rec = getRecommendation(state.seating, state.callLog);
  const candidateIds = new Set(rec.primary.map((s) => s.id));
  const genderUnknownIds = new Set(rec.genderUnknown.map((s) => s.id));
  const calledIds = new Set(state.callLog.map((c) => c.seatId));
  const lastId = state.callLog.length ? state.callLog[state.callLog.length - 1].seatId : null;

  (state.seating.sessions || []).forEach((session) => {
    const block = document.createElement("div");
    block.className = "chart-session";
    const title = document.createElement("div");
    title.className = "chart-session-title";
    title.textContent = session.label;
    block.appendChild(title);

    session.rows.forEach((row) => {
      const rowEl = document.createElement("div");
      rowEl.className = "chart-row";
      row.forEach((seat) => {
        const cell = document.createElement("div");
        if (!seat || !seat.name) {
          cell.className = "chart-seat empty";
          rowEl.appendChild(cell);
          return;
        }
        cell.className = "chart-seat";
        if (seat.exclude) cell.classList.add("excluded");
        if (calledIds.has(seat.id)) cell.classList.add("called");
        if (seat.id === lastId) cell.classList.add("seat-last-called");
        if (candidateIds.has(seat.id)) cell.classList.add("candidate");
        else if (genderUnknownIds.has(seat.id)) cell.classList.add("candidate-unsure");
        if (seat.name === state.me) cell.classList.add("me");

        cell.innerHTML = `<span class="seat-name">${escapeHtml(seat.name)}</span>${
          seat.gender ? `<span class="seat-gender">${escapeHtml(seat.gender)}</span>` : ""
        }`;

        if (!seat.exclude && !calledIds.has(seat.id)) {
          cell.addEventListener("click", () => {
            const flatSeat = flattenSeats(state.seating).find((s) => s.id === seat.id);
            if (flatSeat) recordCall(flatSeat);
          });
        }
        rowEl.appendChild(cell);
      });
      block.appendChild(rowEl);
    });

    container.appendChild(block);
  });
}

function renderCallHistory() {
  const list = document.getElementById("callHistory");
  list.innerHTML = "";
  state.callLog.forEach((entry) => {
    const li = document.createElement("li");
    const time = new Date(entry.ts).toLocaleTimeString("zh-TW", { hour12: false });
    li.textContent = `${entry.name}（${entry.gender || "性別未設"}）－ ${time}`;
    list.appendChild(li);
  });
  if (state.callLog.length === 0) {
    const li = document.createElement("li");
    li.className = "empty-history";
    li.textContent = "尚未有點名記錄";
    list.appendChild(li);
  }
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---------------- Step 3：設定 ----------------

function wireSettingsTab() {
  const meInput = document.getElementById("meNameInput");
  meInput.addEventListener("input", () => {
    state.me = meInput.value;
    saveState(state);
    document.getElementById("meNameDisplay").textContent = state.me || "（尚未設定）";
    renderSeatingChart();
  });

  document.getElementById("btnExport").addEventListener("click", () => {
    exportStateToFile(state);
  });

  document.getElementById("importInput").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const obj = JSON.parse(text);
      state = importStateFromObject(obj);
      saveState(state);
      draftSeating = cloneSeating(state.seating);
      renderSeatEditor();
      renderSettings();
      renderRollcall();
      alert("匯入成功！");
    } catch (err) {
      alert("匯入失敗：檔案格式不正確");
    } finally {
      e.target.value = "";
    }
  });

  document.getElementById("btnResetAll").addEventListener("click", () => {
    if (!confirm("確定要清除所有資料（座位表 + 點名記錄）嗎？此動作無法復原！")) return;
    localStorage.clear();
    state = loadState();
    draftSeating = cloneSeating(state.seating);
    renderSeatEditor();
    renderSettings();
    renderRollcall();
  });
}

function renderSettings() {
  document.getElementById("meNameInput").value = state.me || "";
}
