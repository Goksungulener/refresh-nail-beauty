// Randevuyu telefon/bilgisayar takvimine eklemek için .ics dosyası oluşturur.
export function downloadAppointmentIcs({ date, time, durationMinutes, studioName, studioAddress, note }) {
  const start = new Date(`${date}T${time}`);
  const end = new Date(start.getTime() + durationMinutes * 60000);

  const toIcsDate = (d) =>
    d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

  const escapeText = (s) => String(s || "").replace(/([,;])/g, "\\$1").replace(/\n/g, "\\n");

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//" + escapeText(studioName) + "//Randevu//TR",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    "UID:" + crypto.randomUUID() + "@nail-art-randevu",
    "DTSTAMP:" + toIcsDate(new Date()),
    "DTSTART:" + toIcsDate(start),
    "DTEND:" + toIcsDate(end),
    "SUMMARY:" + escapeText(studioName + " Randevusu"),
    "LOCATION:" + escapeText(studioAddress),
    "DESCRIPTION:" + escapeText(note || "Nail art randevunuz"),
    "BEGIN:VALARM",
    "TRIGGER:-PT2H",
    "ACTION:DISPLAY",
    "DESCRIPTION:Randevu hatırlatması",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "randevu.ics";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
