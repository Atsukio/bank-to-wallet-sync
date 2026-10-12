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
    // The markup and styling of the first few amount cells (digits masked): shows how a debit is marked.
    amountCells: [...document.querySelectorAll('body *')]
      .filter((el) => !el.children.length && /\d[\d,]*\.\d{2}/.test(el.textContent || '') && (el.textContent || '').length < 24)
      .slice(0, 4).map((el) => {
        const cell = el.closest('td,[role="cell"],[role="gridcell"]') || el;
        return {
          html: cell.outerHTML.replace(/\d/g, '9').replace(/\s+/g, ' ').slice(0, 300),
          color: getComputedStyle(el).color,
          before: getComputedStyle(el, '::before').content,
          after: getComputedStyle(el, '::after').content,
          cellBefore: getComputedStyle(cell, '::before').content,
        };
      }),
    // How amounts are written, with every digit replaced by 9 so no value is revealed.
    amountShapes: [...new Set([...document.querySelectorAll('body *')]
      .filter((el) => !el.children.length && /\d[\d,]*\.\d{2}/.test(el.textContent || '') && (el.textContent || '').length < 24)
      .map((el) => label(el) + ' "' + clean(el.textContent).replace(/\d/g, '9') + '"'))].slice(0, 12),
    dateElementSamples: dateEls.slice(0, 3).map((el) => [label(el), label(el.parentElement), label(el.parentElement?.parentElement || el)].join(' < ')),
  };
}

// Tells the side panel when the page's content changes (pagination and filters on Maybank2u update the table
// without a navigation). Installs once per frame; only a "something changed" ping is sent, never page content.
export function watchPage() {
  if (window.__b2wWatching) return;
  window.__b2wWatching = true;
  let timer;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => { try { chrome.runtime.sendMessage({ type: 'b2w-page-changed' }); } catch { /* panel closed */ } }, 250);
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
}

