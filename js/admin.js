import { supabase } from "./supabaseClient.js";
import { STUDIO_NAME } from "./config.js";
import { buildGapMessage, findSlotConflict, normalizePhone, normalizeStaff, rankCustomerPatterns, rankGapCustomers } from "./gap-fill.mjs";

document.getElementById("studio-name").textContent = STUDIO_NAME + " · Yönetim";

const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Pazartesi..Pazar
const DOW_LABELS = { 1: "Pazartesi", 2: "Salı", 3: "Çarşamba", 4: "Perşembe", 5: "Cuma", 6: "Cumartesi", 0: "Pazar" };

function dateToIso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayIsoLocal() {
  return dateToIso(new Date());
}

const loginBox = document.getElementById("login-box");
const panel = document.getElementById("panel");
const loginForm = document.getElementById("login-form");
const loginMsg = document.getElementById("login-msg");
const logoutBtn = document.getElementById("logout-btn");

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginMsg.textContent = "";
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    loginMsg.textContent = "Giriş başarısız: e-posta veya şifre hatalı.";
    loginMsg.className = "msg error";
  }
});

logoutBtn.addEventListener("click", async () => {
  await supabase.auth.signOut();
});

supabase.auth.onAuthStateChange((_event, session) => {
  if (session) {
    loginBox.hidden = true;
    panel.hidden = false;
    loadServices();
    loadWorkingHours();
    loadAppointments();
    loadBlockedSlots();
    loadCustomers();
  } else {
    loginBox.hidden = false;
    panel.hidden = true;
  }
});

// ---------- Tabs ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
  });
});

// ---------- Hizmetler ----------
const serviceList = document.getElementById("service-list");
const serviceMsg = document.getElementById("service-msg");
const serviceForm = document.getElementById("service-form");
const serviceAddMsg = document.getElementById("service-add-msg");

let allServices = [];

async function loadServices() {
  const { data, error } = await supabase
    .from("services")
    .select("id,name,duration_minutes,price,is_active,sort_order")
    .order("sort_order", { ascending: true });

  if (error) {
    serviceList.innerHTML = `<p class="empty-note">Hizmetler yüklenemedi.</p>`;
    return;
  }
  if (!data || data.length === 0) {
    serviceList.innerHTML = `<p class="empty-note">Henüz hizmet eklenmedi.</p>`;
    return;
  }

  allServices = data;
  renderManualServiceOptions();

  serviceList.innerHTML = "";
  data.forEach((s) => {
    const el = document.createElement("div");
    el.className = "service-item";
    el.dataset.id = s.id;
    el.innerHTML = `
      <div class="svc-top">
        <input type="text" class="svc-name" value="${escapeAttr(s.name)}" />
        <label class="svc-active-label"><input type="checkbox" class="svc-active" ${s.is_active ? "checked" : ""} /> Aktif</label>
      </div>
      <div class="svc-bottom">
        <label>Süre (dk)<br /><input type="number" class="svc-duration" value="${s.duration_minutes}" min="15" step="15" /></label>
        <label>Fiyat (₺)<br /><input type="number" class="svc-price" value="${s.price}" min="0" step="10" /></label>
        <button type="button" class="small-ok" data-action="save">Kaydet</button>
        <button type="button" class="small-danger" data-action="delete">Sil</button>
      </div>
    `;
    serviceList.appendChild(el);
  });
}

serviceList.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const item = btn.closest(".service-item");
  const id = item.dataset.id;

  if (btn.dataset.action === "delete") {
    if (!confirm("Bu hizmeti silmek istediğinize emin misiniz?")) return;
    btn.disabled = true;
    const { error } = await supabase.from("services").delete().eq("id", id);
    if (!error) loadServices();
    return;
  }

  if (btn.dataset.action === "save") {
    btn.disabled = true;
    const name = item.querySelector(".svc-name").value.trim();
    const duration = Number(item.querySelector(".svc-duration").value);
    const price = Number(item.querySelector(".svc-price").value);
    const isActive = item.querySelector(".svc-active").checked;

    const { error } = await supabase
      .from("services")
      .update({ name, duration_minutes: duration, price, is_active: isActive })
      .eq("id", id);

    btn.disabled = false;
    serviceMsg.textContent = error ? "Kaydedilemedi: " + error.message : "Kaydedildi.";
    serviceMsg.className = error ? "msg error" : "msg success";
  }
});

serviceForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  serviceAddMsg.textContent = "";
  const name = document.getElementById("svc-new-name").value.trim();
  const duration = Number(document.getElementById("svc-new-duration").value);
  const price = Number(document.getElementById("svc-new-price").value);

  const { count } = await supabase.from("services").select("id", { count: "exact", head: true });

  const { error } = await supabase.from("services").insert({
    name,
    duration_minutes: duration,
    price,
    sort_order: (count || 0) + 1,
  });

  if (error) {
    serviceAddMsg.textContent = "Eklenemedi: " + error.message;
    serviceAddMsg.className = "msg error";
  } else {
    serviceForm.reset();
    document.getElementById("svc-new-duration").value = 60;
    document.getElementById("svc-new-price").value = 0;
    serviceAddMsg.textContent = "Hizmet eklendi.";
    serviceAddMsg.className = "msg success";
    loadServices();
  }
});

// ---------- Çalışma Saatleri ----------
const hoursList = document.getElementById("hours-list");
const hoursMsg = document.getElementById("hours-msg");

async function loadWorkingHours() {
  const { data, error } = await supabase
    .from("working_hours")
    .select("weekday,is_open,start_time,end_time,slot_minutes");
  if (error) {
    hoursMsg.textContent = "Saatler yüklenemedi.";
    hoursMsg.className = "msg error";
    return;
  }
  const byDay = {};
  data.forEach((r) => (byDay[r.weekday] = r));
  workingHoursByDay = byDay;
  renderDaySlots();

  hoursList.innerHTML = "";
  DOW_ORDER.forEach((weekday) => {
    const row = byDay[weekday] || { weekday, is_open: false, start_time: "10:00", end_time: "19:00", slot_minutes: 60 };
    const el = document.createElement("div");
    el.className = "hour-row";
    el.dataset.weekday = weekday;
    el.innerHTML = `
      <span>${DOW_LABELS[weekday]}</span>
      <label style="margin:0"><input type="checkbox" class="is-open" ${row.is_open ? "checked" : ""} /></label>
      <input type="time" class="start-time" value="${(row.start_time || "10:00").slice(0, 5)}" />
      <input type="time" class="end-time" value="${(row.end_time || "19:00").slice(0, 5)}" />
      <select class="slot-len">
        ${[15, 30, 45, 60, 90, 120].map((m) => `<option value="${m}" ${row.slot_minutes === m ? "selected" : ""}>${m} dk arayla randevu</option>`).join("")}
      </select>
    `;
    hoursList.appendChild(el);
  });
}

document.getElementById("save-hours").addEventListener("click", async () => {
  hoursMsg.textContent = "";
  const rows = [...hoursList.querySelectorAll(".hour-row")].map((el) => ({
    weekday: Number(el.dataset.weekday),
    is_open: el.querySelector(".is-open").checked,
    start_time: el.querySelector(".start-time").value,
    end_time: el.querySelector(".end-time").value,
    slot_minutes: Number(el.querySelector(".slot-len").value),
  }));

  const { error } = await supabase.from("working_hours").upsert(rows, { onConflict: "weekday" });
  if (error) {
    hoursMsg.textContent = "Kaydedilemedi: " + error.message;
    hoursMsg.className = "msg error";
  } else {
    hoursMsg.textContent = "Çalışma saatleri kaydedildi.";
    hoursMsg.className = "msg success";
  }
});

// ---------- Randevular ----------
const apptList = document.getElementById("appt-list");
const apptListTitle = document.getElementById("appt-list-title");
const apptShowAllBtn = document.getElementById("appt-show-all");
const adminCalGrid = document.getElementById("admin-cal-grid");
const adminCalMonthLabel = document.getElementById("admin-cal-month-label");
const adminCalPrevBtn = document.getElementById("admin-cal-prev");
const adminCalNextBtn = document.getElementById("admin-cal-next");
const apptShowArchiveBtn = document.getElementById("appt-show-archive");

let allAppointments = [];
let showAllAppointments = false;
let apptCalMonth = new Date(new Date().setDate(1));
let apptFilterDate = null; // 'YYYY-MM-DD' ya da null (hepsi)
let editingAppointment = null;

