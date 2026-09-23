import { supabase } from "./supabaseClient.js";
import { STUDIO_NAME, STUDIO_ADDRESS, STUDIO_PHONE } from "./config.js";
import { downloadAppointmentIcs } from "./ics.js";

const DOW_LABELS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
const MONTH_LABELS = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

document.getElementById("studio-name").textContent = STUDIO_NAME;
document.getElementById("studio-address").textContent = STUDIO_ADDRESS;

let services = []; // [{id,name,duration_minutes,price}]
let selectedService = null;
let workingHours = {}; // weekday(0=Sun) -> row
let blockedSlots = []; // all upcoming blocked rows
let viewMonth = new Date(new Date().setDate(1)); // first day of displayed month
let selectedDate = null; // 'YYYY-MM-DD'
let selectedTime = null; // 'HH:MM'

const serviceSection = document.getElementById("service-section");
const serviceList = document.getElementById("service-list");
const calendarCard = document.getElementById("calendar-card");
const calGrid = document.getElementById("cal-grid");
const monthLabel = document.getElementById("month-label");
const slotSection = document.getElementById("slot-section");
const slotGrid = document.getElementById("slot-grid");
const slotDateLabel = document.getElementById("slot-date-label");
const bookingSection = document.getElementById("booking-section");
const bookingForm = document.getElementById("booking-form");
const bookingMsg = document.getElementById("booking-msg");
const confirmSection = document.getElementById("confirm-section");

function toIso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayIso() {
  return toIso(new Date());
}

function timeToMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(mins) {
  const h = String(Math.floor(mins / 60)).padStart(2, "0");
  const m = String(mins % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function formatPrice(p) {
  const n = Number(p) || 0;
  return n.toLocaleString("tr-TR") + " ₺";
}

// ---------- Hizmet seçimi ----------
async function loadServices() {
  const { data, error } = await supabase
    .from("services")
    .select("id,name,duration_minutes,price")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  services = data || [];
  renderServices();
}

function renderServices() {
  if (services.length === 0) {
    serviceList.innerHTML = `<p class="empty-note">Şu anda tanımlı hizmet yok.</p>`;
    return;
  }
  serviceList.innerHTML = "";
  services.forEach((s) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "service-btn";
    btn.innerHTML = `
      <span class="service-name">${escapeHtml(s.name)}</span>
      <span class="service-meta">${s.duration_minutes} dk · ${formatPrice(s.price)}</span>
    `;
    btn.addEventListener("click", () => selectService(s, btn));
    serviceList.appendChild(btn);
  });
}

function selectService(service, btnEl) {
  selectedService = service;
  document.querySelectorAll(".service-btn").forEach((b) => b.classList.remove("selected"));
  btnEl.classList.add("selected");

  selectedDate = null;
  selectedTime = null;
  slotSection.hidden = true;
  bookingSection.hidden = true;

  calendarCard.hidden = false;
  renderCalendar();
  calendarCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ---------- Çalışma saatleri / kapatmalar ----------
async function loadStaticData() {
  const { data: hours, error: hoursErr } = await supabase
    .from("working_hours")
    .select("weekday,is_open,start_time,end_time,slot_minutes");
  if (hoursErr) throw hoursErr;
  workingHours = {};
  for (const row of hours) workingHours[row.weekday] = row;

  const { data: blocks, error: blockErr } = await supabase
    .from("blocked_slots")
    .select("block_date,start_time,end_time")
    .gte("block_date", todayIso());
  if (blockErr) throw blockErr;
  blockedSlots = blocks;
}

function isDateClosed(dateObj) {
  const weekday = dateObj.getDay();
  const row = workingHours[weekday];
  if (!row || !row.is_open) return true;
  const iso = toIso(dateObj);
  const fullDayBlock = blockedSlots.find(
    (b) => b.block_date === iso && !b.start_time && !b.end_time
  );
  return !!fullDayBlock;
}

// ---------- Takvim ----------
function renderCalendar() {
  calGrid.innerHTML = "";
  DOW_LABELS.forEach((d) => {
    const el = document.createElement("div");
    el.className = "dow";
    el.textContent = d;
    calGrid.appendChild(el);
  });

  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  monthLabel.textContent = `${MONTH_LABELS[month]} ${year}`;

  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7; // Monday=0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = todayIso();

  for (let i = 0; i < startOffset; i++) {
    const el = document.createElement("div");
    el.className = "cal-day empty";
    calGrid.appendChild(el);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(year, month, d);
    const iso = toIso(dateObj);
    const el = document.createElement("button");
    el.className = "cal-day";
    el.type = "button";
    el.textContent = String(d);

    const isPast = iso < todayStr;
    const closed = isDateClosed(dateObj);

    if (iso === todayStr) el.classList.add("today");

    if (isPast || closed) {
      el.classList.add("disabled");
      el.disabled = true;
    } else {
      el.classList.add("available");
      if (iso === selectedDate) el.classList.add("selected");
      el.addEventListener("click", () => selectDate(iso));
    }

    calGrid.appendChild(el);
  }
}

async function selectDate(iso) {
  selectedDate = iso;
  selectedTime = null;
  bookingSection.hidden = true;
  renderCalendar();

  const dateObj = new Date(iso + "T00:00:00");
  const formatted = dateObj.toLocaleDateString("tr-TR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  slotDateLabel.textContent = formatted;
  slotSection.hidden = false;
  slotGrid.innerHTML = `<p class="empty-note">Saatler yükleniyor…</p>`;

  const slots = await computeAvailableSlots(iso, dateObj);
  renderSlots(slots);
}

async function computeAvailableSlots(iso, dateObj) {
  const duration = selectedService.duration_minutes;
  const weekday = dateObj.getDay();
  const hoursRow = workingHours[weekday];
  if (!hoursRow || !hoursRow.is_open) return [];

  const startMin = timeToMinutes(hoursRow.start_time.slice(0, 5));
  const endMin = timeToMinutes(hoursRow.end_time.slice(0, 5));
  const step = hoursRow.slot_minutes;

  const dayBlocks = blockedSlots
    .filter((b) => b.block_date === iso && b.start_time)
    .map((b) => ({
      start: timeToMinutes(b.start_time.slice(0, 5)),
      end: timeToMinutes(b.end_time.slice(0, 5)),
    }));

  const { data: taken, error } = await supabase
    .from("appointments")
    .select("appt_time,duration_minutes")
    .eq("appt_date", iso);
  if (error) throw error;

  const takenRanges = (taken || []).map((r) => {
    const start = timeToMinutes(r.appt_time.slice(0, 5));
    return { start, end: start + r.duration_minutes };
  });

  const now = new Date();
  const isToday = iso === todayIso();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const slots = [];
  for (let m = startMin; m + duration <= endMin; m += step) {
    if (isToday && m <= nowMin) continue;
    const candEnd = m + duration;

    const overlapsTaken = takenRanges.some((r) => m < r.end && candEnd > r.start);
    if (overlapsTaken) continue;

    const overlapsBlock = dayBlocks.some((r) => m < r.end && candEnd > r.start);
    if (overlapsBlock) continue;

    slots.push(minutesToTime(m));
  }
  return slots;
}

function renderSlots(slots) {
  if (slots.length === 0) {
    slotGrid.innerHTML = `<p class="empty-note">Bu gün için "${escapeHtml(selectedService.name)}" hizmetine uygun saat kalmadı. Başka bir gün seçebilirsiniz.</p>`;
    return;
  }
  slotGrid.innerHTML = "";
  slots.forEach((t) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "slot-btn";
    btn.textContent = t;
    btn.addEventListener("click", () => {
      selectedTime = t;
      document.querySelectorAll(".slot-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      bookingSection.hidden = false;
      bookingSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    slotGrid.appendChild(btn);
  });
}

document.getElementById("prev-month").addEventListener("click", () => {
  viewMonth.setMonth(viewMonth.getMonth() - 1);
  renderCalendar();
});
document.getElementById("next-month").addEventListener("click", () => {
  viewMonth.setMonth(viewMonth.getMonth() + 1);
  renderCalendar();
});

bookingForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  bookingMsg.textContent = "";
  const name = document.getElementById("cust-name").value.trim();
  const phone = document.getElementById("cust-phone").value.trim();
  const note = document.getElementById("cust-note").value.trim();

  if (!name || !phone || !selectedDate || !selectedTime || !selectedService) {
    bookingMsg.textContent = "Lütfen ad soyad ve telefon bilgisi girin.";
    bookingMsg.className = "msg error";
    return;
  }

  const submitBtn = bookingForm.querySelector("button[type=submit]");
  submitBtn.disabled = true;

  const duration = selectedService.duration_minutes;

  const { error } = await supabase.from("appointments").insert({
    appt_date: selectedDate,
    appt_time: selectedTime,
    duration_minutes: duration,
    service_id: selectedService.id,
    service_name: selectedService.name,
    service_price: selectedService.price,
    customer_name: name,
    customer_phone: phone,
    note: note || null,
  });

  submitBtn.disabled = false;

  if (error) {
    if (error.code === "23505" || error.code === "23P01") {
      bookingMsg.textContent = "Üzgünüz, bu saat az önce başka bir müşteri tarafından alındı. Lütfen başka bir saat seçin.";
      bookingMsg.className = "msg error";
      const slots = await computeAvailableSlots(selectedDate, new Date(selectedDate + "T00:00:00"));
      renderSlots(slots);
      bookingSection.hidden = true;
    } else {
      bookingMsg.textContent = "Bir hata oluştu, lütfen tekrar deneyin.";
      bookingMsg.className = "msg error";
      console.error(error);
    }
    return;
  }

  showConfirmation({ name, date: selectedDate, time: selectedTime, duration, note, service: selectedService });
});

function showConfirmation({ name, date, time, duration, note, service }) {
  serviceSection.hidden = true;
  calendarCard.hidden = true;
  slotSection.hidden = true;
  bookingSection.hidden = true;

  const dateObj = new Date(date + "T00:00:00");
  const formatted = dateObj.toLocaleDateString("tr-TR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  confirmSection.hidden = false;
  confirmSection.innerHTML = `
    <div class="confirm-box">
      <div class="check">✓</div>
      <h2>Randevunuz Alındı</h2>
      <p style="color:var(--ink-soft)">Sizi ${formatted} tarihinde bekliyoruz.</p>
    </div>
    <div class="summary-row"><span>Ad Soyad</span><span>${escapeHtml(name)}</span></div>
    <div class="summary-row"><span>Hizmet</span><span>${escapeHtml(service.name)}</span></div>
    <div class="summary-row"><span>Ücret</span><span>${formatPrice(service.price)}</span></div>
    <div class="summary-row"><span>Tarih</span><span>${formatted}</span></div>
    <div class="summary-row"><span>Saat</span><span>${time}</span></div>
    <div class="summary-row"><span>Stüdyo</span><span>${escapeHtml(STUDIO_NAME)}</span></div>
    <button type="button" class="primary" id="ics-btn">📅 Takvime Ekle</button>
    <p class="empty-note" style="text-align:center;margin-top:10px">
      Sorularınız için: ${escapeHtml(STUDIO_PHONE)}
    </p>
  `;

  document.getElementById("ics-btn").addEventListener("click", () => {
    downloadAppointmentIcs({
      date,
      time,
      durationMinutes: duration,
      studioName: STUDIO_NAME,
      studioAddress: STUDIO_ADDRESS,
      note: service.name + (note ? " — " + note : ""),
    });
  });
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

(async function init() {
  try {
    await Promise.all([loadServices(), loadStaticData()]);
  } catch (err) {
    serviceList.innerHTML = `<p class="empty-note">Sayfa yüklenemedi. Lütfen daha sonra tekrar deneyin.</p>`;
    console.error(err);
  }
})();
