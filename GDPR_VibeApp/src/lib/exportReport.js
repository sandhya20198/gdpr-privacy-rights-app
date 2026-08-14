/**
 * Report export.
 *
 * Two audiences, two documents. The subject-facing response is written for the
 * person; the internal record adds module and field API names, the modules-scanned
 * count and the schema resolution timestamp for the compliance file.
 *
 * Rendered from the report already in state and printed via the browser, so no
 * PDF library has to be shipped.
 */

import { fn } from "./vibe.js";
import { CONTACT_MODULE, TENANT_MODULE } from "./engine.js";

export const EXPORT_KINDS = {
  dsar: { title: "Data Subject Access response", outcome: "dsar-response" },
  internal: { title: "Internal audit record", outcome: "internal-record" },
};

const FRAME_ID = "prc-print-frame";

/**
 * Produce one export and record it against the case. Call this straight from a
 * click handler — there is no chooser step.
 */
export async function exportReport({ report, caseRef, actor, kind = "dsar", onAudited }) {
  const html = buildHtml(report, caseRef, kind, actor);

  try {
    await fn("audit-log", {
      actorEmail: actor,
      action: "EXPORT",
      referenceNo: caseRef,
      outcome: EXPORT_KINDS[kind].outcome,
      detail: `${report.counts.records} records across ${report.counts.modulesWithData} modules`,
    });
    onAudited?.();
  } catch (_) { /* an export must not fail because the audit write did */ }

  printDocument(html);
}

/**
 * Print from a hidden iframe in THIS document rather than a new window.
 *
 * A `window.open` popup is the obvious way to do this and the wrong one: popup
 * blockers return null, and the app is meant to run embedded in Facilio as a
 * connected app, where the surrounding frame may forbid popups outright. Either
 * way the export silently does nothing. An iframe is same-origin, cannot be
 * popup-blocked, and takes the user straight to Save-as-PDF.
 */
function printDocument(html) {
  // One frame, reused — repeated exports must not accumulate DOM nodes.
  let frame = document.getElementById(FRAME_ID);
  if (!frame) {
    frame = document.createElement("iframe");
    frame.id = FRAME_ID;
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("tabindex", "-1");
    // Off-screen at real page dimensions. NOT display:none or visibility:hidden —
    // an unrendered frame lays nothing out and prints blank.
    frame.style.cssText =
      "position:fixed;left:-10000px;top:0;width:210mm;height:297mm;border:0;opacity:0;pointer-events:none";
    document.body.appendChild(frame);
  }

  const doc = frame.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();

  // Let the frame's own document lay out before printing, or the preview can
  // come out blank. focus() first — Safari prints the wrong frame without it.
  const go = () => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
  };
  if (doc.readyState === "complete") setTimeout(go, 100);
  else frame.onload = () => setTimeout(go, 100);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/**
 * The subject's own record and the parent Tenant hold a handful of fields on a
 * single record each, so they stay FIELD-wise: one row per field, which is the
 * shape that carries the per-field classification legibly.
 */
