/* おくすりカレンダー - ポップアップ UI（Google Cloud / OAuth 不要） */

const $ = (id) => document.getElementById(id);
const C = globalThis.OkusuriCal;

const el = {
  form: $("medForm"),
  medName: $("medName"),
  dosage: $("dosage"),
  notes: $("notes"),
  presetChips: $("presetChips"),
  noteChips: $("noteChips"),
  doseList: $("doseList"),
  addDoseBtn: $("addDoseBtn"),
  startDate: $("startDate"),
  frequency: $("frequency"),
  weekdayField: $("weekdayField"),
  weekdays: $("weekdays"),
  periodRow: $("periodRow"),
  endMode: $("endMode"),
  daysField: $("daysField"),
  days: $("days"),
  endDateField: $("endDateField"),
  endDate: $("endDate"),
  reminderMin: $("reminderMin"),
  durationMin: $("durationMin"),
  previewTitle: $("previewTitle"),
  previewDesc: $("previewDesc"),
  summaryLine: $("summaryLine"),
  openBtn: $("openBtn"),
  icsBtn: $("icsBtn"),
  saveMedBtn: $("saveMedBtn"),
  medList: $("medList"),
  toast: $("toast"),
};

/** doses: [{ time, label }] */
let doses = [];

/* ------------------------------------------------------------------ */
/* ユーティリティ                                                      */
/* ------------------------------------------------------------------ */

let toastTimer;
function toast(message, kind = "") {
  clearTimeout(toastTimer);
  el.toast.textContent = message;
  el.toast.className = `toast${kind ? ` is-${kind}` : ""}`;
  el.toast.hidden = false;
  toastTimer = setTimeout(() => {
    el.toast.hidden = true;
  }, kind === "error" ? 6000 : 3500);
}

function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** UTF-8 文字列を base64 に（ICS を data: URL で渡すため） */
function toBase64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/* ------------------------------------------------------------------ */
/* 服用タイミング                                                      */
/* ------------------------------------------------------------------ */

function renderDoses() {
  el.doseList.textContent = "";

  if (doses.length === 0) {
    const li = document.createElement("li");
    li.className = "empty-note";
    li.textContent = "上のボタンから服用タイミングを選ぶか、時刻を追加してください";
    el.doseList.append(li);
    refreshOutputs();
    return;
  }

  doses.forEach((dose, index) => {
    const li = document.createElement("li");
    li.className = "dose-row";

    const time = document.createElement("input");
    time.type = "time";
    time.value = dose.time;
    time.addEventListener("change", () => {
      doses[index].time = time.value;
      refreshOutputs();
      saveDraft();
    });

    const label = document.createElement("input");
    label.type = "text";
    label.value = dose.label;
    label.placeholder = "タイミング名（例：朝食後）";
    label.addEventListener("input", () => {
      doses[index].label = label.value;
      refreshOutputs();
      saveDraft();
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-btn";
    remove.title = "この時刻を削除";
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      doses.splice(index, 1);
      renderDoses();
      saveDraft();
    });

    li.append(time, label, remove);
    el.doseList.append(li);
  });

  refreshOutputs();
}

function addDose(time, label) {
  if (doses.some((d) => d.time === time && d.label === label)) {
    toast("同じタイミングが既に追加されています");
    return;
  }
  doses.push({ time, label });
  doses.sort((a, b) => a.time.localeCompare(b.time));
  renderDoses();
  saveDraft();
}

/* ------------------------------------------------------------------ */
/* 入力内容の取得                                                      */
/* ------------------------------------------------------------------ */

function selectedWeekdays() {
  return [...el.weekdays.querySelectorAll("input:checked")].map((c) => Number(c.value));
}

