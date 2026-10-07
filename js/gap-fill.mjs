const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function normalizeStaff(value) {
  return String(value || "").trim().toLocaleLowerCase("tr-TR");
}

export function timeToMinutes(value) {
  if (!value || !/^([01]\d|2[0-3]):[0-5]\d/.test(String(value).slice(0, 5))) return null;
  const [hours, minutes] = String(value).slice(0, 5).split(":").map(Number);
  return hours * 60 + minutes;
}

function dateToUtcDay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

function dayDifference(later, earlier) {
  const laterDate = dateToUtcDay(later);
  const earlierDate = dateToUtcDay(earlier);
  return laterDate && earlierDate ? Math.round((laterDate - earlierDate) / DAY_MS) : null;
}

function mode(values) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), "tr"))[0]?.[0] ?? null;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function slotPhoneWasContacted(contacts, slot, phoneKey) {
  const staffKey = normalizeStaff(slot.staffName);
  return contacts.some((contact) =>
    contact.slot_date === slot.date &&
    String(contact.slot_time || "").slice(0, 5) === String(slot.time || "").slice(0, 5) &&
    normalizeStaff(contact.staff_key) === staffKey &&
    normalizePhone(contact.phone_key) === phoneKey
  );
}

export function findSlotConflict({ appointments = [], blockedSlots = [], slot, ignoreAppointmentId = null }) {
  const start = timeToMinutes(slot?.time);
  const duration = Number(slot?.durationMinutes);
  if (!slot?.date || start === null || !Number.isInteger(duration) || duration < 1 || start + duration > 1440) {
    return "Geçerli tarih, saat ve süre girin.";
  }

  const selectedStaff = normalizeStaff(slot.staffName);
  for (const appointment of appointments) {
    if (appointment.id === ignoreAppointmentId || appointment.appt_date !== slot.date || appointment.status === "cancelled") continue;
    const otherStaff = normalizeStaff(appointment.staff_name);
    if (selectedStaff && otherStaff && selectedStaff !== otherStaff) continue;
    const otherStart = timeToMinutes(appointment.appt_time);
    const otherDuration = Number(appointment.duration_minutes) || 0;
    if (otherStart !== null && start < otherStart + otherDuration && start + duration > otherStart) {
      return "Bu saat aralığı mevcut bir randevuyla/personel planıyla çakışıyor.";
    }
  }

  for (const block of blockedSlots) {
    if (block.block_date !== slot.date) continue;
    if (!block.start_time) return "Bu tarih tüm gün kapalı.";
    const blockStart = timeToMinutes(block.start_time);
    const blockEnd = block.end_time ? timeToMinutes(block.end_time) : 1440;
    if (blockStart !== null && blockEnd !== null && start < blockEnd && start + duration > blockStart) {
      return "Bu saat özel kapatma veya takvim etkinliğiyle çakışıyor.";
    }
  }

  return null;
}