const apptEditDialog = document.getElementById("appt-edit-dialog");
const apptEditForm = document.getElementById("appt-edit-form");
const apptEditMessage = document.getElementById("appt-edit-msg");
const apptEditService = document.getElementById("appt-edit-service");
const gapFillLaunch = document.getElementById("gap-fill-launch");
const gapFillLaunchTitle = document.getElementById("gap-fill-launch-title");
const gapFillLaunchDetails = document.getElementById("gap-fill-launch-details");
const gapFillOpenBtn = document.getElementById("gap-fill-open");
const gapFillDialog = document.getElementById("gap-fill-dialog");
const gapFillForm = document.getElementById("gap-fill-form");
const gapFillService = document.getElementById("gap-fill-service");
const gapFillMessage = document.getElementById("gap-fill-msg");
const gapFillSummary = document.getElementById("gap-fill-summary");
const gapFillResults = document.getElementById("gap-fill-results");
const gapMessagePanel = document.getElementById("gap-message-panel");
const gapMessageText = document.getElementById("gap-message-text");
const gapMessageStatus = document.getElementById("gap-message-msg");
const gapMessageContactedBtn = document.getElementById("gap-message-contacted");
const customerPatternsOpenBtn = document.getElementById("customer-patterns-open");
const customerPatternsDialog = document.getElementById("customer-patterns-dialog");
const customerPatternsSummary = document.getElementById("customer-patterns-summary");
const customerPatternsResults = document.getElementById("customer-patterns-results");
const customerPatternsMessage = document.getElementById("customer-patterns-message");
let selectedGapSlot = null;
let activeGapCandidate = null;
let gapCandidates = [];

async function loadAppointments() {
  apptList.innerHTML = `<p class="empty-note">Yükleniyor…</p>`;
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("appointments")
      .select("id,appt_date,appt_time,duration_minutes,customer_name,customer_phone,note,status,service_id,service_name,service_price,staff_name")
      .order("appt_date", { ascending: true })
      .order("appt_time", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      apptList.innerHTML = `<p class="empty-note">Randevular yüklenemedi.</p>`;
      return;
    }

    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }

  allAppointments = rows;
  renderApptCalendar();
  renderApptList();
  renderDaySlots();
}

// ---------- Takvimden gün/saat seçip elle randevu ----------
let workingHoursByDay = {};
const daySlotsBox = document.getElementById("admin-day-slots");

const toMin = (t) => { const [h, m] = t.slice(0, 5).split(":").map(Number); return h * 60 + m; };
const toTime = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Formda seçili hizmetlerin toplam süresi (dk). */
function selectedTotalDuration() {
  const selects = [manualServiceSelect, ...document.querySelectorAll("#manual-extra-services select")];
  return selects.reduce((sum, sel) => sum + (allServices.find((s) => s.id === sel.value)?.duration_minutes || 0), 0) || 60;
}

function showGapFillLaunch(slot) {
  selectedGapSlot = { ...slot };
  const date = new Date(`${slot.date}T12:00:00`);
  gapFillLaunchTitle.textContent = "Bu boş saat için müşteri önerileri hazırla";
  gapFillLaunchDetails.textContent = [
    date.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" }),
    slot.time,
    slot.staffName || "Personel seçilmedi",
    slot.serviceName || "Hizmet seçilmedi",
    `${slot.durationMinutes} dk`,
  ].join(" · ");
  gapFillLaunch.hidden = false;
}

function clearGapFillLaunch() {
  selectedGapSlot = null;
  gapFillLaunch.hidden = true;
}

function renderDaySlots() {
  if (!daySlotsBox) return;
  const iso = apptFilterDate;
  if (!iso) { daySlotsBox.innerHTML = ""; clearGapFillLaunch(); return; }
  clearGapFillLaunch();

  const [y, mo, d] = iso.split("-").map(Number);
  const dateObj = new Date(y, mo - 1, d);
  const title = `<h3 class="day-slots-title">${d} ${CAL_MONTH_LABELS[mo - 1]} · randevu eklemek için saate dokunun</h3>`;
  const hours = workingHoursByDay[dateObj.getDay()];
  const fullDayBlock = allBlocks.some((b) => b.block_date === iso && !b.start_time);

  if (!hours || !hours.is_open || fullDayBlock) {
    daySlotsBox.innerHTML = title + `<p class="empty-note">Bu gün kapalı. Yine de randevu eklemek isterseniz saati aşağıdaki formdan elle girin.</p>`;
    return;
  }

  const duration = selectedTotalDuration();
  const ranges = [
    ...allAppointments.filter((a) => a.appt_date === iso)
      .filter((a) => a.status !== "cancelled")
      .map((a) => ({ start: toMin(a.appt_time), end: toMin(a.appt_time) + (a.duration_minutes || 0) })),
    ...allBlocks.filter((b) => b.block_date === iso && b.start_time)
      .map((b) => ({ start: toMin(b.start_time), end: toMin(b.end_time) })),
  ];

  const now = new Date();
  const nowMin = iso === todayIsoLocal() ? now.getHours() * 60 + now.getMinutes() : -1;
  const startMin = toMin(hours.start_time), endMin = toMin(hours.end_time);

  daySlotsBox.innerHTML = title + `<p class="empty-note">Seçili hizmet(ler)in toplam süresi: ${duration} dk. Dolu saatler üstü çizili.</p>`;
  const grid = document.createElement("div");
  grid.className = "slot-grid";
  for (let m = startMin; m + duration <= endMin; m += hours.slot_minutes) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "slot-btn";
    btn.textContent = toTime(m);
    btn.disabled = m <= nowMin || ranges.some((r) => m < r.end && m + duration > r.start);
    btn.addEventListener("click", () => {
      document.getElementById("manual-date").value = iso;
      document.getElementById("manual-time").value = toTime(m);
      const service = allServices.find((item) => item.id === manualServiceSelect.value);
      showGapFillLaunch({
        date: iso,
        time: toTime(m),
        staffName: "",
        serviceId: service?.id || "",
        serviceName: service?.name || "",
        durationMinutes: selectedTotalDuration(),
      });
      grid.querySelectorAll(".slot-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      manualApptForm.scrollIntoView({ behavior: "smooth", block: "start" });
      manualNameInput.focus({ preventScroll: true });
    });
    grid.appendChild(btn);
  }
  if (!grid.children.length) grid.innerHTML = `<p class="empty-note">Bu gün uygun saat yok.</p>`;
  daySlotsBox.appendChild(grid);
}

