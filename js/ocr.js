// 座位表圖片自動辨識（best-effort，辨識後一定要人工校正）
// 依賴全域 window.Tesseract（於 index.html 以 <script> 從 CDN 載入）
//
// 演算法：
// 1. 對整張圖跑 OCR，取得每個「字詞」的文字與外框座標（bbox）。
// 2. 依 Y 座標把文字群聚成「列」（row）。
// 3. 依全圖 X 座標找出兩個最大間隔，把座位表切成「左/中/右」三個 session（對應圖片中三個倒三角形區塊）。
// 4. 同一列、同一 session 內的文字依 X 座標排序，組成該 session 該列的座位序列。
// 5. 過濾掉非姓名的標籤字樣（TA、門、講台…）與雜訊。
//
// 這只是「輔助帶入」，實際辨識率會隨照片畫質、字體浮動，之後一定要在手動校正表格中逐一確認。

const NON_NAME_LABELS = new Set(["門", "講台", "台", "黑板", "投影"]);
const TA_LABELS = new Set(["TA", "T A", "TA助教", "助教"]);

export async function recognizeSeatingImage(imageSource, { onProgress } = {}) {
  if (!window.Tesseract) {
    throw new Error("OCR 函式庫尚未載入，請確認網路連線後重新整理頁面");
  }

  const { data } = await window.Tesseract.recognize(imageSource, "chi_tra", {
    logger: (m) => {
      if (onProgress) onProgress(m);
    },
  });

  const rawWords = (data.words || [])
    .filter((w) => w.text && w.text.trim().length > 0)
    .map((w) => ({
      text: w.text.trim(),
      confidence: w.confidence,
      cx: (w.bbox.x0 + w.bbox.x1) / 2,
      cy: (w.bbox.y0 + w.bbox.y1) / 2,
      w: w.bbox.x1 - w.bbox.x0,
      h: w.bbox.y1 - w.bbox.y0,
    }))
    .filter((w) => /[一-鿿A-Za-z]/.test(w.text)); // 至少含中文字或英文字母

  if (rawWords.length === 0) {
    return { sessions: emptySessions(), wordCount: 0 };
  }

  const sessionBounds = splitIntoThreeGroupsByX(rawWords.map((w) => w.cx));
  const rows = clusterIntoRows(rawWords);

  const sessions = [
    { id: "left", label: "左側", rows: [] },
    { id: "middle", label: "中間", rows: [] },
    { id: "right", label: "右側", rows: [] },
  ];

  for (const row of rows) {
    const bucket = [[], [], []]; // left, middle, right
    for (const word of row) {
      const idx = sessionIndexForX(word.cx, sessionBounds);
      bucket[idx].push(word);
    }
    for (let i = 0; i < 3; i++) {
      bucket[i].sort((a, b) => a.cx - b.cx);
      const seatRow = bucket[i].map((w) => wordToSeat(w)).filter(Boolean);
      if (seatRow.length > 0) sessions[i].rows.push(seatRow);
    }
  }

  return { sessions, wordCount: rawWords.length };
}

function wordToSeat(w) {
  const t = w.text.replace(/\s+/g, "");
  if (NON_NAME_LABELS.has(t)) return null;
  if (TA_LABELS.has(w.text.trim().toUpperCase()) || t === "TA") {
    return { name: "TA", gender: "", exclude: true };
  }
  // 過濾明顯不是姓名的雜訊（太長、含數字等）
  if (t.length > 6) return null;
  return { name: t, gender: "" };
}

function emptySessions() {
  return [
    { id: "left", label: "左側", rows: [] },
    { id: "middle", label: "中間", rows: [] },
    { id: "right", label: "右側", rows: [] },
  ];
}

// 在一維數值中找出「兩個最大間隔」，把資料切成三群，回傳兩個切點
function splitIntoThreeGroupsByX(xs) {
  const sorted = [...xs].sort((a, b) => a - b);
  if (sorted.length < 3) {
    return [sorted[0] ?? 0, sorted[sorted.length - 1] ?? 0];
  }
  const gaps = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push({ gap: sorted[i] - sorted[i - 1], mid: (sorted[i] + sorted[i - 1]) / 2 });
  }
  gaps.sort((a, b) => b.gap - a.gap);
  const topTwo = gaps.slice(0, 2).map((g) => g.mid).sort((a, b) => a - b);
  if (topTwo.length < 2) return [sorted[0], sorted[sorted.length - 1]];
  return topTwo;
}

function sessionIndexForX(x, bounds) {
  const [b1, b2] = bounds;
  if (x <= b1) return 0;
  if (x <= b2) return 1;
  return 2;
}

// 依 Y 座標把文字群聚成列（列高門檻取所有字高中位數的 1.2 倍）
function clusterIntoRows(words) {
  const sorted = [...words].sort((a, b) => a.cy - b.cy);
  const heights = sorted.map((w) => w.h).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] || 20;
  const threshold = medianH * 1.2;

  const rows = [];
  let current = [];
  let currentY = null;

  for (const w of sorted) {
    if (currentY === null || Math.abs(w.cy - currentY) <= threshold) {
      current.push(w);
      currentY = current.reduce((s, x) => s + x.cy, 0) / current.length;
    } else {
      rows.push(current);
      current = [w];
      currentY = w.cy;
    }
  }
  if (current.length) rows.push(current);
  return rows;
}