function collectPlan() {
  return {
    medName: el.medName.value.trim(),
    dosage: el.dosage.value.trim(),
    notes: el.notes.value.trim(),
    doses: doses.map((d) => ({ time: d.time, label: d.label.trim() })),
    schedule: {
      frequency: el.frequency.value,
      byDays: selectedWeekdays(),
      endMode: el.endMode.value,
      days: Number(el.days.value),
      endDate: el.endDate.value,
      startDate: el.startDate.value,
    },
    durationMin: Number(el.durationMin.value),
    reminderMin: Number(el.reminderMin.value),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

/* ------------------------------------------------------------------ */
/* 表示切り替え・サマリー・プレビュー                                  */
/* ------------------------------------------------------------------ */

function syncVisibility() {
  const isWeekly = el.frequency.value === "weekly";
  const isOnce = el.frequency.value === "once";

  el.weekdayField.hidden = !isWeekly;
  el.periodRow.hidden = isOnce;
  el.daysField.hidden = el.endMode.value !== "count";
  el.endDateField.hidden = el.endMode.value !== "until";

  refreshOutputs();
}

const FREQ_TEXT = {
  daily: "毎日",
  everyOtherDay: "1日おき",
  weekly: "毎週",
  once: "1回だけ",
};

const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];

function refreshOutputs() {
  updateSummary();
  updatePreview();
}

function updateSummary() {
  if (doses.length === 0) {
    el.summaryLine.textContent = "";
    return;
  }

  const times = doses.map((d) => d.time).join("・");
  let when = FREQ_TEXT[el.frequency.value];

  if (el.frequency.value === "weekly") {
    const wd = selectedWeekdays();
    when += wd.length ? `（${wd.map((i) => WEEKDAY_JP[i]).join("・")}）` : "（曜日未選択）";
  }

  let period = "";
  if (el.frequency.value !== "once") {
    if (el.endMode.value === "count") period = `・${el.days.value || "?"}日分`;
    else if (el.endMode.value === "until") period = el.endDate.value ? `・${el.endDate.value}まで` : "";
    else period = "・期限なし";
  }

  const start = C.resolveStartDate({
    frequency: el.frequency.value,
    byDays: selectedWeekdays(),
    startDate: el.startDate.value || todayStr(),
  });

  el.summaryLine.textContent = `${start} から ${when}${period} / ${times} / 予定 ${doses.length}件`;
}

function updatePreview() {
  const plan = collectPlan();
  const name = plan.medName || "（薬の名前）";
  const first = doses[0];

  el.previewTitle.textContent = C.buildTitle(name, first ? first.label : "");
  el.previewDesc.textContent = C.buildDescription({
    dosage: plan.dosage,
    notes: plan.notes,
    medName: name,
  });
}

/* ------------------------------------------------------------------ */
/* 入力内容の保存・復元                                                */
/* ------------------------------------------------------------------ */

function collectDraft() {
  return {
    medName: el.medName.value,
    dosage: el.dosage.value,
    notes: el.notes.value,
    doses,
    startDate: el.startDate.value,
    frequency: el.frequency.value,
    byDays: selectedWeekdays(),
    endMode: el.endMode.value,
    days: el.days.value,
    endDate: el.endDate.value,
    reminderMin: el.reminderMin.value,
    durationMin: el.durationMin.value,
  };
}

let saveTimer;
function saveDraft() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    chrome.storage.local.set({ draft: collectDraft() });
  }, 300);
}

function applyValues(v) {
  el.medName.value = v.medName || "";
  el.dosage.value = v.dosage || "";
  el.notes.value = v.notes || "";
  doses = Array.isArray(v.doses) ? v.doses.map((d) => ({ time: d.time, label: d.label || "" })) : [];
  // 保存時の日付が過去になっていることが多いので、今日より前なら今日に戻す
  el.startDate.value = v.startDate && v.startDate >= todayStr() ? v.startDate : todayStr();
  el.frequency.value = v.frequency || "daily";
  el.endMode.value = v.endMode || "count";
  el.days.value = v.days || 7;
  el.endDate.value = v.endDate || "";
  el.reminderMin.value = v.reminderMin ?? "0";
  el.durationMin.value = v.durationMin || 10;

  const byDays = v.byDays || [];
  el.weekdays.querySelectorAll("input").forEach((c) => {
    c.checked = byDays.includes(Number(c.value));
  });

  renderDoses();
  syncVisibility();
}

async function restoreDraft() {
  const { draft } = await chrome.storage.local.get("draft");
  applyValues(draft || {});
}

/* ------------------------------------------------------------------ */
/* 入力チェック                                                        */
/* ------------------------------------------------------------------ */