function renderApptList() {
  const data = apptFilterDate
    ? allAppointments.filter((a) => a.appt_date === apptFilterDate)
    : showAllAppointments
      ? allAppointments
      : allAppointments.filter((a) => a.appt_date >= todayIsoLocal() && a.status !== "cancelled");
  const dayBlocks = apptFilterDate
    ? allBlocks.filter((b) => b.block_date === apptFilterDate)
    : [];

  if (apptFilterDate) {
    const dateObj = new Date(apptFilterDate + "T00:00:00");
    apptListTitle.textContent = dateObj.toLocaleDateString("tr-TR", { day: "numeric", month: "long" });
    apptShowAllBtn.hidden = false;
  } else {
    apptListTitle.textContent = showAllAppointments ? "Tüm Randevular" : "Yaklaşan Randevular";
    apptShowAllBtn.hidden = true;
  }

  if (data.length === 0 && dayBlocks.length === 0) {
    apptList.innerHTML = `<p class="empty-note">${apptFilterDate ? "Bu günde randevu yok." : "Yaklaşan randevu yok."}</p>`;
    return;
  }

  apptList.innerHTML = "";

  // Aynı müşterinin (telefon numarasına göre) aynı gündeki randevularını grupla
  const groups = groupSameDayAppointments(allAppointments);
  const shownGroups = new Set();

  dayBlocks.forEach((b) => {
    const timeStr = b.start_time ? `${b.start_time.slice(0, 5)}–${b.end_time.slice(0, 5)}` : "Tüm gün";
    const el = document.createElement("div");
    el.className = "appt-item";
    el.innerHTML = `
      <div>
        <div class="who">${escapeHtml(b.reason || "Kapatma")}</div>
        <div class="when">${timeStr}${b.source === "google" ? " · Google Takvim" : ""}</div>
      </div>
      <div class="appt-actions">
        <span class="badge cancelled">Kapatma</span>
        <button class="small-danger" data-action="delete-block" data-id="${b.id}">Kaldır</button>
      </div>
    `;
    apptList.appendChild(el);
  });

  data.forEach((appt) => {
    const dateObj = new Date(appt.appt_date + "T00:00:00");
    const dateStr = dateObj.toLocaleDateString("tr-TR", { day: "numeric", month: "long" });
    const appointmentDetails = [
      `${dateStr}, ${appt.appt_time.slice(0, 5)}`,
      appt.service_name ? escapeHtml(appt.service_name) : "",
      appt.staff_name ? `Uzman: ${escapeHtml(appt.staff_name)}` : "",
      appt.note ? escapeHtml(appt.note) : "",
    ].filter(Boolean).join(" · ");
    const groupKey = sameDayGroupKey(appt);
    const group = groups.get(groupKey) || [];
    // Toplu butonlar, grubun sadece ilk randevusunda gösterilir
    const showGroupButtons = appt.status !== "cancelled" && group.length > 1 && !shownGroups.has(groupKey);
    if (showGroupButtons) shownGroups.add(groupKey);
    const el = document.createElement("div");
    el.className = "appt-item";
    el.dataset.appointmentId = appt.id;
    el.tabIndex = 0;
    el.setAttribute("aria-label", `${appt.customer_name}, ${dateStr} ${appt.appt_time.slice(0, 5)}. Düzenlemek için karta tıklayın.`);
    el.innerHTML = `
      <div>
        <div class="who">${escapeHtml(appt.customer_name)} · ${escapeHtml(appt.customer_phone)}</div>
        <div class="when">${appointmentDetails}</div>
      </div>
      <div class="appt-actions">
        <button class="small-edit" data-action="edit" data-id="${appt.id}">Düzenle</button>
        <span class="badge ${appt.status}">${statusLabel(appt.status)}</span>
        ${appt.status === "pending" ? `<button class="small-ok" data-action="confirm" data-id="${appt.id}">Onayla</button>` : ""}
        <button class="small-danger" data-action="cancel" data-id="${appt.id}">Randevuyu iptal et</button>
        <button
          class="small-whatsapp"
          data-action="wa-confirm"
          data-phone="${escapeAttr(appt.customer_phone)}"
          data-name="${escapeAttr(appt.customer_name)}"
          data-service="${escapeAttr(appt.service_name || "")}"
          data-date="${dateStr}"
          data-time="${appt.appt_time.slice(0, 5)}">
          WhatsApp: Onay
        </button>
        <button
          class="small-whatsapp"
          data-action="wa-remind"
          data-phone="${escapeAttr(appt.customer_phone)}"
          data-name="${escapeAttr(appt.customer_name)}"
          data-service="${escapeAttr(appt.service_name || "")}"
          data-date="${dateStr}"
          data-time="${appt.appt_time.slice(0, 5)}">
          WhatsApp: Hatırlatma
        </button>
        ${showGroupButtons ? `
        <button class="small-whatsapp" data-action="wa-confirm-all" data-group="${escapeAttr(groupKey)}">
          WhatsApp: Tüm Randevular Onay (${group.length})
        </button>
        <button class="small-whatsapp" data-action="wa-remind-all" data-group="${escapeAttr(groupKey)}">
          WhatsApp: Tüm Randevular Hatırlatma (${group.length})
        </button>` : ""}
      </div>
    `;
    apptList.appendChild(el);
  });
}

function sameDayGroupKey(appt) {
  return `${appt.appt_date}|${toWhatsAppNumber(appt.customer_phone)}`;
}

/** İptal edilmemiş randevuları "gün + telefon" anahtarına göre saat sırasıyla gruplar. */
function groupSameDayAppointments(appts) {
  const groups = new Map();
  appts
    .filter((a) => a.status !== "cancelled")
    .sort((a, b) => a.appt_time.localeCompare(b.appt_time))
    .forEach((a) => {
      const key = sameDayGroupKey(a);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(a);
    });
  return groups;
}

function statusLabel(s) {
  return { pending: "Bekliyor", confirmed: "Onaylandı", cancelled: "İptal" }[s] || s;
}

const CAL_MONTH_LABELS = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];
const CAL_DOW_LABELS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

function renderApptCalendar() {
  const apptDates = new Set([
    ...allAppointments.map((a) => a.appt_date),
    ...allBlocks.map((b) => b.block_date),
  ]);
  const todayIso = todayIsoLocal();

  const year = apptCalMonth.getFullYear();
  const month = apptCalMonth.getMonth();
  adminCalMonthLabel.textContent = `${CAL_MONTH_LABELS[month]} ${year}`;

  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7; // Pazartesi=0
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  adminCalGrid.innerHTML = "";
  CAL_DOW_LABELS.forEach((label) => {
    const el = document.createElement("div");
    el.className = "dow";
    el.textContent = label;
    adminCalGrid.appendChild(el);
  });

  for (let i = 0; i < startOffset; i++) {
    const el = document.createElement("div");
    el.className = "cal-day empty";
    adminCalGrid.appendChild(el);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(year, month, d);
    const iso = dateToIso(dateObj);
    const el = document.createElement("button");
    el.type = "button";
    el.className = "cal-day available";
    el.textContent = String(d);

    if (iso === todayIso) el.classList.add("today");
    if (apptDates.has(iso)) el.classList.add("has-appt");
    if (iso === apptFilterDate) el.classList.add("selected");

    el.addEventListener("click", () => {
      apptFilterDate = apptFilterDate === iso ? null : iso;
      if (apptFilterDate) document.getElementById("manual-date").value = iso;
      renderApptCalendar();
      renderApptList();
      renderDaySlots();
    });

    adminCalGrid.appendChild(el);
  }
}

adminCalPrevBtn.addEventListener("click", () => {
  apptCalMonth = new Date(apptCalMonth.getFullYear(), apptCalMonth.getMonth() - 1, 1);
  renderApptCalendar();
});

adminCalNextBtn.addEventListener("click", () => {
  apptCalMonth = new Date(apptCalMonth.getFullYear(), apptCalMonth.getMonth() + 1, 1);
  renderApptCalendar();
});

apptShowArchiveBtn.addEventListener("click", () => {
  showAllAppointments = !showAllAppointments;
  apptFilterDate = null;
  apptShowArchiveBtn.textContent = showAllAppointments ? "Yaklaşan randevular" : "Geçmiş / İptal";
  renderApptCalendar();
  renderApptList();
  renderDaySlots();
});

apptShowAllBtn.addEventListener("click", () => {
  apptFilterDate = null;
  renderApptCalendar();
  renderApptList();
});

apptList.addEventListener("click", async (e) => {
  const appointmentCard = e.target.closest(".appt-item[data-appointment-id]");
  const btn = e.target.closest("button[data-action]");
  if (!btn) {
    if (appointmentCard) openAppointmentEditor(appointmentCard.dataset.appointmentId);
    return;
  }
  const action = btn.dataset.action;

  if (action === "edit") {
    await openAppointmentEditor(btn.dataset.id);
    return;
  }

  if (action === "wa-confirm" || action === "wa-remind") {
    openWhatsAppMessage(action, btn.dataset);
    return;
  }

  if (action === "wa-confirm-all" || action === "wa-remind-all") {
    const group = groupSameDayAppointments(allAppointments).get(btn.dataset.group);
    if (group && group.length > 0) openWhatsAppGroupMessage(action, group);
    return;
  }

  if (action === "delete-block") {
    btn.disabled = true;
    const { error } = await supabase.from("blocked_slots").delete().eq("id", btn.dataset.id);
    if (!error) loadBlockedSlots();
    return;
  }

  const id = btn.dataset.id;
  const status = action === "confirm" ? "confirmed" : "cancelled";
  if (status === "cancelled" && !confirm("Bu randevuyu iptal etmek istediğinize emin misiniz? Randevu silinmez, iptal durumuna alınır.")) return;
  const appointmentToCancel = status === "cancelled" ? allAppointments.find((appointment) => appointment.id === id) : null;
  btn.disabled = true;
  const { error } = await supabase.from("appointments").update({ status }).eq("id", id);
  if (!error) {
    if (appointmentToCancel) {
      apptFilterDate = appointmentToCancel.appt_date;
      apptCalMonth = new Date(`${appointmentToCancel.appt_date}T00:00:00`);
      showAllAppointments = true;
      apptShowArchiveBtn.textContent = "Yaklaşan randevular";
    }
    await loadAppointments();
    if (appointmentToCancel) showGapFillLaunch({
      date: appointmentToCancel.appt_date,
      time: appointmentToCancel.appt_time.slice(0, 5),
      staffName: appointmentToCancel.staff_name || "",
      serviceId: appointmentToCancel.service_id || "",
      serviceName: appointmentToCancel.service_name || "",
      durationMinutes: appointmentToCancel.duration_minutes || 60,
    });
  }
});

