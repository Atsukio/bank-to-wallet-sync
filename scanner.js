// Injected into every frame of the Maybank2u tab via chrome.scripting.executeScript.
// Must stay self-contained: no imports, no references to outer scope.

// Describes how a frame is built when scanPage() finds nothing: markup shape only, never any text that
// could be a transaction, amount or account detail (header labels and class names are kept).
export function diagnosePage() {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim().slice(0, 30);
  const dateLike = /\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}[\s\-]+[A-Za-z]{3}[A-Za-z]*[\s,\-]+\d{4}/;
  const label = (el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '');
  const dateEls = [...document.querySelectorAll('body *')]
    .filter((el) => !el.children.length && dateLike.test(el.textContent || ''));
  return {
    page: location.hostname + location.pathname.replace(/\d{4,}/g, '#'),
    topFrame: window === top,
    tables: [...document.querySelectorAll('table')].map((t) => ({
      rows: t.querySelectorAll('tr').length,
      headers: [...t.querySelectorAll('th')].slice(0, 12).map((c) => clean(c.innerText)),
    })),
    ariaTables: document.querySelectorAll('[role="table"],[role="grid"]').length,
    ariaRows: document.querySelectorAll('[role="row"]').length,
    ariaHeaders: [...document.querySelectorAll('[role="columnheader"]')].slice(0, 12).map((c) => clean(c.innerText)),
    iframes: document.querySelectorAll('iframe').length,
    shadowHosts: [...document.querySelectorAll('*')].filter((el) => el.shadowRoot).length,
    elementsWithDates: dateEls.length,
    dateElementSamples: dateEls.slice(0, 3).map((el) => [label(el), label(el.parentElement), label(el.parentElement?.parentElement || el)].join(' < ')),
  };
}

export function scanPage() {
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (y, mo, d) => (mo < 1 || mo > 12 || d < 1 || d > 31 ? null : `${y}-${pad(mo)}-${pad(d)}`);

  function parseDate(s) {
    s = clean(s);
    let m;
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return iso(+m[1], +m[2], +m[3]);
    // Malaysian format is day-first: 11/10/2026
    if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/))) {
      let y = +m[3]; if (y < 100) y += 2000;
      return iso(y, +m[2], +m[1]);
    }
    if ((m = s.match(/^(\d{1,2})[\s\-]+([A-Za-z]{3})[A-Za-z]*[\s,\-]+(\d{4})/))) {
      const mo = MONTHS[m[2].toLowerCase()];
      return mo ? iso(+m[3], mo, +m[1]) : null;
    }
    return null;
  }

  function parseAmount(s) {
    s = clean(s);
    if (!s || !/\d/.test(s)) return null;
    const neg = /^-|RM\s*-|-\s*$|^\(.*\)$|\bDR\b/i.test(s);
    const v = parseFloat(s.replace(/[^0-9.]/g, ''));
    if (isNaN(v)) return null;
    return neg ? -v : v;
  }

  const ROLES = [
    ['date', /date|tarikh/i],
    ['debit', /debit|withdraw|money out|pengeluaran/i],
    ['credit', /credit|deposit|money in/i],
    ['amount', /amount|amaun|jumlah/i],
    ['balance', /balance|baki/i],
    ['desc', /desc|transaction|details|particular|keterangan|butiran/i],
  ];

  function mapHeader(cells) {
    const map = {};
    cells.forEach((text, i) => {
      for (const [role, re] of ROLES) {
        if (re.test(text) && map[role] === undefined) { map[role] = i; break; }
      }
    });
    return map;
  }

  // Normalises both <table> markup and ARIA grids (role="table"/"grid") into rows of cell texts.
  function gridsIn(doc) {
    const grids = [];
    doc.querySelectorAll('table').forEach((t) => {
      const rows = [...t.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('th,td')].map((c) => clean(c.innerText)));
      grids.push(rows);
    });
    doc.querySelectorAll('[role="table"],[role="grid"]').forEach((g) => {
      const rows = [...g.querySelectorAll('[role="row"]')].map((r) =>
        [...r.querySelectorAll('[role="columnheader"],[role="cell"],[role="gridcell"]')].map((c) => clean(c.innerText)));
      grids.push(rows);
    });
    return grids;
  }

  const out = [];
  for (const rows of gridsIn(document)) {
    const headerIdx = rows.findIndex((r) => {
      const m = mapHeader(r);
      return m.date !== undefined && (m.amount !== undefined || m.debit !== undefined || m.credit !== undefined);
    });
    if (headerIdx === -1) continue;
    const map = mapHeader(rows[headerIdx]);
    const mapped = new Set(Object.values(map));

    for (const cells of rows.slice(headerIdx + 1)) {
      const date = parseDate(cells[map.date]);
      if (!date) continue;
      let amount = null;
      if (map.debit !== undefined || map.credit !== undefined) {
        const dr = parseAmount(cells[map.debit]);
        const cr = parseAmount(cells[map.credit]);
        if (dr) amount = -Math.abs(dr);
        else if (cr) amount = Math.abs(cr);
      }
      if (amount === null && map.amount !== undefined) amount = parseAmount(cells[map.amount]);
      if (amount === null || amount === 0) continue;
      const desc = map.desc !== undefined
        ? cells[map.desc]
        : cells.filter((_, i) => !mapped.has(i)).join(' ');
      out.push({ date, desc: clean(desc) || '(no description)', amount: Math.round(amount * 100) / 100 });
    }
  }
  return out;
}
