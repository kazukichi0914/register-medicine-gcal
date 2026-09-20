/**
 * おくすりカレンダー - カレンダーデータ生成
 *
 * Google Cloud / OAuth を使わず、次の2通りで予定を作る。
 *   1. Googleカレンダーの「予定作成」画面を入力済みの状態で開くURL
 *   2. ICSファイル（インポート用）
 *
 * ブラウザからも Node（テスト）からも読めるようにしてある。
 */
(function (root) {
  "use strict";

  const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

  const pad = (n) => String(n).padStart(2, "0");

  function parseDate(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function fmtDate(dt) {
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  }

  /** 日付文字列に日数を足す */
  function addDays(dateStr, days) {
    const dt = parseDate(dateStr);
    dt.setDate(dt.getDate() + days);
    return fmtDate(dt);
  }

  /** 日付 + 時刻 + 所要分 → 開始/終了の Date */
  function startEnd(dateStr, timeStr, durationMin) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const [hh, mm] = timeStr.split(":").map(Number);
    const start = new Date(y, m - 1, d, hh, mm, 0, 0);
    const end = new Date(start.getTime() + durationMin * 60 * 1000);
    return { start, end };
  }

  /** Date → "20260910T080000"（ローカル時刻そのまま） */
  function compact(dt) {
    return (
      `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}` +
      `T${pad(dt.getHours())}${pad(dt.getMinutes())}00`
    );
  }

  /** 現在時刻 → "20260910T053000Z"（ICSのDTSTAMP用） */
  function stampUtcNow() {
    return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  }

  /**
   * RRULE の UNTIL 値。
   * utc=true  … "20260916T145959Z"（URL方式。Googleが期待するUTC形式）
   * utc=false … "20260916T235959"（ICS方式。DTSTARTがフローティング時刻なので合わせる）
   */
  function untilStamp(endDateStr, utc) {
    if (!utc) return `${endDateStr.replace(/-/g, "")}T235959`;
    const [y, m, d] = endDateStr.split("-").map(Number);
    return new Date(y, m - 1, d, 23, 59, 59)
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
  }

  /**
   * 実際の開始日。毎週くり返しで開始日が選択曜日でない場合、
   * その日にも1件だけ予定ができてしまうので最初の該当曜日まで送る。
   */
  function resolveStartDate(schedule) {
    const { frequency, byDays = [], startDate } = schedule;
    if (frequency !== "weekly" || byDays.length === 0) return startDate;

    const dt = parseDate(startDate);
    for (let i = 0; i < 7; i++) {
      if (byDays.includes(dt.getDay())) break;
      dt.setDate(dt.getDate() + 1);
    }
    return fmtDate(dt);
  }

  /** "FREQ=DAILY;UNTIL=..." を返す。くり返しなしなら null */
  function buildRRule(schedule, { utc = true } = {}) {
    const { frequency, byDays = [], endMode, days, endDate, startDate } = schedule;

    const parts = [];
    if (frequency === "daily") {
      parts.push("FREQ=DAILY");
    } else if (frequency === "everyOtherDay") {
      parts.push("FREQ=DAILY", "INTERVAL=2");
    } else if (frequency === "weekly") {
      parts.push("FREQ=WEEKLY");
      if (byDays.length) parts.push(`BYDAY=${byDays.map((i) => WEEKDAY_CODES[i]).join(",")}`);
    } else {
      return null; // 1回だけ
    }

    if (endMode === "count") {
      const last = addDays(startDate, Math.max(0, Number(days) - 1));
      parts.push(`UNTIL=${untilStamp(last, utc)}`);
    } else if (endMode === "until" && endDate) {
      parts.push(`UNTIL=${untilStamp(endDate, utc)}`);
    }
    // endMode === "forever" は終了条件なし

    return parts.join(";");
  }

  /** 注意事項などを予定の詳細（説明）欄の文面にまとめる */
  function buildDescription({ dosage, notes, medName }) {
    const blocks = [];
    if (dosage && dosage.trim()) blocks.push(`【用法・用量】\n${dosage.trim()}`);
    if (notes && notes.trim()) blocks.push(`【注意事項】\n${notes.trim()}`);
    blocks.push(`― おくすりカレンダーで登録${medName ? ` (${medName})` : ""}`);
    return blocks.join("\n\n");
  }

  function buildTitle(medName, label) {
    return `💊 ${medName}${label ? `（${label}）` : ""}`;
  }

  /* ---------------------------------------------------------------- */
  /* 1. Googleカレンダーの予定作成画面を開くURL                        */
  /* ---------------------------------------------------------------- */

  /**
   * 1つの服用時刻ぶんのURLを組み立てる。
   * 通知（リマインダー）と色はURLでは指定できず、カレンダー既定の通知が付く。
   */
  function buildTemplateUrl(plan, dose) {
    const { medName, dosage, notes, schedule, durationMin = 10, timeZone } = plan;
    const startDate = resolveStartDate(schedule);
    const { start, end } = startEnd(startDate, dose.time, durationMin);
    const rrule = buildRRule({ ...schedule, startDate }, { utc: true });

    const params = new URLSearchParams();
    params.set("action", "TEMPLATE");
    params.set("text", buildTitle(medName, dose.label));
    params.set("dates", `${compact(start)}/${compact(end)}`);
    params.set("details", buildDescription({ dosage, notes, medName }));
    params.set("crm", "AVAILABLE"); // 「空き時間」扱いにする
    if (timeZone) params.set("ctz", timeZone);
    if (rrule) params.set("recur", `RRULE:${rrule}`);

    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }

  /** 服用時刻の数だけURLを作る */
  function buildTemplateUrls(plan) {
    return plan.doses.map((dose) => ({
      time: dose.time,
      label: dose.label,
      url: buildTemplateUrl(plan, dose),
    }));
  }

  /* ---------------------------------------------------------------- */
  /* 2. ICSファイル                                                    */
  /* ---------------------------------------------------------------- */

  /** ICSのテキスト値をエスケープ */
  function escapeIcs(value) {
    return String(value)
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\r?\n/g, "\\n");
  }

  /** ICSの1行は75オクテットまで。超える分は行頭スペースで折り返す */
  function foldLine(line) {
    const bytes = new TextEncoder().encode(line);
    if (bytes.length <= 75) return line;

    const out = [];
    let chunk = "";
    let chunkBytes = 0;
    let limit = 75;

    for (const ch of line) {
      const size = new TextEncoder().encode(ch).length;
      if (chunkBytes + size > limit) {
        out.push(chunk);
        chunk = ch;
        chunkBytes = size;
        limit = 74; // 継続行は先頭スペースぶん1オクテット減る
      } else {
        chunk += ch;
        chunkBytes += size;
      }
    }
    out.push(chunk);
    return out.join("\r\n ");
  }

  /**
   * 服用時刻ぶんの VEVENT を含む ICS を組み立てる。
   * 日時はタイムゾーンなしのローカル時刻（フローティング）で書く。
   * 取り込んだカレンダーのタイムゾーンでそのままの時刻になるため、服薬時刻に適している。
   */
  function buildIcs(plan) {
    const { medName, dosage, notes, doses, schedule, durationMin = 10, reminderMin = 0 } = plan;
    const startDate = resolveStartDate(schedule);
    const rrule = buildRRule({ ...schedule, startDate }, { utc: false });
    const description = buildDescription({ dosage, notes, medName });
    const stamp = stampUtcNow();
    const seed = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//okusuri-calendar//JP",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
    ];

    doses.forEach((dose, index) => {
      const { start, end } = startEnd(startDate, dose.time, durationMin);
      lines.push(
        "BEGIN:VEVENT",
        `UID:okusuri-${seed}-${index}@okusuri-calendar`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${compact(start)}`,
        `DTEND:${compact(end)}`,
        `SUMMARY:${escapeIcs(buildTitle(medName, dose.label))}`,
        `DESCRIPTION:${escapeIcs(description)}`,
        "TRANSP:TRANSPARENT"
      );
      if (rrule) lines.push(`RRULE:${rrule}`);
      if (Number(reminderMin) >= 0) {
        lines.push(
          "BEGIN:VALARM",
          `TRIGGER:-PT${Number(reminderMin)}M`,
          "ACTION:DISPLAY",
          `DESCRIPTION:${escapeIcs(buildTitle(medName, dose.label))}`,
          "END:VALARM"
        );
      }
      lines.push("END:VEVENT");
    });

    lines.push("END:VCALENDAR");

    return lines.map(foldLine).join("\r\n") + "\r\n";
  }

  /** ダウンロード用のファイル名（ASCIIのみで安全に） */
  function buildIcsFilename() {
    const d = new Date();
    return `okusuri_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.ics`;
  }

  const api = {
    WEEKDAY_CODES,
    addDays,
    resolveStartDate,
    buildRRule,
    buildDescription,
    buildTitle,
    buildTemplateUrl,
    buildTemplateUrls,
    escapeIcs,
    foldLine,
    buildIcs,
    buildIcsFilename,
  };

  root.OkusuriCal = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