export function rankCustomerPatterns({ appointments = [], asOfDate }) {
  if (!dateToUtcDay(asOfDate)) return [];
  const groups = new Map();

  for (const appointment of appointments) {
    const phoneKey = normalizePhone(appointment.customer_phone);
    if (phoneKey.length < 10 || appointment.appt_date > asOfDate) continue;
    const group = groups.get(phoneKey) || [];
    group.push(appointment);
    groups.set(phoneKey, group);
  }

  const weekdayLabels = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
  const patterns = [];
  for (const [phoneKey, customerAppointments] of groups) {
    const historicalRecords = customerAppointments.filter((appointment) => appointment.status !== "cancelled");
    if (!historicalRecords.length) continue;

    const appointmentDays = [...new Set(historicalRecords.map((appointment) => appointment.appt_date))].sort();
    const intervals = appointmentDays.slice(1)
      .map((date, index) => dayDifference(date, appointmentDays[index]))
      .filter((days) => days > 0);
    const typicalIntervalDays = median(intervals);
    const lastAppointmentDate = appointmentDays.at(-1);
    const daysSinceLastAppointment = dayDifference(asOfDate, lastAppointmentDate);
    const daysFromTypicalInterval = typicalIntervalDays === null ? null : daysSinceLastAppointment - typicalIntervalDays;
    let followUpStatus = "Yeterli tekrar verisi yok";
    let followUpRank = 0;
    if (daysFromTypicalInterval !== null && daysFromTypicalInterval > 7) {
      followUpStatus = "Tipik aralığı geçmiş";
      followUpRank = 3;
    } else if (daysFromTypicalInterval !== null && daysFromTypicalInterval >= -7) {
      followUpStatus = "Yenileme zamanı yaklaşıyor";
      followUpRank = 2;
    } else if (daysFromTypicalInterval !== null) {
      followUpStatus = "Tipik randevu döngüsünde";
      followUpRank = 1;
    }

    const topService = mode(historicalRecords.map((appointment) => appointment.service_name));
    const topStaff = mode(historicalRecords.map((appointment) => appointment.staff_name));
    const visitWeekdays = appointmentDays.map((date) => {
      const parsed = dateToUtcDay(date);
      return parsed ? weekdayLabels[parsed.getUTCDay()] : null;
    }).filter(Boolean);
    const timeValues = historicalRecords.map((appointment) => timeToMinutes(appointment.appt_time)).filter((value) => value !== null);
    const spendByDay = new Map();
    for (const appointment of historicalRecords) {
      const price = Number(appointment.service_price);
      if (!Number.isFinite(price) || price < 0) continue;
      spendByDay.set(appointment.appt_date, (spendByDay.get(appointment.appt_date) || 0) + price);
    }
    const spendPerVisitDay = [...spendByDay.values()];
    const cancellationCount = customerAppointments.filter((appointment) => appointment.status === "cancelled").length;
    const confidence = appointmentDays.length >= 5 && intervals.length >= 3
      ? "Yüksek"
      : appointmentDays.length >= 3 && intervals.length >= 2
        ? "Orta"
        : "Düşük";

    patterns.push({
      phoneKey,
      customerName: [...customerAppointments].sort((a, b) => `${b.appt_date}${b.appt_time}`.localeCompare(`${a.appt_date}${a.appt_time}`))[0].customer_name,
      customerPhone: customerAppointments[0].customer_phone,
      appointmentRecordCount: historicalRecords.length,
      appointmentDayCount: appointmentDays.length,
      lastAppointmentDate,
      daysSinceLastAppointment,
      typicalIntervalDays,
      daysFromTypicalInterval,
      followUpStatus,
      followUpRank,
      preferredService: topService,
      preferredStaff: topStaff,
      preferredWeekday: mode(visitWeekdays),
      preferredHours: timeValues.length
        ? `${String(Math.floor(Math.min(...timeValues) / 60)).padStart(2, "0")}:${String(Math.min(...timeValues) % 60).padStart(2, "0")}–${String(Math.floor(Math.max(...timeValues) / 60)).padStart(2, "0")}:${String(Math.max(...timeValues) % 60).padStart(2, "0")}`
        : null,
      averageSpendPerVisit: spendPerVisitDay.length
        ? Math.round(spendPerVisitDay.reduce((sum, amount) => sum + amount, 0) / spendPerVisitDay.length)
        : null,
      cancellationCount,
      confidence,
    });
  }

  return patterns.sort((a, b) => b.followUpRank - a.followUpRank ||
    (b.daysFromTypicalInterval ?? -Infinity) - (a.daysFromTypicalInterval ?? -Infinity) ||
    b.appointmentDayCount - a.appointmentDayCount ||
    a.customerName.localeCompare(b.customerName, "tr"));
}

