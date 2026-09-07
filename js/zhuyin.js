// 姓名 -> 注音符號（供點名時快速唸出）
// 依賴：js/vendor/pinyin-pro.js（UMD，掛在 window.pinyinPro）+ js/vendor/pinyin-to-zhuyin.esm.js（拼音轉注音）
import { p2z } from "./vendor/pinyin-to-zhuyin.esm.js";

const cache = new Map();

// 回傳陣列，長度與 name 的字元數相同，每個元素是該字的注音（含聲調符號）
export function nameToZhuyinChars(name) {
  if (!name) return [];
  if (cache.has(name)) return cache.get(name);

  const chars = Array.from(name);
  let result;
  try {
    const pinyinPro = window.pinyinPro;
    const pyPerChar = chars.map((ch) =>
      pinyinPro.pinyin(ch, { type: "string", toneType: "symbol" })
    );
    result = pyPerChar.map((py) => {
      try {
        return p2z(py, { tonemarks: true, inputHasToneMarks: true });
      } catch (e) {
        return "";
      }
    });
  } catch (e) {
    console.warn("注音轉換失敗", name, e);
    result = chars.map(() => "");
  }

  cache.set(name, result);
  return result;
}

// 產生 <ruby> HTML，字上方標注音
export function nameToRubyHtml(name) {
  const zh = nameToZhuyinChars(name);
  const chars = Array.from(name);
  return chars
    .map((ch, i) => {
      const z = zh[i] || "";
      const escCh = escapeHtml(ch);
      const escZ = escapeHtml(z);
      return z
        ? `<ruby>${escCh}<rt>${escZ}</rt></ruby>`
        : `<ruby>${escCh}<rt>&nbsp;</rt></ruby>`;
    })
    .join("");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