gapFillOpenBtn.addEventListener("click", async () => {
  if (!selectedGapSlot) return;
  if (allServices.length === 0) await loadServices();
  const activeServices = allServices.filter((service) => service.is_active);
  gapFillService.innerHTML = `<option value="">Hizmet seçin</option>` + activeServices
    .map((service) => `<option value="${escapeAttr(service.id)}">${escapeHtml(service.name)} · ${service.duration_minutes} dk</option>`)
    .join("");

  document.getElementById("gap-fill-date").value = selectedGapSlot.date;
  document.getElementById("gap-fill-time").value = selectedGapSlot.time;
  document.getElementById("gap-fill-staff").value = selectedGapSlot.staffName || "";
  document.getElementById("gap-fill-duration").value = selectedGapSlot.durationMinutes || 60;
  gapFillService.value = selectedGapSlot.serviceId || "";
  gapFillMessage.textContent = selectedGapSlot.staffName ? "" : "Personel/uzman bilgisini girin; uygunluk bu atamaya göre kontrol edilecek.";
  gapFillMessage.className = selectedGapSlot.staffName ? "msg" : "msg error";
  gapFillSummary.textContent = "";
  gapFillResults.innerHTML = "";
  gapMessagePanel.hidden = true;
  gapFillDialog.showModal();
});

document.getElementById("gap-fill-close").addEventListener("click", () => gapFillDialog.close());
gapFillDialog.addEventListener("click", (event) => {
  if (event.target === gapFillDialog) gapFillDialog.close();
});
gapFillService.addEventListener("change", () => {
  const service = allServices.find((item) => item.id === gapFillService.value);
  if (service) document.getElementById("gap-fill-duration").value = service.duration_minutes;
});

function invalidateGapResults() {
  gapCandidates = [];
  selectedGapSlot = null;
  gapFillSummary.textContent = "Saat bilgisi değişti; önerileri güncellemek için yeniden arayın.";
  gapFillResults.innerHTML = "";
  gapMessagePanel.hidden = true;
  gapMessageStatus.textContent = "";
}

gapFillForm.addEventListener("input", invalidateGapResults);
gapFillForm.addEventListener("change", invalidateGapResults);

async function loadGapSnapshot() {
  const appointments = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("appointments")
      .select("id,appt_date,appt_time,duration_minutes,customer_name,customer_phone,status,service_id,service_name,service_price,staff_name")
      .order("appt_date", { ascending: true })
      .order("appt_time", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error("Randevu geçmişi okunamadı: " + error.message);
    appointments.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }

  const slotDate = document.getElementById("gap-fill-date").value;
  const slotTime = document.getElementById("gap-fill-time").value;
  const staffKey = normalizeStaff(document.getElementById("gap-fill-staff").value);
  const [{ data: blockedSlots, error: blockError }, { data: contacts, error: contactError }] = await Promise.all([
    supabase.from("blocked_slots").select("block_date,start_time,end_time").eq("block_date", slotDate),
    supabase.from("appointment_gap_contacts").select("slot_date,slot_time,staff_key,phone_key")
      .eq("slot_date", slotDate).eq("slot_time", slotTime).eq("staff_key", staffKey),
  ]);
  if (blockError) throw new Error("Özel kapatmalar okunamadı: " + blockError.message);
  if (contactError) throw new Error("İletişim takip tablosu bulunamadı. Önce sql/05_ai_gap_fill.sql migration dosyasını Supabase'de çalıştırın.");
  return { appointments, blockedSlots: blockedSlots || [], contacts: contacts || [] };
}

function renderCustomerPatterns(patterns) {
  customerPatternsSummary.textContent = patterns.length
    ? `${patterns.length} müşterinin randevu geçmişi karşılaştırıldı. Liste, geçmiş randevu döngüsüne göre sıralıdır.`
    : "Karşılaştırma için yeterli geçmiş randevu kaydı bulunamadı.";

  customerPatternsResults.innerHTML = patterns.map((pattern) => {
    const confidenceClass = pattern.confidence === "Yüksek" ? "high" : "";
    const facts = [
      `${pattern.appointmentDayCount} farklı randevu günü · ${pattern.appointmentRecordCount} kayıt`,
      `Son randevu kaydı: ${pattern.daysSinceLastAppointment} gün önce`,
      pattern.typicalIntervalDays ? `Tipik aralık: ${pattern.typicalIntervalDays} gün` : "Aralık için tekrar verisi yok",
      pattern.preferredService ? `Sık aldığı hizmet: ${escapeHtml(pattern.preferredService)}` : "Hizmet tercihi: veri yok",
      pattern.preferredStaff ? `Sık tercih ettiği uzman: ${escapeHtml(pattern.preferredStaff)}` : "Uzman tercihi: veri yok",
      pattern.preferredWeekday ? `Sık geldiği gün: ${escapeHtml(pattern.preferredWeekday)}` : "Gün tercihi: veri yok",
      pattern.preferredHours ? `Geçmiş saat aralığı: ${pattern.preferredHours}` : "Saat tercihi: veri yok",
      pattern.averageSpendPerVisit !== null ? `Kayıtlı hizmet tutarı ortalaması: ${formatPrice(pattern.averageSpendPerVisit)}` : "Hizmet fiyatı geçmişi: veri yok",
      `İptal kaydı: ${pattern.cancellationCount}`,
    ];
    const followup = pattern.typicalIntervalDays
      ? `${pattern.daysSinceLastAppointment} gün geçti · tipik ${pattern.typicalIntervalDays} günlük aralığa göre ${pattern.followUpStatus.toLocaleLowerCase("tr-TR")}.`
      : "Tekrarlı ziyaret aralığını hesaplamak için yeterli geçmiş yok.";

    return `<article class="gap-candidate customer-pattern-card">
      <div class="gap-candidate-header">
        <div><h3>${escapeHtml(pattern.customerName)}</h3><span class="gap-confidence ${confidenceClass}">${pattern.confidence} güven</span></div>
        <div class="customer-pattern-status">${escapeHtml(pattern.followUpStatus)}</div>
      </div>
      <p class="customer-pattern-followup">${escapeHtml(followup)}</p>
      <div class="gap-candidate-facts">${facts.map((fact) => `<span>${fact}</span>`).join("")}</div>
      <p class="empty-note">Bu, randevu kayıtlarına dayalı karşılaştırmadır; gerçek katılım, tahsilat veya müşterinin şu an müsait olduğu bilgisi tutulmuyor.</p>
    </article>`;
  }).join("");
}

customerPatternsOpenBtn.addEventListener("click", () => {
  customerPatternsMessage.textContent = "";
  customerPatternsMessage.className = "msg";
  customerPatternsResults.innerHTML = `<p class="empty-note">Müşteri randevu geçmişi karşılaştırılıyor…</p>`;
  renderCustomerPatterns(rankCustomerPatterns({ appointments: allAppointments, asOfDate: todayIsoLocal() }));
  customerPatternsDialog.showModal();
});

document.getElementById("customer-patterns-close").addEventListener("click", () => customerPatternsDialog.close());
customerPatternsDialog.addEventListener("click", (event) => {
  if (event.target === customerPatternsDialog) customerPatternsDialog.close();
});

