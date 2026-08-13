import React, { useState } from "react";
import { fn } from "../lib/vibe.js";
import { IconX, IconDownload, IconFile } from "../lib/icons.jsx";

/**
 * Two audiences, two documents. The subject-facing response shows values but no
 * internal ids; the internal record carries ids and schema provenance.
 * Rendered from the report already in state and printed via the browser, so no
 * PDF library has to be shipped.
 */
export default function ExportDialog({ report, caseRef, actor, onClose, onAudited }) {
  const [kind, setKind] = useState("dsar");

  async function go() {
    try {
      await fn("audit-log", {
        actorEmail: actor,
        action: "EXPORT",
        referenceNo: caseRef,
        outcome: kind === "dsar" ? "dsar-response" : "internal-record",
        detail: `${report.counts.records} records across ${report.counts.modulesWithData} modules`,
      });
      onAudited?.();
    } catch (_) { /* an export must not fail because the audit write did */ }

    const html = buildHtml(report, caseRef, kind, actor);
    const w = window.open("", "_blank");
    if (!w) { alert("Allow pop-ups to produce the PDF."); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
    onClose();
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Export report">
        <div className="drawer__head">
          <div className="stack-s" style={{ flex: 1, minWidth: 0 }}>
            <span className="t-eyebrow">Case {caseRef}</span>
            <span className="t-h20">Export report</span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><IconX size={16} /></button>
        </div>

        <div className="drawer__body">
          <div className="stack">
            <label className="card" style={{ cursor: "pointer" }}>
              <div className="row" style={{ alignItems: "flex-start" }}>
                <input type="radio" name="kind" checked={kind === "dsar"} onChange={() => setKind("dsar")}
                       style={{ marginTop: 3, accentColor: "var(--colors-backgroundPrimaryDefault)" }} />
                <div>
                  <div className="t-h14">Data Subject Access response</div>
                  <div className="t-cap">
                    For sending to the person. Shows what is held and where, with values but no internal
                    record ids.
                  </div>
                </div>
              </div>
            </label>

            <label className="card" style={{ cursor: "pointer" }}>
              <div className="row" style={{ alignItems: "flex-start" }}>
                <input type="radio" name="kind" checked={kind === "internal"} onChange={() => setKind("internal")}
                       style={{ marginTop: 3, accentColor: "var(--colors-backgroundPrimaryDefault)" }} />
                <div>
                  <div className="t-h14">Internal audit record</div>
                  <div className="t-cap">
                    For your compliance file. Adds record ids, module API names, the modules-scanned
                    count and the schema resolution timestamp.
                  </div>
                </div>
              </div>
            </label>

            <p className="t-cap" style={{ margin: 0 }}>
              Opens a print-ready page — choose &ldquo;Save as PDF&rdquo;. The export is recorded in the
              audit log against the case reference.
            </p>
          </div>
        </div>

        <div className="drawer__foot">
          <button className="fds-btn fds-btn--secondary" onClick={onClose}>Cancel</button>
          <span className="spacer" />
          <button className="fds-btn fds-btn--primary" onClick={go}>
            <IconDownload /> Produce PDF
          </button>
        </div>
      </aside>
    </>
  );
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function buildHtml(report, caseRef, kind, actor) {
  const internal = kind === "internal";
  const now = new Date().toLocaleString();

  const groups = [
    { name: "Tenant Contact", api: "custom_tenantcontact",
      records: [{ id: report.contact.id, title: report.contact.name, fields: report.contact.fields }] },
    ...(report.parent
      ? [{ name: "Tenants", api: "custom_tenants",
           records: [{ id: report.parent.id, title: report.parent.name, fields: report.parent.fields }] }]
      : []),
    ...report.moduleGroups.map((g) => ({ name: g.displayName, api: g.module, records: g.records })),
  ];

  const sections = groups.map((g) => `
    <h3>${esc(g.name)}${internal ? ` <span class="api">${esc(g.api)}</span>` : ""}
      <span class="api">${g.records.length} record${g.records.length === 1 ? "" : "s"}</span></h3>
    ${g.records.map((r) => `
      <div class="rec">
        <div class="rec-h">${esc(r.title)}${internal ? ` <span class="api">#${esc(r.id)}</span>` : ""}</div>
        <table>
          <thead><tr><th>Field</th><th>Value held</th><th>Classification</th></tr></thead>
          <tbody>
            ${(r.fields ?? []).map((f) => `
              <tr>
                <td>${esc(f.label)}${internal ? `<div class="api">${esc(f.field)}</div>` : ""}</td>
                <td>${esc(f.value)}</td>
                <td>${esc(f.klass)}</td>
              </tr>`).join("")}
          </tbody>
        </table>
        ${r.attachments?.length ? `<div class="att"><strong>Attachments:</strong> ${r.attachments.map((a) => esc(a.name)).join(", ")}</div>` : ""}
      </div>`).join("")}
  `).join("");

  // NOTE ON COLOURS: this is a standalone print document opened in a new window.
  // It has no FDS runtime, so var(--colors-*) would resolve to nothing — and a
  // printed page must stay dark-on-white regardless of the app's theme. The
  // literal values below are the FDS light-theme hexes, used deliberately here
  // and nowhere in the app UI.
  return `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(caseRef)} — ${internal ? "Internal audit record" : "Data Subject Access response"}</title>
<style>
  @page { margin: 18mm; }
  body { font: 11pt/1.5 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #283648; }
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
  .rec-h { font-weight: 500; margin-top: 3mm; }
  .kv { display: grid; grid-template-columns: 46mm 1fr; gap: 1mm 4mm; font-size: 9.5pt; margin: 3mm 0; }
  .kv div:nth-child(odd) { color: #607796; }
  .att { font-size: 9pt; color: #384a62; margin: 1mm 0 3mm; }
  .note { background: #fafafa; border: 1px solid #eae9e9; padding: 3mm; font-size: 9pt; color: #384a62; margin-top: 6mm; }
</style></head><body>
  <h1>${internal ? "Internal audit record" : "Data Subject Access response"}</h1>
  <div class="sub">Case ${esc(caseRef)} · generated ${esc(now)}${internal ? ` · by ${esc(actor)}` : ""}</div>

  <h2>Subject</h2>
  <div class="kv">
    <div>Name</div><div>${esc(report.contact.name)}</div>
    <div>Email</div><div>${esc(report.contact.email)}</div>
    ${report.contact.phone ? `<div>Phone</div><div>${esc(report.contact.phone)}</div>` : ""}
    ${report.parent ? `<div>Tenant</div><div>${esc(report.parent.name)}</div>` : ""}
  </div>

  <h2>Summary</h2>
  <div class="kv">
    <div>Records held</div><div>${report.counts.records}</div>
    <div>Modules with data</div><div>${report.counts.modulesWithData}</div>
    <div>Linked by lookup</div><div>${report.counts.linkedRecords}</div>
    <div>Attachments</div><div>${report.counts.attachments}</div>
    ${internal ? `<div>Modules scanned</div><div>${report.counts.moduleCount}</div>
    <div>Modules linking to Tenant Contact</div><div>${report.counts.lookupModules}</div>
    <div>Schema resolved</div><div>${esc(report.schemaFetchedAt ?? "—")}</div>
    <div>Failed queries</div><div>${report.failures?.length ?? 0}</div>` : ""}
  </div>

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
