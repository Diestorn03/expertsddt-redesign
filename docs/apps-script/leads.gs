/**
 * ExpertsDDT web leads: Google Apps Script bound to the "ExpertsDDT leads" spreadsheet.
 * Receives the site's three forms (contact, exocad-libraries, ddt-xchange), stores one row per submission in its own tab,
 * and emails Polanco for contact messages (reply goes to the visitor).
 * Deploy: Extensions > Apps Script > Deploy > New deployment > Web app, Execute as: Me, Who has access: Anyone.
 * The /exec URL goes in the PUBLIC_N8N_FORM_WEBHOOK repository variable (the name is historical).
 */
const NOTIFY_TO = 'polanco@expertsddt.com';
const TABS = {
  contact: ['Contact', ['Received', 'Name', 'Email', 'Clinic', 'Message', 'Language', 'Page']],
  'exocad-libraries': ['Libraries', ['Received', 'Name', 'Email', 'Version', 'Language', 'Page']],
  'ddt-xchange': ['DDT Xchange', ['Received', 'Email', 'Language', 'Page']],
};
const MAX = { name: 120, email: 200, clinic: 200, message: 4000, version: 40, lang: 5, page: 300 };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const raw = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, n);
// a cell that starts with = + - @ would be read as a formula
const cell = (v) => (/^[=+\-@]/.test(v) ? "'" + v : v);
const json = (o) => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);

function doGet() { return ContentService.createTextOutput('ok'); }

function doPost(e) {
  try {
    if (!e || !e.postData || e.postData.contents.length > 10000) return json({ ok: false });
    const d = JSON.parse(e.postData.contents);
    const def = TABS[String(d.source)];
    const f = {};
    ['name', 'email', 'clinic', 'message', 'version', 'lang', 'page'].forEach((k) => (f[k] = raw(d[k], MAX[k])));
    if (!def || !EMAIL.test(f.email)) return json({ ok: false });

    // the same person posting twice within half a minute (double click, retry) is stored once
    const cache = CacheService.getScriptCache();
    const key = String(d.source) + '|' + f.email.toLowerCase();
    if (cache.get(key)) return json({ ok: true });
    cache.put(key, '1', 30);

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      let sh = ss.getSheetByName(def[0]);
      if (!sh) { sh = ss.insertSheet(def[0]); sh.appendRow(def[1]); sh.setFrozenRows(1); }
      const by = { Received: new Date(), Name: f.name, Email: f.email, Clinic: f.clinic, Message: f.message, Version: f.version, Language: f.lang, Page: f.page };
      sh.appendRow(def[1].map((h) => (h === 'Received' ? by[h] : cell(by[h] || ''))));
    } finally { lock.releaseLock(); }

    if (d.source === 'contact') {
      try {
        MailApp.sendEmail({
          to: NOTIFY_TO,
          replyTo: f.email,
          name: 'ExpertsDDT website',
          subject: 'Website inquiry from ' + (f.name || f.email),
          body: 'Name: ' + f.name + '\nEmail: ' + f.email + '\nClinic: ' + f.clinic + '\nLanguage: ' + f.lang + '\nPage: ' + f.page + '\n\n' + f.message,
        });
      } catch (err) { /* the lead is already in the sheet: a mail failure must not lose it */ }
    }
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false });
  }
}
