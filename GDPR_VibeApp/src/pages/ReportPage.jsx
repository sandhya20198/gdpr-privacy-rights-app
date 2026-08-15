import React, { useState } from "react";
import SummaryBand from "../components/SummaryBand.jsx";
import ModuleBreakdown from "../components/ModuleBreakdown.jsx";
import AnonymizePanel from "../components/AnonymizePanel.jsx";
import { exportReport } from "../lib/exportReport.js";
import { EmptyState, PartialBanner, InfoBanner } from "../components/states.jsx";
import { IconSearch, IconDownload, IconEraser, IconCheck, IconAlert } from "../lib/icons.jsx";

export default function ReportPage({ report, caseRef, actor, onReset, onRescan, onAudited, onReplaceReport }) {
  const [showAnon, setShowAnon] = useState(false);
  const [exporting, setExporting] = useState(null);
  const [erased, setErased] = useState(null);

  /* One click, one document. The guard is there so a double-click cannot write
     two EXPORT rows to the audit log for a single intent. */
  async function runExport(kind) {
    if (exporting) return;
    setExporting(kind);
    try {
      await exportReport({ report, caseRef, actor, kind, onAudited });
    } finally {
      setExporting(null);
    }
  }

  /* ---------- the criteria stopped the search ---------- */
  if (report.blocked) {
    const e = report.eligibility ?? {};
    return (
      <div className="wrap wrap--narrow">
        <div className="stack">
          <div className="stack-s">
            <span className="t-eyebrow">Case {caseRef}</span>
            <h1 className="t-h20">{report.contact?.name}</h1>
          </div>

          <div className="banner banner--warning">
            <IconAlert />
            <div className="banner__body">
              <strong>
                Search stopped — {e.isPrimary ? "primary contact" : "not the primary contact"}
                {e.tenantName ? ` of ${e.tenantName}` : ""}
              </strong>
              <span className="t-desc">{e.reason}</span>
              <span className="t-cap">
                Contact status: {e.contactState || "unknown"}
                {e.tenantId ? ` · Tenant status: ${e.tenantState || "unknown"}` : ""}
              </span>
            </div>
          </div>

          <EmptyState
            title="No report was produced"
            body="This contact does not meet the anonymization criteria, so discovery was not run: no modules were swept, and nothing was disclosed or exported. Nothing in their records has changed."
          >
            <div className="row" style={{ marginTop: "var(--spacing-containerLarge)" }}>
              <button className="fds-btn fds-btn--primary" onClick={onReset}>
                <IconSearch /> New search
              </button>
            </div>
          </EmptyState>

          <span className="t-cap">
            The search was still recorded against case {caseRef} with a blocked outcome.
          </span>
        </div>
      </div>
    );
  }

  /* ---------- no contact for that address ---------- */
  if (!report.found) {
    return (
      <div className="wrap wrap--narrow">
        <div className="stack">
          <div className="stack-s">
            <span className="t-eyebrow">Case {caseRef}</span>
            <h1 className="t-h20">No match</h1>
          </div>

          <PartialBanner failures={report.failures} onRetry={() => onRescan(report.email)} />

          <EmptyState
            title="No Tenant Contact found for this address"
            body="This portal reports only data mapped to a Tenant Contact record, so a person who was never registered as one returns nothing here — by design, not because the sweep failed."
          >
            <div className="row" style={{ marginTop: "var(--spacing-containerLarge)" }}>
              <button className="fds-btn fds-btn--primary" onClick={onReset}>
                <IconSearch /> New search
              </button>
            </div>
          </EmptyState>

          <div className="card">
            <div className="kv">
              <span className="t-cap">Modules scanned</span>
              <span className="t-body">{report.moduleCount}</span>
              <span className="t-cap">Modules linking to Tenant Contact</span>
              <span className="t-body">{report.lookupModules}</span>
            </div>
          </div>

          <span className="t-cap">
            The search was still recorded against case {caseRef} with a no-match outcome.
          </span>
        </div>
      </div>
    );
  }

  const noLinked = report.counts.linkedRecords === 0;

  /* Resolved during the search, so the answer is on the page before anyone
     reaches for the Anonymize button. An unresolved verdict is not treated as a
     block — the handlers re-check and refuse on their own. */
  const elig = report.eligibility;
  const blocked = !!elig && elig.eligible === false && !report.alreadyAnonymized;

  return (
    <div className="wrap">
      <div className="stack">
        {/* page header */}
        <div className="row-wrap">
          <div className="stack-s" style={{ minWidth: 0, flex: 1 }}>
            <span className="t-eyebrow">Discovery report</span>
            <h1 className="t-h20">{report.contact.name}</h1>
          </div>
          <button className="fds-btn fds-btn--tertiary" onClick={onReset}>
            <IconSearch /> New search
          </button>
          <button
            className="fds-btn fds-btn--secondary"
            onClick={() => runExport("dsar")}
            disabled={!!exporting}
            title="Prints the subject-facing response — choose “Save as PDF”"
          >
            <IconDownload /> {exporting === "dsar" ? "Exporting…" : "Export PDF"}
          </button>
          <button
            className="fds-btn fds-btn--danger"
            onClick={() => setShowAnon(true)}
            disabled={report.alreadyAnonymized || !!erased || blocked}
            title={
              report.alreadyAnonymized ? "This contact is already anonymized"
                : blocked ? elig.reason
                : "Irreversibly pseudonymise this contact"
            }
          >
            <IconEraser /> Anonymize
          </button>
        </div>

        <PartialBanner failures={report.failures} onRetry={() => onRescan(report.email)} />

        {report.alreadyAnonymized && !erased && (
          <InfoBanner title="This contact has already been anonymized">
            Its email matches the portal&apos;s redaction pattern, so there is nothing further to anonymize.
          </InfoBanner>
        )}

        {blocked && !erased && (
          <div className="banner banner--warning">
            <IconAlert />
            <div className="banner__body">
              <strong>
                Cannot be anonymized yet — {report.contact.name}
                {elig.isPrimary ? " is the primary contact" : " is not the primary contact"}
                {elig.tenantName ? ` of ${elig.tenantName}` : ""}
              </strong>
              <span className="t-desc">{elig.reason}</span>
              <span className="t-cap">
                Contact status: {elig.contactState || "unknown"}
                {elig.tenantId ? ` · Tenant status: ${elig.tenantState || "unknown"}` : ""}
                {" · The report below is unaffected — disclosure is always allowed."}
              </span>
            </div>
          </div>
        )}

        {elig?.eligible && !report.alreadyAnonymized && !erased && (
          <InfoBanner title="This contact may be anonymized">
            {elig.reason} Use <strong>Anonymize</strong> to do it now, or the Schedule flow to book a date.
          </InfoBanner>
        )}

        {report.duplicateContacts?.length > 0 && (
          <InfoBanner title={`${report.duplicateContacts.length + 1} Tenant Contact records share this email`}>
            This report covers <span className="t-mono">#{report.contact.id}</span>. The others (
            {report.duplicateContacts.map((d) => `#${d.id}`).join(", ")}) need their own case —
            anonymizing one does not touch the rest.
          </InfoBanner>
        )}

        <SummaryBand report={report} caseRef={caseRef} />

        {noLinked ? (
          <EmptyState
            icon={<IconCheck size={32} />}
            title="Only the contact record itself"
            body={`No record in any of the ${report.counts.lookupModules} module(s) that link to Tenant Contact references this person. Their footprint is limited to their own contact${report.parent ? " and tenant" : ""} record.`}
          />
        ) : (
          <ModuleBreakdown report={report} />
        )}

        {report.modulesWithoutAttachmentSupport?.length > 0 && (
          <span className="t-cap">
            Attachments were not scanned for: {report.modulesWithoutAttachmentSupport.join(", ")} — no
            attachment action exists for those modules, so their file count is unknown rather than zero.
          </span>
        )}
      </div>

      {showAnon && (
        <AnonymizePanel
          report={report}
          caseRef={caseRef}
          actor={actor}
          onClose={() => setShowAnon(false)}
          onDone={(r) => {
            if (r?.ok || r?.partial) {
              setErased(r);
              onAudited?.();
              // Reflect the new state without forcing a re-search.
              onReplaceReport?.({ ...report, alreadyAnonymized: true });
            }
          }}
        />
      )}
    </div>
  );
}