function renderGapCandidates(candidates, slot) {
  gapFillResults.innerHTML = candidates.map((candidate) => {
    const lastDate = new Date(`${candidate.lastAppointmentDate}T12:00:00`).toLocaleDateString("tr-TR", { day: "numeric", month: "long" });
    const confidenceClass = candidate.confidence === "Yüksek" ? "high" : "";
    const facts = [
      `Son randevu kaydı: ${candidate.daysSinceLastAppointment} gün önce (${lastDate})`,
      candidate.typicalIntervalDays ? `Tipik aralık: ${candidate.typicalIntervalDays} gün` : "Aralık tahmini için yeterli kayıt yok",
      candidate.preferredStaff ? `Sık tercih ettiği uzman: ${escapeHtml(candidate.preferredStaff)}` : "Uzman tercihi için veri yok",
      candidate.averageSpend ? `Geçmiş ortalama harcama: ${formatPrice(candidate.averageSpend)}` : "Fiyat geçmişi yok",
    ];
    const reasons = candidate.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("");
    return `<article class="gap-candidate" data-phone-key="${escapeAttr(candidate.phoneKey)}">
      <div class="gap-candidate-header">
        <div><h3>${escapeHtml(candidate.customerName)}</h3><span class="gap-confidence ${confidenceClass}">${candidate.confidence} güven · ${candidate.historyCount} geçmiş kayıt</span></div>
        <div class="gap-candidate-score"><strong>${candidate.score}%</strong><span>uygunluk</span></div>
      </div>
      <div class="gap-candidate-facts">${facts.map((fact) => `<span>${fact}</span>`).join("")}</div>
      <ul class="gap-candidate-reasons">${reasons}</ul>
      <div class="gap-candidate-actions"><button type="button" class="small-edit" data-gap-action="compose" data-phone-key="${escapeAttr(candidate.phoneKey)}">Mesaj oluştur</button></div>
    </article>`;
  }).join("");
  gapFillSummary.textContent = candidates.length
    ? `Bu saat için ${candidates.length} uygun müşteri bulduk. Uygunluk, mevcut geçmiş kayıtlarından hesaplandı.`
    : "Bu boş saat için yeterli geçmişi olan uygun müşteri bulunamadı.";
}

gapFillForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  gapFillMessage.textContent = "";
  gapFillSummary.textContent = "";
  gapFillResults.innerHTML = "";
  gapMessagePanel.hidden = true;

  const date = document.getElementById("gap-fill-date").value;
  const time = document.getElementById("gap-fill-time").value;
  const staffName = document.getElementById("gap-fill-staff").value.trim();
  const service = allServices.find((item) => item.id === gapFillService.value);
  const durationMinutes = Number(document.getElementById("gap-fill-duration").value);
  if (!date || !time || !staffName || !service || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) {
    gapFillMessage.textContent = "Tarih, saat, personel, hizmet ve geçerli süre girin.";
    gapFillMessage.className = "msg error";
    return;
  }

  const currentTime = new Date();
  const currentMinute = currentTime.getHours() * 60 + currentTime.getMinutes();
  if (date < todayIsoLocal() || (date === todayIsoLocal() && timeToMinutes(time) <= currentMinute)) {
    gapFillMessage.textContent = "Geçmiş tarih veya saat için müşteri önerisi oluşturulamaz.";
    gapFillMessage.className = "msg error";
    return;
  }

  const slot = { date, time, staffName, serviceId: service.id, serviceName: service.name, durationMinutes };
  const searchButton = document.getElementById("gap-fill-search");
  searchButton.disabled = true;
  gapFillMessage.textContent = "Mevcut randevu geçmişi analiz ediliyor…";
  gapFillMessage.className = "msg";

  try {
    const snapshot = await loadGapSnapshot();
    const conflict = findSlotConflict({ ...snapshot, slot });
    if (conflict) throw new Error(conflict);
    gapCandidates = rankGapCustomers({ ...snapshot, slot });
    selectedGapSlot = slot;
    renderGapCandidates(gapCandidates, slot);
    gapFillMessage.textContent = "Skorlar yalnızca geçmiş randevu kayıtlarından hesaplanır. Katılım/no-show verisi mevcut olmadığı için tahmin yapılmaz.";
    gapFillMessage.className = "msg";
  } catch (error) {
    gapFillMessage.textContent = error instanceof Error ? error.message : "Müşteri önerileri alınamadı.";
    gapFillMessage.className = "msg error";
  } finally {
    searchButton.disabled = false;
  }
});

let gapMessageIsEditing = false;
gapFillResults.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-gap-action='compose']");
  if (!button) return;
  activeGapCandidate = gapCandidates.find((candidate) => candidate.phoneKey === button.dataset.phoneKey);
  if (!activeGapCandidate || !selectedGapSlot) return;
  gapMessageText.value = buildGapMessage({ candidate: activeGapCandidate, slot: selectedGapSlot, studioName: STUDIO_NAME });
  gapMessageText.readOnly = true;
  gapMessageIsEditing = false;
  document.getElementById("gap-message-edit").textContent = "Mesajı Düzenle";
  gapMessageStatus.textContent = "";
  gapMessageContactedBtn.hidden = true;
  gapMessagePanel.hidden = false;
  gapMessagePanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
});

document.getElementById("gap-message-edit").addEventListener("click", () => {
  gapMessageIsEditing = !gapMessageIsEditing;
  gapMessageText.readOnly = !gapMessageIsEditing;
  document.getElementById("gap-message-edit").textContent = gapMessageIsEditing ? "Düzenlemeyi bitir" : "Mesajı Düzenle";
  if (gapMessageIsEditing) gapMessageText.focus();
});

document.getElementById("gap-message-cancel").addEventListener("click", () => {
  activeGapCandidate = null;
  gapMessagePanel.hidden = true;
  gapMessageStatus.textContent = "";
});

document.getElementById("gap-message-whatsapp").addEventListener("click", async () => {
  if (!activeGapCandidate || !selectedGapSlot) return;
  const phoneDigits = activeGapCandidate.customerPhone.replace(/\D/g, "");
  if (phoneDigits.length < 10) {
    gapMessageStatus.textContent = "Müşterinin geçerli telefon numarası bulunmuyor.";
    gapMessageStatus.className = "msg error";
    return;
  }

  const whatsappWindow = window.open("about:blank", "_blank");
  if (!whatsappWindow) {
    gapMessageStatus.textContent = "WhatsApp penceresi açılamadı; tarayıcı açılır penceresini engellemiş olabilir.";
    gapMessageStatus.className = "msg error";
    return;
  }

  try {
    const snapshot = await loadGapSnapshot();
    const conflict = findSlotConflict({ ...snapshot, slot: selectedGapSlot });
    const candidateStillAvailable = rankGapCustomers({ ...snapshot, slot: selectedGapSlot })
      .some((candidate) => candidate.phoneKey === activeGapCandidate.phoneKey);
    if (conflict || !candidateStillAvailable) {
      whatsappWindow.close();
      gapMessageStatus.textContent = conflict || "Bu müşteriyle bu boş saat için daha önce iletişim kurulmuş ya da artık uygun değil.";
      gapMessageStatus.className = "msg error";
      return;
    }

    let internationalPhone = phoneDigits;
    if (internationalPhone.startsWith("0")) internationalPhone = internationalPhone.slice(1);
    if (!internationalPhone.startsWith("90")) internationalPhone = "90" + internationalPhone;
    whatsappWindow.location.href = `https://wa.me/${internationalPhone}?text=${encodeURIComponent(gapMessageText.value)}`;
    gapMessageContactedBtn.hidden = false;
    gapMessageStatus.textContent = "Mesaj WhatsApp taslağı olarak açıldı; otomatik gönderilmedi. Gönderdiyseniz iletişim kaydını işaretleyin.";
    gapMessageStatus.className = "msg success";
  } catch (error) {
    whatsappWindow.close();
    gapMessageStatus.textContent = error instanceof Error ? error.message : "Boş saat yeniden kontrol edilemedi.";
    gapMessageStatus.className = "msg error";
  }
});

gapMessageContactedBtn.addEventListener("click", async () => {
  if (!activeGapCandidate || !selectedGapSlot) return;
  gapMessageContactedBtn.disabled = true;
  const { error } = await supabase.from("appointment_gap_contacts").upsert({
    slot_date: selectedGapSlot.date,
    slot_time: selectedGapSlot.time,
    staff_key: normalizeStaff(selectedGapSlot.staffName),
    phone_key: activeGapCandidate.phoneKey,
    customer_name: activeGapCandidate.customerName,
    service_name: selectedGapSlot.serviceName,
  }, { onConflict: "slot_date,slot_time,staff_key,phone_key" });
  gapMessageContactedBtn.disabled = false;

  if (error) {
    gapMessageStatus.textContent = "İletişim kaydedilemedi: " + error.message;
    gapMessageStatus.className = "msg error";
    return;
  }
  gapMessageStatus.textContent = "Bu müşteri aynı boşluk için tekrar önerilmeyecek.";
  gapMessageStatus.className = "msg success";
  await gapFillForm.requestSubmit();
});

