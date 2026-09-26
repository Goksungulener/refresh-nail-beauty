import { supabase } from "./supabaseClient.js";
import { STUDIO_NAME } from "./config.js";

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

let allAppointments = [];
let apptCalMonth = new Date(new Date().setDate(1));
let apptFilterDate = null; // 'YYYY-MM-DD' ya da null (hepsi)

async function loadAppointments() {
  apptList.innerHTML = `<p class="empty-note">Yükleniyor…</p>`;
  const todayIso = todayIsoLocal();
  const { data, error } = await supabase
    .from("appointments")
    .select("id,appt_date,appt_time,customer_name,customer_phone,note,status,service_name")
    .gte("appt_date", todayIso)
    .neq("status", "cancelled")
    .order("appt_date", { ascending: true })
    .order("appt_time", { ascending: true });

  if (error) {
    apptList.innerHTML = `<p class="empty-note">Randevular yüklenemedi.</p>`;
    return;
  }

  allAppointments = data || [];
  renderApptCalendar();
  renderApptList();
}

function renderApptList() {
  const data = apptFilterDate
    ? allAppointments.filter((a) => a.appt_date === apptFilterDate)
    : allAppointments;
  const dayBlocks = apptFilterDate
    ? allBlocks.filter((b) => b.block_date === apptFilterDate)
    : [];

  if (apptFilterDate) {
    const dateObj = new Date(apptFilterDate + "T00:00:00");
    apptListTitle.textContent = dateObj.toLocaleDateString("tr-TR", { day: "numeric", month: "long" });
    apptShowAllBtn.hidden = false;
  } else {
    apptListTitle.textContent = "Yaklaşan Randevular";
    apptShowAllBtn.hidden = true;
  }

  if (data.length === 0 && dayBlocks.length === 0) {
    apptList.innerHTML = `<p class="empty-note">${apptFilterDate ? "Bu günde randevu yok." : "Yaklaşan randevu yok."}</p>`;
    return;
  }

  apptList.innerHTML = "";

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
    const el = document.createElement("div");
    el.className = "appt-item";
    el.innerHTML = `
      <div>
        <div class="who">${escapeHtml(appt.customer_name)} · ${escapeHtml(appt.customer_phone)}</div>
        <div class="when">${dateStr}, ${appt.appt_time.slice(0, 5)} ${appt.note ? "· " + escapeHtml(appt.note) : ""}</div>
      </div>
      <div class="appt-actions">
        <span class="badge ${appt.status}">${statusLabel(appt.status)}</span>
        ${appt.status === "pending" ? `<button class="small-ok" data-action="confirm" data-id="${appt.id}">Onayla</button>` : ""}
        <button class="small-danger" data-action="cancel" data-id="${appt.id}">İptal</button>
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
      </div>
    `;
    apptList.appendChild(el);
  });
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
      renderApptCalendar();
      renderApptList();
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

apptShowAllBtn.addEventListener("click", () => {
  apptFilterDate = null;
  renderApptCalendar();
  renderApptList();
});

apptList.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === "wa-confirm" || action === "wa-remind") {
    openWhatsAppMessage(action, btn.dataset);
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
  btn.disabled = true;
  const { error } = await supabase.from("appointments").update({ status }).eq("id", id);
  if (!error) loadAppointments();
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

function renderManualServiceOptions() {
  const active = allServices.filter((s) => s.is_active);
  manualServiceSelect.innerHTML = active
    .map((s) => `<option value="${s.id}">${escapeHtml(s.name)} (${s.duration_minutes} dk)</option>`)
    .join("");
}

manualApptForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  manualApptMsg.textContent = "";

  const service = allServices.find((s) => s.id === manualServiceSelect.value);
  if (!service) {
    manualApptMsg.textContent = "Önce bir hizmet seçin.";
    manualApptMsg.className = "msg error";
    return;
  }

  const submitBtn = manualApptForm.querySelector("button[type=submit]");
  submitBtn.disabled = true;

  const { error } = await supabase.from("appointments").insert({
    appt_date: document.getElementById("manual-date").value,
    appt_time: document.getElementById("manual-time").value,
    duration_minutes: service.duration_minutes,
    service_id: service.id,
    service_name: service.name,
    service_price: service.price,
    customer_name: document.getElementById("manual-name").value.trim(),
    customer_phone: document.getElementById("manual-phone").value.trim(),
    note: document.getElementById("manual-note").value.trim() || null,
    status: "confirmed",
  });

  submitBtn.disabled = false;

  if (error) {
    manualApptMsg.textContent = error.code === "23P01"
      ? "Bu saat aralığı zaten dolu, başka bir saat seçin."
      : "Eklenemedi: " + error.message;
    manualApptMsg.className = "msg error";
  } else {
    manualApptForm.reset();
    manualApptMsg.textContent = "Randevu eklendi.";
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

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}