function validate() {
  el.medName.classList.remove("is-invalid");

  if (!el.medName.value.trim()) {
    el.medName.classList.add("is-invalid");
    el.medName.focus();
    return "薬の名前を入力してください";
  }
  if (doses.length === 0) return "服用タイミングを1つ以上追加してください";
  if (doses.some((d) => !d.time)) return "時刻が空のタイミングがあります";
  if (!el.startDate.value) return "開始日を選んでください";
  if (el.frequency.value === "weekly" && selectedWeekdays().length === 0) {
    return "毎週くり返す曜日を選んでください";
  }
  if (el.frequency.value !== "once" && el.endMode.value === "until") {
    if (!el.endDate.value) return "終了日を選んでください";
    if (el.endDate.value < el.startDate.value) return "終了日は開始日より後にしてください";
  }
  if (el.frequency.value !== "once" && el.endMode.value === "count" && Number(el.days.value) < 1) {
    return "日数は1以上にしてください";
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 1. カレンダーの予定作成画面を開く                                   */
/* ------------------------------------------------------------------ */

async function openInCalendar(event) {
  event.preventDefault();

  const error = validate();
  if (error) {
    toast(error, "error");
    return;
  }

  const links = C.buildTemplateUrls(collectPlan());

  try {
    // まとめて裏で開いてから先頭を表示する。
    // 1タブずつ「保存」を押していけばよい状態にする。
    const tabs = [];
    for (const link of links) {
      tabs.push(await chrome.tabs.create({ url: link.url, active: false }));
    }
    if (tabs.length) await chrome.tabs.update(tabs[0].id, { active: true });
    saveDraft();
  } catch (e) {
    toast(`タブを開けませんでした: ${e.message}`, "error");
  }
}

/* ------------------------------------------------------------------ */
/* 2. ICS ファイルの書き出し                                           */
/* ------------------------------------------------------------------ */

function exportIcs() {
  const error = validate();
  if (error) {
    toast(error, "error");
    return;
  }

  const plan = collectPlan();
  const ics = C.buildIcs(plan);
  const url = `data:text/calendar;charset=utf-8;base64,${toBase64Utf8(ics)}`;

  chrome.downloads.download(
    { url, filename: C.buildIcsFilename(), saveAs: true },
    (downloadId) => {
      if (chrome.runtime.lastError || downloadId === undefined) {
        toast(`書き出しに失敗しました: ${chrome.runtime.lastError?.message || "不明なエラー"}`, "error");
        return;
      }
      toast(`${plan.doses.length}件の予定をICSに書き出しました`, "ok");
      saveDraft();
    }
  );
}

/* ------------------------------------------------------------------ */
/* お薬リスト                                                          */
/* ------------------------------------------------------------------ */

async function saveMed() {
  const error = validate();
  if (error) {
    toast(error, "error");
    return;
  }

  const entry = { id: `med_${Date.now()}`, savedAt: Date.now(), ...collectDraft() };
  const { meds = [] } = await chrome.storage.local.get("meds");

  // 同じ薬名があれば上書きする
  const index = meds.findIndex((m) => m.medName.trim() === entry.medName.trim());
  if (index >= 0) meds[index] = { ...entry, id: meds[index].id };
  else meds.unshift(entry);

  await chrome.storage.local.set({ meds });
  await renderMeds();
  toast(index >= 0 ? "お薬リストを更新しました" : "お薬リストに保存しました", "ok");
}

async function renderMeds() {
  const { meds = [] } = await chrome.storage.local.get("meds");
  el.medList.textContent = "";

  if (meds.length === 0) {
    const p = document.createElement("p");
    p.className = "empty-note";
    p.textContent = "まだ保存された薬はありません";
    el.medList.append(p);
    return;
  }

  for (const med of meds) {
    const card = document.createElement("div");
    card.className = "history-card";

    const title = document.createElement("h3");
    title.textContent = `💊 ${med.medName}`;

    const meta = document.createElement("p");
    meta.className = "history-meta";
    const times = (med.doses || [])
      .map((d) => (d.label ? `${d.time}（${d.label}）` : d.time))
      .join("、");
    meta.textContent = [med.dosage, times].filter(Boolean).join(" ・ ") || "（タイミング未設定）";

    card.append(title, meta);

    if (med.notes) {
      const notes = document.createElement("p");
      notes.className = "history-notes";
      notes.textContent = med.notes;
      card.append(notes);
    }

    const actions = document.createElement("div");
    actions.className = "history-actions";

    const load = document.createElement("button");
    load.type = "button";
    load.className = "link-btn";
    load.textContent = "読み込む";
    load.addEventListener("click", () => {
      applyValues(med);
      saveDraft();
      document.querySelector('.tab[data-tab="form"]').click();
      toast(`「${med.medName}」を読み込みました`, "ok");
    });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "link-btn danger";
    del.textContent = "削除";
    del.addEventListener("click", async () => {
      const { meds: current = [] } = await chrome.storage.local.get("meds");
      await chrome.storage.local.set({ meds: current.filter((m) => m.id !== med.id) });
      await renderMeds();
      toast("削除しました");
    });

    actions.append(load, del);
    card.append(actions);
    el.medList.append(card);
  }
}

/* ------------------------------------------------------------------ */
/* 初期化                                                              */
/* ------------------------------------------------------------------ */

function initEvents() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("is-active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("is-active"));
      tab.classList.add("is-active");
      $(`tab-${tab.dataset.tab}`).classList.add("is-active");
      if (tab.dataset.tab === "meds") renderMeds();
    });
  });

  el.presetChips.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (chip) addDose(chip.dataset.time, chip.dataset.label);
  });

  el.addDoseBtn.addEventListener("click", () => addDose("08:00", ""));

  // 注意事項のプリセットは1行ずつ追記する
  el.noteChips.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    const line = chip.dataset.note;
    const current = el.notes.value.trim();
    if (current.split("\n").includes(line)) return;
    el.notes.value = current ? `${current}\n${line}` : line;
    refreshOutputs();
    saveDraft();
  });

  el.frequency.addEventListener("change", () => {
    syncVisibility();
    saveDraft();
  });
  el.endMode.addEventListener("change", () => {
    syncVisibility();
    saveDraft();
  });
  el.weekdays.addEventListener("change", () => {
    refreshOutputs();
    saveDraft();
  });

  [el.medName, el.dosage, el.notes, el.days, el.durationMin, el.reminderMin].forEach((node) =>
    node.addEventListener("input", () => {
      refreshOutputs();
      saveDraft();
    })
  );
  [el.startDate, el.endDate].forEach((node) =>
    node.addEventListener("change", () => {
      refreshOutputs();
      saveDraft();
    })
  );

  el.form.addEventListener("submit", openInCalendar);
  el.icsBtn.addEventListener("click", exportIcs);
  el.saveMedBtn.addEventListener("click", saveMed);
}

async function init() {
  initEvents();
  await restoreDraft();
  renderMeds();
}

init();