document.getElementById("gap-fill-close").addEventListener("click", () => gapFillDialog.close());
gapFillDialog.addEventListener("click", (event) => {
  if (event.target === gapFillDialog) gapFillDialog.close();
});

function clearAppointmentEditor() {
  editingAppointment = null;
  apptEditForm.reset();
  apptEditMessage.textContent = "";
  apptEditMessage.className = "msg";
}

async function openAppointmentEditor(id) {
  const appointment = allAppointments.find((item) => item.id === id);
  if (!appointment) return;
  editingAppointment = appointment;
  apptEditMessage.textContent = "";
  apptEditMessage.className = "msg";

  if (allServices.length === 0) await loadServices();
  apptEditService.innerHTML = `<option value="">Hizmet seçin</option>` + allServices
    .map((service) => `<option value="${escapeAttr(service.id)}">${escapeHtml(service.name)} · ${service.duration_minutes} dk · ${formatPrice(service.price)}</option>`)
    .join("");

  const currentServiceExists = allServices.some((service) => service.id === appointment.service_id);
  if (currentServiceExists) {
    apptEditService.value = appointment.service_id;
  } else {
    const legacyOption = new Option(appointment.service_name || "Mevcut hizmet", "__legacy__");
    apptEditService.add(legacyOption);
    apptEditService.value = "__legacy__";
  }

  document.getElementById("appt-edit-customer").value = appointment.customer_name || "";
  document.getElementById("appt-edit-phone").value = appointment.customer_phone || "";
  document.getElementById("appt-edit-staff").value = appointment.staff_name || "";
  document.getElementById("appt-edit-date").value = appointment.appt_date || "";
  document.getElementById("appt-edit-time").value = (appointment.appt_time || "").slice(0, 5);
  document.getElementById("appt-edit-duration").value = appointment.duration_minutes || 60;
  document.getElementById("appt-edit-price").value = appointment.service_price ?? 0;
  document.getElementById("appt-edit-status").value = appointment.status || "pending";
  document.getElementById("appt-edit-note").value = appointment.note || "";
  apptEditDialog.showModal();
}

apptEditService.addEventListener("change", () => {
  const service = allServices.find((item) => item.id === apptEditService.value);
  if (!service) return;
  document.getElementById("appt-edit-duration").value = service.duration_minutes;
  document.getElementById("appt-edit-price").value = service.price;
});

apptEditDialog.addEventListener("close", clearAppointmentEditor);
document.getElementById("appt-edit-close").addEventListener("click", () => apptEditDialog.close());
document.getElementById("appt-edit-cancel").addEventListener("click", () => apptEditDialog.close());
apptEditDialog.addEventListener("click", (event) => {
  if (event.target === apptEditDialog) apptEditDialog.close();
});

apptList.addEventListener("keydown", (event) => {
  if ((event.key === "Enter" || event.key === " ") && event.target.matches(".appt-item[data-appointment-id]")) {
    event.preventDefault();
    openAppointmentEditor(event.target.dataset.appointmentId);
  }
});

apptEditForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!editingAppointment) return;
  const previousAppointment = editingAppointment;
  apptEditMessage.textContent = "";

  const customerName = document.getElementById("appt-edit-customer").value.trim();
  const customerPhone = document.getElementById("appt-edit-phone").value.trim();
  const staffName = document.getElementById("appt-edit-staff").value.trim();
  const serviceValue = apptEditService.value;
  const selectedService = allServices.find((service) => service.id === serviceValue);
  const serviceName = selectedService?.name || (serviceValue === "__legacy__" ? editingAppointment.service_name : "");
  const serviceId = selectedService?.id || (serviceValue === "__legacy__" ? editingAppointment.service_id : null);
  const apptDate = document.getElementById("appt-edit-date").value;
  const apptTime = document.getElementById("appt-edit-time").value;
  const duration = Number(document.getElementById("appt-edit-duration").value);
  const price = Number(document.getElementById("appt-edit-price").value);
  const status = document.getElementById("appt-edit-status").value;
  const note = document.getElementById("appt-edit-note").value.trim();

  if (!customerName || !customerPhone || !serviceName || !apptDate || !apptTime) {
    apptEditMessage.textContent = "Müşteri, telefon, hizmet, tarih ve saat alanları zorunludur.";
    apptEditMessage.className = "msg error";
    return;
  }

  const [year, month, day] = apptDate.split("-").map(Number);
  const dateCheck = new Date(year, month - 1, day);
  if (dateCheck.getFullYear() !== year || dateCheck.getMonth() !== month - 1 || dateCheck.getDate() !== day) {
    apptEditMessage.textContent = "Geçerli bir tarih girin.";
    apptEditMessage.className = "msg error";
    return;
  }

  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(apptTime)) {
    apptEditMessage.textContent = "Geçerli bir başlangıç saati girin.";
    apptEditMessage.className = "msg error";
    return;
  }

  if (!Number.isInteger(duration) || duration < 1 || duration > 1440) {
    apptEditMessage.textContent = "Süre 1 ile 1440 dakika arasında olmalıdır.";
    apptEditMessage.className = "msg error";
    return;
  }

  if (!Number.isFinite(price) || price < 0) {
    apptEditMessage.textContent = "Fiyat negatif olamaz.";
    apptEditMessage.className = "msg error";
    return;
  }

  if (!["pending", "confirmed", "cancelled"].includes(status)) {
    apptEditMessage.textContent = "Geçerli bir randevu durumu seçin.";
    apptEditMessage.className = "msg error";
    return;
  }

  const startMinute = toMin(apptTime);
  const endMinute = startMinute + duration;
  if (endMinute > 24 * 60) {
    apptEditMessage.textContent = "Randevu bitişi aynı gün içinde olmalıdır.";
    apptEditMessage.className = "msg error";
    return;
  }

  if (status !== "cancelled") {
    const [{ data: sameDayAppointments, error: appointmentCheckError }, { data: dayBlocks, error: blockCheckError }] = await Promise.all([
      supabase.from("appointments").select("id,appt_time,duration_minutes,staff_name")
        .eq("appt_date", apptDate).neq("id", editingAppointment.id).neq("status", "cancelled"),
      supabase.from("blocked_slots").select("start_time,end_time")
        .eq("block_date", apptDate),
    ]);

    if (appointmentCheckError || blockCheckError) {
      apptEditMessage.textContent = "Çakışma kontrolü yapılamadı; lütfen tekrar deneyin.";
      apptEditMessage.className = "msg error";
      return;
    }

    const overlapsAppointment = (sameDayAppointments || []).some((other) => {
      const sameStaff = (other.staff_name || "").trim().toLocaleLowerCase("tr-TR") === staffName.toLocaleLowerCase("tr-TR");
      if (!sameStaff) return false;
      const otherStart = toMin(other.appt_time);
      const otherEnd = otherStart + (other.duration_minutes || 0);
      return startMinute < otherEnd && endMinute > otherStart;
    });
    const overlapsBlock = (dayBlocks || []).some((block) => {
      if (!block.start_time) return true;
      const blockStart = toMin(block.start_time);
      const blockEnd = block.end_time ? toMin(block.end_time) : 24 * 60;
      return startMinute < blockEnd && endMinute > blockStart;
    });

    if (overlapsAppointment || overlapsBlock) {
      apptEditMessage.textContent = overlapsAppointment
        ? "Bu saat aralığı başka bir randevuyla çakışıyor."
        : "Bu saat aralığı özel kapatma veya takvim etkinliğiyle çakışıyor.";
      apptEditMessage.className = "msg error";
      return;
    }
  }

  if (!confirm("Değişiklikleri kaydetmek istediğinize emin misiniz?")) return;

  const saveButton = document.getElementById("appt-edit-save");
  saveButton.disabled = true;
  const { error } = await supabase.from("appointments").update({
    customer_name: customerName,
    customer_phone: customerPhone,
    staff_name: staffName,
    service_id: serviceId,
    service_name: serviceName,
    service_price: price,
    appt_date: apptDate,
    appt_time: apptTime,
    duration_minutes: duration,
    status,
    note: note || null,
  }).eq("id", editingAppointment.id);
  saveButton.disabled = false;

  if (error) {
    apptEditMessage.textContent = error.code === "23P01"
      ? "Bu saat başka bir randevuyla çakışıyor."
      : "Kaydedilemedi: " + error.message;
    apptEditMessage.className = "msg error";
    return;
  }

  const wasJustCancelled = status === "cancelled" && previousAppointment.status !== "cancelled";
  showAllAppointments = status === "cancelled" || apptDate < todayIsoLocal();
  apptShowArchiveBtn.textContent = showAllAppointments ? "Yaklaşan randevular" : "Geçmiş / İptal";
  apptFilterDate = wasJustCancelled ? apptDate : null;
  apptCalMonth = new Date(`${apptDate}T00:00:00`);
  apptEditDialog.close();
  await Promise.all([loadAppointments(), loadCustomers()]);
  if (wasJustCancelled) showGapFillLaunch({
    date: previousAppointment.appt_date,
    time: previousAppointment.appt_time.slice(0, 5),
    staffName: previousAppointment.staff_name || "",
    serviceId: previousAppointment.service_id || "",
    serviceName: previousAppointment.service_name || "",
    durationMinutes: previousAppointment.duration_minutes || 60,
  });
});

