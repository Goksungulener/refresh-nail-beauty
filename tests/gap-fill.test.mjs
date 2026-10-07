import test from "node:test";
import assert from "node:assert/strict";
import { buildGapMessage, findSlotConflict, rankCustomerPatterns, rankGapCustomers } from "../js/gap-fill.mjs";

const slot = {
  date: "2026-10-24",
  time: "15:30",
  durationMinutes: 60,
  serviceId: "manicure",
  serviceName: "Manikür",
  staffName: "Elif",
};

const history = [
  { id: "a1", appt_date: "2026-08-01", appt_time: "15:00", duration_minutes: 60, service_id: "manicure", service_name: "Manikür", service_price: 1000, staff_name: "Elif", customer_name: "Ayşe Yılmaz", customer_phone: "0555 123 45 67", status: "confirmed" },
  { id: "a2", appt_date: "2026-08-29", appt_time: "16:00", duration_minutes: 60, service_id: "manicure", service_name: "Manikür", service_price: 1200, staff_name: "Elif", customer_name: "Ayşe Yılmaz", customer_phone: "+90 555 123 45 67", status: "confirmed" },
  { id: "a3", appt_date: "2026-09-26", appt_time: "14:30", duration_minutes: 60, service_id: "manicure", service_name: "Manikür", service_price: 1000, staff_name: "Elif", customer_name: "Ayşe Yılmaz", customer_phone: "05551234567", status: "confirmed" },
];

test("ranks customers from real appointment patterns and exposes confidence", () => {
  const [candidate] = rankGapCustomers({ appointments: history, slot });
  assert.equal(candidate.customerName, "Ayşe Yılmaz");
  assert.equal(candidate.typicalIntervalDays, 28);
  assert.equal(candidate.preferredStaff, "Elif");
  assert.equal(candidate.averageSpend, 1067);
  assert.equal(candidate.confidence, "Orta");
  assert.ok(candidate.score >= 0 && candidate.score <= 100);
});

test("does not recommend a customer with an overlapping booking at the same slot", () => {
  const appointments = [...history, {
    id: "same-day",
    appt_date: slot.date,
    appt_time: "15:00",
    duration_minutes: 90,
    customer_name: "Ayşe Yılmaz",
    customer_phone: "05551234567",
    status: "confirmed",
  }];
  assert.equal(rankGapCustomers({ appointments, slot }).length, 0);
});

test("does not repeat a customer already contacted for the same slot and staff", () => {
  const contacts = [{
    slot_date: slot.date,
    slot_time: slot.time,
    staff_key: "elif",
    phone_key: "5551234567",
  }];
  assert.equal(rankGapCustomers({ appointments: history, contacts, slot }).length, 0);
});

test("detects appointment and blocked-slot overlaps while allowing another assigned staff member", () => {
  const otherStaffAppointment = [{
    id: "other-staff",
    appt_date: slot.date,
    appt_time: "15:00",
    duration_minutes: 90,
    staff_name: "Derya",
    status: "confirmed",
  }];
  assert.equal(findSlotConflict({ appointments: otherStaffAppointment, blockedSlots: [], slot }), null);

  const sameStaffAppointment = [{ ...otherStaffAppointment[0], staff_name: "Elif" }];
  assert.match(findSlotConflict({ appointments: sameStaffAppointment, blockedSlots: [], slot }), /çakışıyor/);

  const block = [{ block_date: slot.date, start_time: "15:00", end_time: "16:00" }];
  assert.match(findSlotConflict({ appointments: [], blockedSlots: block, slot }), /kapatma/);
});

test("creates a non-promotional message with only the selected slot and known service", () => {
  const [candidate] = rankGapCustomers({ appointments: history, slot });
  const message = buildGapMessage({ candidate, slot, studioName: "Refresh Nail Beauty" });
  assert.match(message, /Ayşe/);
  assert.match(message, /15:30/);
  assert.match(message, /Manikür/);
  assert.doesNotMatch(message, /indirim|kampanya|₺/i);
});

test("compares customer recurrence without a selected empty slot and excludes cancelled bookings from attendance records", () => {
  const appointments = [
    { appt_date: "2026-01-15", appt_time: "10:00", service_name: "Manikür", service_price: 1000, staff_name: "Elif", customer_name: "Ayşe Yılmaz", customer_phone: "05551234567", status: "confirmed" },
    { appt_date: "2026-02-12", appt_time: "11:00", service_name: "Manikür", service_price: 1200, staff_name: "Elif", customer_name: "Ayşe Yılmaz", customer_phone: "+90 555 123 45 67", status: "confirmed" },
    { appt_date: "2026-03-12", appt_time: "10:30", service_name: "Manikür", service_price: 1000, staff_name: "Elif", customer_name: "Ayşe Yılmaz", customer_phone: "05551234567", status: "confirmed" },
    { appt_date: "2026-04-01", appt_time: "10:00", service_name: "Manikür", service_price: 1000, staff_name: "Elif", customer_name: "Ayşe Yılmaz", customer_phone: "05551234567", status: "cancelled" },
    { appt_date: "2026-02-01", appt_time: "16:00", service_name: "Pedikür", service_price: 1200, staff_name: "Derya", customer_name: "Buse Kaya", customer_phone: "05559876543", status: "confirmed" },
    { appt_date: "2026-03-01", appt_time: "15:00", service_name: "Pedikür", service_price: 1000, staff_name: "Derya", customer_name: "Buse Kaya", customer_phone: "05559876543", status: "confirmed" },
  ];

  const patterns = rankCustomerPatterns({ appointments, asOfDate: "2026-04-10" });
  assert.equal(patterns[0].customerName, "Buse Kaya");
  assert.equal(patterns[0].followUpStatus, "Tipik aralığı geçmiş");
  const ayse = patterns.find((pattern) => pattern.customerName === "Ayşe Yılmaz");
  assert.equal(ayse.appointmentDayCount, 3);
  assert.equal(ayse.cancellationCount, 1);
  assert.equal(ayse.typicalIntervalDays, 28);
  assert.equal(ayse.preferredService, "Manikür");
  assert.equal(ayse.preferredStaff, "Elif");
  assert.equal(ayse.averageSpendPerVisit, 1067);
});

test("labels single-record customer patterns as low confidence instead of inventing a recurrence", () => {
  const patterns = rankCustomerPatterns({
    asOfDate: "2026-04-10",
    appointments: [{ appt_date: "2026-03-01", appt_time: "10:00", service_name: "Manikür", customer_name: "Tek Kayıt", customer_phone: "05550001122", status: "confirmed" }],
  });
  assert.equal(patterns[0].typicalIntervalDays, null);
  assert.equal(patterns[0].confidence, "Düşük");
  assert.equal(patterns[0].followUpStatus, "Yeterli tekrar verisi yok");
});