function identityTable(record, internal) {
  return `
    <div class="rec">
      <table>
        <thead><tr><th>Field</th><th>Value held</th><th>Classification</th></tr></thead>
        <tbody>
          ${(record.fields ?? []).map((f) => `
            <tr>
              <td>${esc(f.label)}${internal ? `<div class="api">${esc(f.field)}</div>` : ""}</td>
              <td>${esc(f.value)}</td>
              <td>${esc(f.klass)}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

/* Fields that name a record — these lead the column order. */
const NAME_FIELDS = ["subject", "name", "title"];

/**
 * Columns for a module's record table, as the UNION of the fields present across
 * its records. The union matters because the engine drops null-valued fields per
 * record, so record A may carry a Description that record B does not — taking the
 * first record's fields as the header would silently truncate the rest.
 *
 * Order: the naming field, then the lookup that put the records in the report,
 * then everything else in engine order (Indirect → Content → Metadata).
 */
function columnsFor(group) {
  const byField = new Map();
  for (const r of group.records) {
    for (const f of r.fields ?? []) {
      if (!byField.has(f.field)) byField.set(f.field, { field: f.field, label: f.label, klass: f.klass });
    }
  }

  const isLookup = (name) =>
    (group.lookupFields ?? []).some((lf) => lf.name === name) ||
    group.records.some((r) => (r.via ?? []).includes(name));

  const rank = (c) => (NAME_FIELDS.includes(c.field) ? 0 : isLookup(c.field) ? 1 : 2);

  return [...byField.values()]
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
    .map((x) => x.c);
}

function valueOf(record, field) {
  const hit = (record.fields ?? []).find((f) => f.field === field);
  return hit?.value ?? null;
}

/**
 * Related records, module by module: ONE table per module with a row per record,
 * so the reader compares records down a column instead of paging through a
 * separate field table for every record.
 */
function recordTable(group, internal) {
  const cols = columnsFor(group);
  const anyAttachments = group.records.some((r) => r.attachments?.length);

  return `
    <table class="recs">
      <thead>
        <tr>
          <th class="num">ID</th>
          ${cols.map((c) => `<th>${esc(c.label)}
            <div class="api">${internal ? `${esc(c.field)} · ` : ""}${esc(c.klass)}</div></th>`).join("")}
          ${anyAttachments ? `<th>Attachments</th>` : ""}
        </tr>
      </thead>
      <tbody>
        ${group.records.map((r) => `
          <tr>
            <td class="num">${esc(r.id)}</td>
            ${cols.map((c) => `<td>${esc(valueOf(r, c.field) ?? "—")}</td>`).join("")}
            ${anyAttachments
              ? `<td>${r.attachments?.length ? r.attachments.map((a) => esc(a.name)).join("<br>") : "—"}</td>`
              : ""}
          </tr>`).join("")}
      </tbody>
    </table>`;
}

/**
 * The summary as an analytics band: four figures, then where those records
 * actually sit. One series, so the heading names it and no legend is needed;
 * the value rides the bar tip, and bars are capped at 88% of the plot so the
 * longest one never collides with its own label.
 *
 * The bar fill is a background, and browsers drop backgrounds when "print
 * background graphics" is off — hence print-color-adjust in the stylesheet, and
 * hence the value stays a text label rather than living inside the fill, so the
 * numbers survive even when the ink does not.
 */
function analyticsBand(report, internal) {
  const c = report.counts;
  const r = report.retention;

  const tiles = [
    { label: "Records held", value: c.records, sub: "incl. contact &amp; tenant" },
    { label: "Modules with data", value: c.modulesWithData, sub: `of ${c.moduleCount} scanned` },
    { label: "Linked by lookup", value: c.linkedRecords,
      sub: `${c.lookupModules} module${c.lookupModules === 1 ? "" : "s"} link here` },
    { label: "Attachments", value: c.attachments, sub: "on the subject's records" },
  ];

  const bars = [
    { name: "Tenant Contact", n: 1 },
    ...(report.parent ? [{ name: "Tenants", n: 1 }] : []),
    ...report.moduleGroups.map((g) => ({ name: g.displayName, n: g.records.length })),
  ].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));

  const max = Math.max(...bars.map((b) => b.n), 1);

  return `
    <div class="tiles">
      ${tiles.map((t) => `
        <div class="tile">
          <div class="tile-l">${t.label}</div>
          <div class="tile-v">${t.value}</div>
          <div class="tile-s">${t.sub}</div>
        </div>`).join("")}
    </div>

    <div class="chart">
      <div class="chart-h">Records by module</div>
      ${bars.map((b) => `
        <div class="bar-row">
          <div class="bar-name">${esc(b.name)}</div>
          <div class="bar-plot">
            <div class="bar-fill" style="width:${((b.n / max) * 88).toFixed(1)}%"></div>
            <span class="bar-val">${b.n}</span>
          </div>
        </div>`).join("")}
      <div class="chart-f">
        Retention: ${r.open} open · ${r.closed} closed${
          r.oldestMonths !== null ? ` · oldest ${r.oldestMonths} month${r.oldestMonths === 1 ? "" : "s"}` : ""
        }
      </div>
    </div>

    ${internal ? `<div class="kv">
      <div>Modules scanned</div><div>${c.moduleCount}</div>
      <div>Modules linking to Tenant Contact</div><div>${c.lookupModules}</div>
      <div>Schema resolved</div><div>${esc(report.schemaFetchedAt ?? "—")}</div>
      <div>Failed queries</div><div>${report.failures?.length ?? 0}</div>
    </div>` : ""}`;
}