/** Normalizes a Turkish phone number (various typed formats) to international digits for wa.me links. */
function toWhatsAppNumber(rawPhone) {
  let digits = rawPhone.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (!digits.startsWith("90")) digits = "90" + digits;
  return digits;
}

function openWhatsAppMessage(action, data) {
  const { phone, name, service, date, time } = data;
  const serviceText = service ? ` (${service})` : "";

  const message =
    action === "wa-confirm"
      ? `Merhaba ${name}, ${date} tarihinde saat ${time}'te${serviceText} ${STUDIO_NAME} randevunuz oluşturulmuştur.`
      : `Merhaba ${name}, ${date} tarihinde saat ${time}'teki${serviceText} ${STUDIO_NAME} randevunuzu hatırlatmak isteriz. Görüşmek üzere!`;

  const url = `https://wa.me/${toWhatsAppNumber(phone)}?text=${encodeURIComponent(message)}`;
  window.open(url, "_blank");
}

/** Aynı müşterinin aynı gündeki tüm randevularını tek WhatsApp mesajında gönderir. */
function openWhatsAppGroupMessage(action, appts) {
  const first = appts[0];
  const dateStr = new Date(first.appt_date + "T00:00:00").toLocaleDateString("tr-TR", { day: "numeric", month: "long" });
  const lines = appts
    .map((a) => `• ${a.appt_time.slice(0, 5)}${a.service_name ? " - " + a.service_name : ""}`)
    .join("\n");

  const message =
    action === "wa-confirm-all"
      ? `Merhaba ${first.customer_name}, ${dateStr} tarihindeki ${STUDIO_NAME} randevularınız oluşturulmuştur:\n${lines}`
      : `Merhaba ${first.customer_name}, ${dateStr} tarihindeki ${STUDIO_NAME} randevularınızı hatırlatmak isteriz:\n${lines}\nGörüşmek üzere!`;

  const url = `https://wa.me/${toWhatsAppNumber(first.customer_phone)}?text=${encodeURIComponent(message)}`;
  window.open(url, "_blank");
}

// ---------- Elle Randevu Ekle ----------
const manualApptForm = document.getElementById("manual-appt-form");
const manualApptMsg = document.getElementById("manual-appt-msg");
const manualServiceSelect = document.getElementById("manual-service");

const manualNameInput = document.getElementById("manual-name");
const manualPhoneInput = document.getElementById("manual-phone");
const pickContactBtn = document.getElementById("manual-pick-contact");
const pastePhoneBtn = document.getElementById("manual-paste-phone");

// Rehberden seçme yalnızca Android Chrome'da destekleniyor; iPhone'da yerine
// "kopyalanan numarayı yapıştır" düğmesi gösterilir.
if ("contacts" in navigator && "select" in navigator.contacts) {
  pickContactBtn.hidden = false;
} else if (navigator.clipboard?.readText) {
  pastePhoneBtn.hidden = false;
}

pickContactBtn.addEventListener("click", async () => {
  manualApptMsg.textContent = "";
  try {
    const [contact] = await navigator.contacts.select(["name", "tel"], { multiple: false });
    if (!contact) return;
    if (contact.name?.[0]) manualNameInput.value = contact.name[0];
    if (contact.tel?.[0]) manualPhoneInput.value = formatTrPhone(contact.tel[0]);
  } catch (err) {
    console.error(err);
    manualApptMsg.textContent = "Rehber açılamadı.";
    manualApptMsg.className = "msg error";
  }
});

pastePhoneBtn.addEventListener("click", async () => {
  manualApptMsg.textContent = "";
  try {
    const text = await navigator.clipboard.readText();
    if (!/\d{7,}/.test(text.replace(/\D/g, ""))) {
      manualApptMsg.textContent = "Kopyalanan metinde telefon numarası bulunamadı.";
      manualApptMsg.className = "msg error";
      return;
    }
    manualPhoneInput.value = formatTrPhone(text);
  } catch (err) {
    console.error(err);
    manualApptMsg.textContent = "Yapıştırma izni verilmedi.";
    manualApptMsg.className = "msg error";
  }
});

