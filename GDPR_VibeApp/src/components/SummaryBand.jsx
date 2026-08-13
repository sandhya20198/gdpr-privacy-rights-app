import React from "react";

/**
 * The four questions answered at a glance: WHERE the data is, HOW MUCH there is,
 * WHAT is stored, and WHETHER it can be erased.
 * Values stay neutral per FDS — no coloured big numbers.
 */
export default function SummaryBand({ report, caseRef }) {
  const c = report.counts;
  const r = report.retention;

  return (
    <div className="fds-widget">
      <div className="fds-widget__header">
        <div className="row" style={{ minWidth: 0 }}>
          <span className="t-eyebrow">Case</span>
          <span className="t-mono t-body">{caseRef}</span>
        </div>
        <span className="t-cap-d nowrap">
          {report.schemaFromCache ? "schema from cache" : "schema resolved live"}
        </span>
      </div>

      <div className="fds-widget__body fds-widget__body--flush">
        <div className="stat-grid">
          <div className="stat">
            <span className="stat__label">Records</span>
            <span className="stat__value">{c.records}</span>
            <span className="stat__sub">incl. contact &amp; tenant</span>
          </div>
          <div className="stat">
            <span className="stat__label">Modules with data</span>
            <span className="stat__value">{c.modulesWithData}</span>
            <span className="stat__sub">of {c.moduleCount} scanned</span>
          </div>
          <div className="stat">
            <span className="stat__label">Linked by lookup</span>
            <span className="stat__value">{c.linkedRecords}</span>
            <span className="stat__sub">{c.lookupModules} module{c.lookupModules === 1 ? "" : "s"} link here</span>
          </div>
          <div className="stat">
            <span className="stat__label">Anonymizable fields</span>
            <span className="stat__value">{c.anonymizableFields}</span>
            <span className="stat__sub">across {report.parent ? 2 : 1} record{report.parent ? "s" : ""}</span>
          </div>
        </div>

        {/* Subject identity — full-bleed tonal band, flush to the card edges */}
        <div
          style={{
            background: "var(--colors-backgroundMidgroundSubtle)",
            borderTop: "1px solid var(--colors-borderNeutralBaseSubtler)",
            padding: "var(--spacing-containerXLarge) var(--spacing-containerXxLarge)",
          }}
        >
          <div className="row-wrap">
            <span className="t-eyebrow">Subject</span>
            <span className="t-h14">{report.contact.name}</span>
            <span className="t-cap">·</span>
            <span className="t-desc t-mono">{report.contact.email}</span>
            {report.parent && (
              <>
                <span className="t-cap">·</span>
                <span className="t-desc">{report.parent.name}</span>
              </>
            )}
            {report.contact.isPrimary && <span className="chip">Primary contact</span>}
            {report.alreadyAnonymized && <span className="chip chip--flag">Already anonymized</span>}
          </div>

          <div className="row-wrap" style={{ marginTop: "var(--spacing-containerLarge)" }}>
            <span className="t-cap">
              Retention: {r.open} open · {r.closed} closed
              {r.oldestMonths !== null && <> · oldest {r.oldestMonths} month{r.oldestMonths === 1 ? "" : "s"}</>}
            </span>
            {c.attachments > 0 && (
              <span className="t-cap">· {c.attachments} attachment{c.attachments === 1 ? "" : "s"}</span>
            )}
          </div>
        </div>
      </div>

      <div className="fds-widget__footer">
        <span className="t-cap">
          All findings matched by Tenant Contact lookup. Notes are not scanned, and free text is never
          matched or modified.
        </span>
      </div>
    </div>
  );
}