export function rankGapCustomers({ appointments = [], contacts = [], slot }) {
  const slotStart = timeToMinutes(slot?.time);
  const slotEnd = slotStart === null ? null : slotStart + Number(slot?.durationMinutes || 0);
  const slotDate = dateToUtcDay(slot?.date);
  if (!slotDate || slotStart === null || !slot?.serviceName) return [];

  const groups = new Map();
  for (const appointment of appointments) {
    const phoneKey = normalizePhone(appointment.customer_phone);
    if (phoneKey.length < 10) continue;
    const group = groups.get(phoneKey) || [];
    group.push(appointment);
    groups.set(phoneKey, group);
  }

  const weekdayLabels = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
  const candidates = [];

  for (const [phoneKey, customerAppointments] of groups) {
    if (slotPhoneWasContacted(contacts, slot, phoneKey)) continue;

    const alreadyBookedOverlappingSlot = customerAppointments.some((appointment) => {
      if (appointment.appt_date !== slot.date || appointment.status === "cancelled") return false;
      const appointmentStart = timeToMinutes(appointment.appt_time);
      const appointmentEnd = appointmentStart === null ? null : appointmentStart + (Number(appointment.duration_minutes) || 0);
      return appointmentStart !== null && appointmentEnd !== null && slotStart < appointmentEnd && slotEnd > appointmentStart;
    });
    if (alreadyBookedOverlappingSlot) continue;

    const priorRecords = customerAppointments.filter((appointment) => {
      if (appointment.status === "cancelled" || appointment.appt_date > slot.date) return false;
      if (appointment.appt_date < slot.date) return true;
      const appointmentStart = timeToMinutes(appointment.appt_time);
      return appointmentStart !== null && appointmentStart < slotStart;
    });
    if (!priorRecords.length) continue;

    const priorDates = [...new Set(priorRecords.map((appointment) => appointment.appt_date))].sort();
    const intervals = priorDates.slice(1).map((date, index) => dayDifference(date, priorDates[index])).filter((value) => value > 0);
    const typicalIntervalDays = median(intervals);
    const lastAppointmentDate = priorDates.at(-1);
    const daysSinceLastAppointment = dayDifference(slot.date, lastAppointmentDate);
    const selectedTime = slotStart;
    const pastTimes = priorRecords.map((appointment) => timeToMinutes(appointment.appt_time)).filter((value) => value !== null);
    const preferredTime = median(pastTimes);
    const preferredHours = pastTimes.length
      ? `${String(Math.floor(Math.min(...pastTimes) / 60)).padStart(2, "0")}:${String(Math.min(...pastTimes) % 60).padStart(2, "0")}–${String(Math.floor(Math.max(...pastTimes) / 60)).padStart(2, "0")}:${String(Math.max(...pastTimes) % 60).padStart(2, "0")}`
      : null;
    const serviceRecords = priorRecords.filter((appointment) =>
      (slot.serviceId && appointment.service_id === slot.serviceId) ||
      String(appointment.service_name || "").trim().toLocaleLowerCase("tr-TR") === String(slot.serviceName).trim().toLocaleLowerCase("tr-TR")
    );
    const staffRecords = priorRecords.filter((appointment) => normalizeStaff(appointment.staff_name));
    const staffMatches = slot.staffName
      ? staffRecords.filter((appointment) => normalizeStaff(appointment.staff_name) === normalizeStaff(slot.staffName))
      : [];
    const dateForWeekday = dateToUtcDay(slot.date);
    const selectedWeekday = dateForWeekday ? weekdayLabels[dateForWeekday.getUTCDay()] : null;
    const priorWeekdays = priorDates.map((date) => {
      const parsed = dateToUtcDay(date);
      return parsed ? weekdayLabels[parsed.getUTCDay()] : null;
    }).filter(Boolean);
    const preferredWeekday = mode(priorWeekdays);
    const cancellationCount = customerAppointments.filter((appointment) => appointment.status === "cancelled" && appointment.appt_date <= slot.date).length;
    const totalPastRecords = priorRecords.length + cancellationCount;
    const pricedRecords = priorRecords.map((appointment) => Number(appointment.service_price)).filter((price) => Number.isFinite(price) && price > 0);

    const factors = [];
    const reasons = [];
    if (typicalIntervalDays !== null) {
      const expectedNextDate = new Date(lastAppointmentDate + "T00:00:00.000Z");
      expectedNextDate.setUTCDate(expectedNextDate.getUTCDate() + typicalIntervalDays);
      const expectedIso = expectedNextDate.toISOString().slice(0, 10);
      const dueDistance = Math.abs(dayDifference(slot.date, expectedIso));
      factors.push({ weight: 40, value: Math.max(0, 1 - dueDistance / 21) });
      reasons.push(`Son kayıt ${daysSinceLastAppointment} gün önce; geçmiş randevularında tipik aralık ${typicalIntervalDays} gün.`);
    }
    if (serviceRecords.length || priorRecords.some((appointment) => appointment.service_name || appointment.service_id)) {
      const matchRatio = serviceRecords.length / priorRecords.length;
      factors.push({ weight: 20, value: matchRatio });
      if (serviceRecords.length) reasons.push(`Bu hizmeti geçmişte ${serviceRecords.length} kez aldı.`);
    }
    if (slot.staffName && staffRecords.length) {
      const staffRatio = staffMatches.length / staffRecords.length;
      factors.push({ weight: 15, value: staffRatio });
      if (staffMatches.length) reasons.push(`Seçilen uzmanla geçmişte ${staffMatches.length} kaydı var.`);
    }
    if (priorDates.length >= 2) {
      const sameWeekdayRatio = priorWeekdays.filter((weekday) => weekday === selectedWeekday).length / priorWeekdays.length;
      factors.push({ weight: 10, value: sameWeekdayRatio });
      if (sameWeekdayRatio > 0) reasons.push(`Geçmiş randevularının ${(sameWeekdayRatio * 100).toFixed(0)}%'si ${selectedWeekday} gününde.`);
    }
    if (pastTimes.length >= 2 && preferredTime !== null) {
      const timeCloseness = Math.max(0, 1 - Math.abs(selectedTime - preferredTime) / 240);
      factors.push({ weight: 10, value: timeCloseness });
      const from = Math.min(...pastTimes);
      const to = Math.max(...pastTimes);
      reasons.push(`Geçmiş saatleri ${String(Math.floor(from / 60)).padStart(2, "0")}:${String(from % 60).padStart(2, "0")}–${String(Math.floor(to / 60)).padStart(2, "0")}:${String(to % 60).padStart(2, "0")} aralığında.`);
    }
    if (totalPastRecords >= 2) {
      factors.push({ weight: 5, value: Math.max(0, 1 - cancellationCount / totalPastRecords) });
      if (cancellationCount) reasons.push(`Geçmişinde ${cancellationCount} iptal kaydı var.`);
    }

    const totalWeight = factors.reduce((total, factor) => total + factor.weight, 0);
    const score = totalWeight
      ? Math.round(100 * factors.reduce((total, factor) => total + factor.value * factor.weight, 0) / totalWeight)
      : 0;
    const confidence = priorRecords.length >= 5 && intervals.length >= 2
      ? "Yüksek"
      : priorRecords.length >= 3
        ? "Orta"
        : "Düşük";

    candidates.push({
      phoneKey,
      customerName: [...customerAppointments].sort((a, b) => `${b.appt_date}${b.appt_time}`.localeCompare(`${a.appt_date}${a.appt_time}`))[0].customer_name,
      customerPhone: customerAppointments.find((appointment) => normalizePhone(appointment.customer_phone) === phoneKey)?.customer_phone || "",
      score,
      confidence,
      historyCount: priorRecords.length,
      lastAppointmentDate,
      daysSinceLastAppointment,
      typicalIntervalDays,
      preferredStaff: mode(staffRecords.map((appointment) => appointment.staff_name)),
      preferredWeekday,
      preferredHours,
      cancellationCount,
      averageSpend: pricedRecords.length ? Math.round(pricedRecords.reduce((sum, price) => sum + price, 0) / pricedRecords.length) : null,
      reasons: reasons.length ? reasons : ["Geçmiş randevu verisi sınırlı; skor düşük güvenilirlikte."],
    });
  }

  return candidates.sort((a, b) => b.score - a.score || b.historyCount - a.historyCount || a.customerName.localeCompare(b.customerName, "tr"));
}

export function buildGapMessage({ candidate, slot, studioName }) {
  const date = dateToUtcDay(slot.date);
  const dateText = date ? new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long" }).format(date) : slot.date;
  const firstName = String(candidate.customerName || "").trim().split(/\s+/)[0] || "Merhaba";
  const staffText = slot.staffName ? ` ${slot.staffName} ile` : "";
  const serviceText = slot.serviceName ? ` ${slot.serviceName} için` : "";
  const studioText = studioName ? ` ${studioName}` : "";
  return `Merhaba ${firstName} 🌸 ${dateText} günü saat ${String(slot.time).slice(0, 5)}'da${staffText}${serviceText}${studioText} bir boşluk oluştu. Sizin için de uygunsa bu saati size ayırabiliriz. 💕`;
}