/** Rehberden gelen "+90 542..." gibi numaraları "0542 422 77 09" biçimine çevirir. */
function formatTrPhone(raw) {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("90")) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith("5")) digits = "0" + digits;
  if (digits.length !== 11) return raw.trim();
  return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 9)} ${digits.slice(9)}`;
}

const extraServicesBox = document.getElementById("manual-extra-services");

function serviceOptionsHtml() {
  return allServices
    .filter((s) => s.is_active)
    .map((s) => `<option value="${s.id}">${escapeHtml(s.name)} (${s.duration_minutes} dk)</option>`)
    .join("");
}

function renderManualServiceOptions() {
  manualServiceSelect.innerHTML = serviceOptionsHtml();
  extraServicesBox.querySelectorAll("select").forEach((sel) => {
    const v = sel.value;
    sel.innerHTML = serviceOptionsHtml();
    sel.value = v;
  });
}

document.getElementById("manual-add-service").addEventListener("click", () => {
  const row = document.createElement("div");
  row.className = "extra-service-row";
  row.innerHTML = `<select required>${serviceOptionsHtml()}</select>
    <button type="button" class="small-danger">Sil</button>`;
  row.querySelector("button").addEventListener("click", () => { row.remove(); renderDaySlots(); });
  extraServicesBox.appendChild(row);
  renderDaySlots();
});

// Hizmet değişince takvimdeki boş saatler toplam süreye göre yenilenir.
manualApptForm.addEventListener("change", (e) => {
  if (e.target.tagName === "SELECT") renderDaySlots();
});

// Tarih/saat kutusunun herhangi bir yerine tıklayınca seçici açılsın.
["manual-date", "manual-time", "block-date", "block-start", "block-end"].forEach((id) => {
  const el = document.getElementById(id);
  el?.addEventListener("click", () => { try { el.showPicker(); } catch {} });
});

/** "14:30" + 90 dk → "16:00" */
function addMinutes(hhmm, mins) {
  const [h, m] = hhmm.split(":").map(Number);
  const t = h * 60 + m + mins;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

manualApptForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  manualApptMsg.textContent = "";

  const selects = [manualServiceSelect, ...extraServicesBox.querySelectorAll("select")];
  const services = selects.map((sel) => allServices.find((s) => s.id === sel.value));
  if (services.some((s) => !s)) {
    manualApptMsg.textContent = "Önce bir hizmet seçin.";
    manualApptMsg.className = "msg error";
    return;
  }

  const submitBtn = manualApptForm.querySelector("button[type=submit]");
  submitBtn.disabled = true;

  // Tüm hizmetler tek seferde eklenir: biri çakışırsa hiçbiri kaydedilmez.
  let time = document.getElementById("manual-time").value;
  const rows = services.map((service) => {
    const row = {
      appt_date: document.getElementById("manual-date").value,
      appt_time: time,
      duration_minutes: service.duration_minutes,
      service_id: service.id,
      service_name: service.name,
      service_price: service.price,
      customer_name: document.getElementById("manual-name").value.trim(),
      customer_phone: document.getElementById("manual-phone").value.trim(),
      note: document.getElementById("manual-note").value.trim() || null,
      status: "confirmed",
    };
    time = addMinutes(time, service.duration_minutes);
    return row;
  });

  const { error } = await supabase.from("appointments").insert(rows);

  submitBtn.disabled = false;

  if (error) {
    manualApptMsg.textContent = error.code === "23P01"
      ? "Bu saat aralığı zaten dolu, başka bir saat seçin."
      : "Eklenemedi: " + error.message;
    manualApptMsg.className = "msg error";
  } else {
    manualApptForm.reset();
    extraServicesBox.innerHTML = "";
    manualApptMsg.textContent = rows.length > 1 ? `${rows.length} hizmet arka arkaya eklendi.` : "Randevu eklendi.";
    manualApptMsg.className = "msg success";
    loadAppointments();
    loadCustomers();
  }
});

// ---------- Müşteriler ----------
const customerList = document.getElementById("customer-list");
const customerSearch = document.getElementById("customer-search");
const customerCount = document.getElementById("customer-count");
const customerOptions = document.getElementById("customer-options");

let allCustomers = []; // [{name, phone, visits, lastVisit, nextAppt}]

function customerLabel(c) {
  return `${c.name} · ${c.phone}`;
}

async function loadCustomers() {
  // Supabase tek seferde en fazla 1000 satır döndürdüğü için sayfa sayfa okunur.
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("appointments")
      .select("customer_name,customer_phone,appt_date,status")
      .order("appt_date", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) {
      customerList.innerHTML = `<p class="empty-note">Müşteriler yüklenemedi.</p>`;
      return;
    }
    rows.push(...data);
    if (data.length < pageSize) break;
  }

  // Aynı kişi "0542..." ve "+90 542..." gibi farklı yazılmış olabilir; son 10 haneye göre birleştirilir.
  // Satırlar yeniden eskiye sıralı: ilk görülen isim en güncel olanıdır.
  const today = todayIsoLocal();
  const byPhone = new Map();
  for (const r of rows) {
    const key = r.customer_phone.replace(/\D/g, "").slice(-10);
    let c = byPhone.get(key);
    if (!c) {
      c = { name: r.customer_name, phone: formatTrPhone(r.customer_phone), visits: 0, lastVisit: null, nextAppt: null };
      byPhone.set(key, c);
    }
    if (r.status === "cancelled") continue;
    if (r.appt_date < today) {
      c.visits++;
      if (!c.lastVisit) c.lastVisit = r.appt_date;
    } else {
      c.nextAppt = r.appt_date; // yeniden eskiye gidildiği için sonunda en yakın randevu kalır
    }
  }

  allCustomers = [...byPhone.values()].sort((a, b) => a.name.localeCompare(b.name, "tr"));
  customerOptions.innerHTML = allCustomers
    .map((c) => `<option value="${escapeAttr(customerLabel(c))}"></option>`)
    .join("");
  renderCustomerList();
}

function renderCustomerList() {
  const q = customerSearch.value.trim().toLocaleLowerCase("tr");
  const qDigits = q.replace(/\D/g, "");
  const list = q
    ? allCustomers.filter(
        (c) =>
          c.name.toLocaleLowerCase("tr").includes(q) ||
          (qDigits && c.phone.replace(/\D/g, "").includes(qDigits))
      )
    : allCustomers;

  customerCount.textContent = q
    ? `${list.length} sonuç (toplam ${allCustomers.length} müşteri)`
    : `Toplam ${allCustomers.length} müşteri`;

  if (list.length === 0) {
    customerList.innerHTML = `<p class="empty-note">${q ? "Eşleşen müşteri yok." : "Henüz müşteri yok."}</p>`;
    return;
  }

  const fmt = (iso) =>
    new Date(iso + "T00:00:00").toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });

  customerList.innerHTML = list
    .map((c) => {
      const details = [`${c.visits} ziyaret`];
      if (c.lastVisit) details.push(`son: ${fmt(c.lastVisit)}`);
      if (c.nextAppt) details.push(`sıradaki: ${fmt(c.nextAppt)}`);
      const attrs = `data-name="${escapeAttr(c.name)}" data-phone="${escapeAttr(c.phone)}"`;
      return `
        <div class="appt-item">
          <div>
            <div class="who">${escapeHtml(c.name)} · ${escapeHtml(c.phone)}</div>
            <div class="when">${details.join(" · ")}</div>
          </div>
          <div class="appt-actions">
            <button class="small-ok" data-action="book" ${attrs}>Randevu Ver</button>
            <button class="small-whatsapp" data-action="wa" ${attrs}>WhatsApp</button>
            <button class="small-ok" data-action="call" ${attrs}>Ara</button>
          </div>
        </div>`;
    })
    .join("");
}

customerSearch.addEventListener("input", renderCustomerList);

customerList.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const { name, phone } = btn.dataset;

  if (btn.dataset.action === "book") {
    document.querySelector('.tab-btn[data-tab="tab-appts"]').click();
    manualNameInput.value = name;
    manualPhoneInput.value = phone;
    manualApptForm.scrollIntoView({ behavior: "smooth", block: "start" });
    manualServiceSelect.focus();
  } else if (btn.dataset.action === "wa") {
    window.open(`https://wa.me/${toWhatsAppNumber(phone)}`, "_blank");
  } else if (btn.dataset.action === "call") {
    window.location.href = `tel:${phone.replace(/\s/g, "")}`;
  }
});

// Öneri listesinden "Ad · Telefon" seçilince ikiye ayrılıp iki kutuya yazılır.
manualNameInput.addEventListener("input", () => {
  const c = allCustomers.find((c) => customerLabel(c) === manualNameInput.value);
  if (c) {
    manualNameInput.value = c.name;
    manualPhoneInput.value = c.phone;
  }
});

// ---------- Özel Kapatmalar ----------
const blockList = document.getElementById("block-list");
const blockForm = document.getElementById("block-form");
const blockMsg = document.getElementById("block-msg");

let allBlocks = [];

async function loadBlockedSlots() {
  const todayIso = todayIsoLocal();
  const { data, error } = await supabase
    .from("blocked_slots")
    .select("id,block_date,start_time,end_time,reason,source")
    .gte("block_date", todayIso)
    .order("block_date", { ascending: true });

  allBlocks = error ? [] : data || [];
  renderApptCalendar();
  renderDaySlots();
  renderApptList();

  if (error || !data || data.length === 0) {
    blockList.innerHTML = `<p class="empty-note">Kayıtlı kapatma yok.</p>`;
    return;
  }

  blockList.innerHTML = "";
  data.forEach((b) => {
    const dateObj = new Date(b.block_date + "T00:00:00");
    const dateStr = dateObj.toLocaleDateString("tr-TR", { day: "numeric", month: "long" });
    const timeStr = b.start_time ? `${b.start_time.slice(0, 5)}–${b.end_time.slice(0, 5)}` : "Tüm gün";
    const el = document.createElement("div");
    el.className = "block-item";
    el.innerHTML = `
      <span>${dateStr} · ${timeStr}${b.reason ? " · " + escapeHtml(b.reason) : ""}</span>
      <button class="small-danger" data-id="${b.id}">Kaldır</button>
    `;
    blockList.appendChild(el);
  });
}

blockList.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-id]");
  if (!btn) return;
  btn.disabled = true;
  const { error } = await supabase.from("blocked_slots").delete().eq("id", btn.dataset.id);
  if (!error) loadBlockedSlots();
});

blockForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  blockMsg.textContent = "";
  const date = document.getElementById("block-date").value;
  const start = document.getElementById("block-start").value;
  const end = document.getElementById("block-end").value;
  const reason = document.getElementById("block-reason").value.trim();

  if (!date) {
    blockMsg.textContent = "Tarih seçin.";
    blockMsg.className = "msg error";
    return;
  }
  if ((start && !end) || (!start && end)) {
    blockMsg.textContent = "Başlangıç ve bitiş saatinin ikisini de girin, ya da ikisini de boş bırakın (tüm gün için).";
    blockMsg.className = "msg error";
    return;
  }

  const { error } = await supabase.from("blocked_slots").insert({
    block_date: date,
    start_time: start || null,
    end_time: end || null,
    reason: reason || null,
  });

  if (error) {
    blockMsg.textContent = "Eklenemedi: " + error.message;
    blockMsg.className = "msg error";
  } else {
    blockForm.reset();
    blockMsg.textContent = "Eklendi.";
    blockMsg.className = "msg success";
    loadBlockedSlots();
  }
});

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function formatPrice(value) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}