function buildHtml(report, caseRef, kind, actor) {
  const internal = kind === "internal";
  const now = new Date().toLocaleString();

  const heading = (name, api, count) => `
    <h3>${esc(name)}${internal ? ` <span class="api">${esc(api)}</span>` : ""}
      <span class="api">${count} record${count === 1 ? "" : "s"}</span></h3>`;

  const sections = [
    heading("Tenant Contact", CONTACT_MODULE, 1),
    identityTable({ fields: report.contact.fields }, internal),
    ...(report.parent
      ? [heading("Tenants", TENANT_MODULE, 1), identityTable({ fields: report.parent.fields }, internal)]
      : []),
    ...report.moduleGroups.flatMap((g) => [
      heading(g.displayName, g.module, g.records.length),
      recordTable(g, internal),
    ]),
  ].join("");

  // NOTE ON COLOURS: this is a standalone print document opened in a new window.
  // It has no FDS runtime, so var(--colors-*) would resolve to nothing — and a
  // printed page must stay dark-on-white regardless of the app's theme. The
  // literal values below are the FDS light-theme hexes, used deliberately here
  // and nowhere in the app UI.
  return `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(caseRef)} — ${esc(EXPORT_KINDS[kind].title)}</title>
<style>
  @page { margin: 18mm; }
  body { font: 11pt/1.5 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #283648;
         -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  h1 { font-size: 18pt; margin: 0 0 2mm; }
  h2 { font-size: 12pt; margin: 8mm 0 2mm; border-bottom: 1px solid #dbdbdb; padding-bottom: 1.5mm; }
  h3 { font-size: 11pt; margin: 6mm 0 2mm; }
  .sub { color: #607796; font-size: 9.5pt; }
  .api { color: #607796; font-weight: 400; font-family: ui-monospace, Menlo, monospace; font-size: 8.5pt; }
  table { width: 100%; border-collapse: collapse; margin: 2mm 0 3mm; }
  th { text-align: left; font-size: 8pt; text-transform: uppercase; letter-spacing: .4px; color: #607796;
       border-bottom: 1px solid #dbdbdb; padding: 1.5mm 2mm; }
  td { font-size: 9.5pt; border-bottom: 1px solid #eae9e9; padding: 1.8mm 2mm; vertical-align: top; }
  .rec { break-inside: avoid; page-break-inside: avoid; }
  .kv { display: grid; grid-template-columns: 46mm 1fr; gap: 1mm 4mm; font-size: 9.5pt; margin: 3mm 0; }
  .kv div:nth-child(odd) { color: #607796; }
  .note { background: #fafafa; border: 1px solid #eae9e9; padding: 3mm; font-size: 9pt; color: #384a62; margin-top: 6mm; }

  /* Related-record tables carry many columns, so they run a step smaller, wrap
     long free text rather than overflowing the page, and repeat their header
     when a module's records span a page break. */
  table.recs { table-layout: auto; }
  table.recs thead { display: table-header-group; }
  table.recs th, table.recs td { font-size: 8.5pt; padding: 1.5mm 1.8mm; word-break: break-word; }
  table.recs th .api { display: block; font-size: 7pt; text-transform: none; letter-spacing: 0; margin-top: .4mm; }
  table.recs tr { break-inside: avoid; page-break-inside: avoid; }
  table.recs .num { font-variant-numeric: tabular-nums; white-space: nowrap; }

  /* Analytics band */
  .tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; margin: 3mm 0 6mm;
           break-inside: avoid; page-break-inside: avoid; }
  .tile { border: 1px solid #dbdbdb; padding: 2.5mm 3mm; }
  .tile-l { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .4px; color: #607796; }
  .tile-v { font-size: 18pt; font-weight: 600; color: #283648; line-height: 1.15; margin: .8mm 0; }
  .tile-s { font-size: 7.5pt; color: #607796; }
  .chart { break-inside: avoid; page-break-inside: avoid; margin-bottom: 2mm; }
  .chart-h { font-size: 8pt; text-transform: uppercase; letter-spacing: .4px; color: #607796; margin-bottom: 2.5mm; }
  .bar-row { display: grid; grid-template-columns: 44mm 1fr; gap: 3mm; align-items: center; margin-bottom: 2mm; }
  .bar-name { font-size: 9pt; text-align: right; color: #384a62; }
  .bar-plot { display: flex; align-items: center; gap: 2mm; border-left: 1px solid #dbdbdb; padding-left: 1.5mm; }
  .bar-fill { height: 2.4mm; min-width: .8mm; background: #0024d6; border-radius: 0 1mm 1mm 0; }
  .bar-val { font-size: 9pt; font-weight: 600; color: #283648; font-variant-numeric: tabular-nums; }
  .chart-f { font-size: 8.5pt; color: #607796; margin-top: 3mm; }
</style></head><body>
  <h1>${esc(EXPORT_KINDS[kind].title)}</h1>
  <div class="sub">Case ${esc(caseRef)} · generated ${esc(now)}${internal ? ` · by ${esc(actor)}` : ""}</div>

  <h2>Subject</h2>
  <div class="kv">
    <div>Name</div><div>${esc(report.contact.name)}</div>
    <div>Email</div><div>${esc(report.contact.email)}</div>
    ${report.contact.phone ? `<div>Phone</div><div>${esc(report.contact.phone)}</div>` : ""}
    ${report.parent ? `<div>Tenant</div><div>${esc(report.parent.name)}</div>` : ""}
    ${internal ? `<div>Contact record</div><div>#${esc(report.contact.id)}</div>
    ${report.parent ? `<div>Tenant record</div><div>#${esc(report.parent.id)}</div>` : ""}` : ""}
  </div>

  <h2>Summary</h2>
  ${analyticsBand(report, internal)}

  <h2>Where the data lives</h2>
  ${sections}

  <div class="note">
    <strong>Method.</strong> Records are included only where they hold a lookup to the subject's Tenant
    Contact record. Free text is never matched, and notes are not scanned, because a text match cannot be
    attributed to one individual with certainty. Attachments are listed where the parent record is
    provably the subject's.
    ${report.failures?.length ? ` <strong>This report is incomplete:</strong> ${report.failures.length} query(ies) failed, so the counts may understate what exists.` : ""}
  </div>
</body></html>`;
}