// Best-effort guess at which bank account the page is showing, so the panel can pick the matching Wallet account:
// { label, digits } (digits = last 4 of a card/account number, if one is shown) or null. It looks at headings, the
// selected option of any account drop-down, and elements whose class mentions "account" or "card", and takes the first
// short text that names an account type and the first that holds a (partly masked) number. It never reads amounts.
export function detectAccount() {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const TYPE = /account|card|savings|current|credit|visa|master|amex|akaun|kad/i;
  const NOISE = /transaction history|all transaction|statement|recent|search|filter|date|amount|description/i;
  const NUM = /(?:\d{4}[\s-]+){2,3}\d{2,4}|(?:[xX*\u2022\u25CF]{2,}[\s-]*)+\d{3,4}|\b\d{10,16}\b/;
  const els = document.querySelectorAll('h1,h2,h3,h4,[role="heading"],select,[class*="account" i],[class*="card" i],[id*="account" i]');
  let label = '', digits = '';
  for (const el of els) {
    const text = clean(el.tagName === 'SELECT' ? el.selectedOptions?.[0]?.textContent : el.innerText);
    if (text.length < 4 || text.length > 90) continue;
    const num = text.match(NUM);
    if (!digits && num) digits = num[0].replace(/\D/g, '').slice(-4);
    if (!label && TYPE.test(text) && !NOISE.test(text)) label = clean(text.replace(NUM, ''));
    if (label && digits) break;
  }
  return label || digits ? { label, digits } : null;
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
    // Unicode minus/dashes count as a minus sign; DR, DB and DEBIT mark a debit.
    s = clean(s).replace(/[\u2212\u2012\u2013\u2014\uFE63\uFF0D]/g, '-');
    if (!s || !/\d/.test(s)) return null;
    const neg = /^\s*(RM|MYR)?\s*-|-\s*(RM|MYR)?\s*$|\(.*\)|\b(DR|DB|DEBIT)\b/i.test(s);
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

  // A row of cell texts that also remembers the cell elements (cells.els), for reading signs the text doesn't carry.
  const withEls = (els) => { const cells = els.map((c) => clean(c.innerText)); cells.els = els; return cells; };

  // Banks often show a debit only visually: a minus drawn by CSS (::before) or red text. Returns -1, 1 or 0 (unknown).
  function visualSign(el) {
    if (!el) return 0;
    const nodes = [el, ...el.querySelectorAll('*')];
    for (const n of nodes) {
      for (const pseudo of ['::before', '::after']) {
        const c = getComputedStyle(n, pseudo).content || '';
        if (/^["']\s*[-\u2212\u2013]\s*["']$/.test(c)) return -1;
        if (/^["']\s*\+\s*["']$/.test(c)) return 1;
      }
    }
    const text = nodes.find((n) => !n.children.length && /\d/.test(n.textContent || '')) || el;
    const [r, g, b] = (getComputedStyle(text).color.match(/\d+(\.\d+)?/g) || []).map(Number);
    if (r > 150 && g < 110 && b < 110) return -1; // red
    if (g > r + 30 && g > b + 10 && r < 140) return 1; // green
    return 0;
  }

  // An amount with no sign marker in its text takes its sign from how it looks.
  function signedAmount(text, el) {
    const v = parseAmount(text);
    if (v === null) return null;
    const plus = /^\s*\+|\+\s*$/.test(text);
    return v > 0 && !plus && visualSign(el) === -1 ? -v : v;
  }

  // Normalises both <table> markup and ARIA grids (role="table"/"grid") into rows of cell texts.
  function gridsIn(doc) {
    const grids = [];
    doc.querySelectorAll('table').forEach((t) => {
      const rows = [...t.querySelectorAll('tr')].map((tr) => withEls([...tr.querySelectorAll('th,td')]));
      grids.push(rows);
    });
    doc.querySelectorAll('[role="table"],[role="grid"]').forEach((g) => {
      const rows = [...g.querySelectorAll('[role="row"]')].map((r) =>
        withEls([...r.querySelectorAll('[role="columnheader"],[role="cell"],[role="gridcell"]')]));
      grids.push(rows);
    });
    return grids;
  }

  // The sign is the riskiest thing to misread, since a wrong one adds an expense as income. When the table has a
  // Balance column, the balance movement between neighbouring rows is the ground truth, whatever the amount's format.
  // Rows whose balances don't line up (or have no neighbour) keep the sign read from the amount text, but if that
  // text proved wrong elsewhere on the page, they are flagged unsure so the panel doesn't add them unchecked.
  function reconcileSigns(list) {
    const verified = new Set();
    let textWrong = false;
    const first = list[0]?.date, last = list.at(-1)?.date;
    const order = first > last ? 'newest-first' : first < last ? 'oldest-first' : 'unknown';
    list.forEach((r, i) => {
      if (r.bal == null) return;
      const move = (j) => {
        const n = list[j];
        const d = n && n.bal != null ? Math.round((r.bal - n.bal) * 100) / 100 : null;
        return d !== null && Math.abs(Math.abs(d) - Math.abs(r.amount)) < 0.005 ? d : null;
      };
      // Newest-first: this row's effect is its balance minus the next row's. Oldest-first: minus the previous row's.
      const moves = (order === 'newest-first' ? [move(i + 1)] : order === 'oldest-first' ? [move(i - 1)] : [move(i + 1), move(i - 1)])
        .filter((d) => d !== null);
      if (moves.length && moves.every((d) => Math.sign(d) === Math.sign(moves[0]))) {
        if (Math.sign(moves[0]) !== Math.sign(r.amount)) textWrong = true;
        r.amount = moves[0];
        verified.add(r);
      }
    });
    if (textWrong) list.forEach((r) => { if (r.bal != null && !verified.has(r)) r.unsure = true; });
  }

  const out = [];
  for (const rows of gridsIn(document)) {
    const found = [];
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
      if (amount === null && map.amount !== undefined) amount = signedAmount(cells[map.amount], cells.els?.[map.amount]);
      if (amount === null || amount === 0) continue;
      const desc = map.desc !== undefined
        ? cells[map.desc]
        : cells.filter((_, i) => !mapped.has(i)).join(' ');
      const bal = map.balance !== undefined ? parseAmount(cells[map.balance]) : null;
      found.push({ date, desc: clean(desc) || '(no description)', amount: Math.round(amount * 100) / 100, bal });
    }
    reconcileSigns(found);
    out.push(...found.map(({ bal, ...tx }) => tx));
  }
  return out;
}
