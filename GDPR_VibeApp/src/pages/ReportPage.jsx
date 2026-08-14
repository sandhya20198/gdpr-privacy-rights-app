import React, { useState } from "react";
import SummaryBand from "../components/SummaryBand.jsx";
import ModuleBreakdown from "../components/ModuleBreakdown.jsx";
import AnonymizePanel from "../components/AnonymizePanel.jsx";
import { exportReport } from "../lib/exportReport.js";
import { EmptyState, PartialBanner, SuccessBanner, InfoBanner } from "../components/states.jsx";
import { IconSearch, IconDownload, IconFile, IconEraser, IconRefresh, IconCheck } from "../lib/icons.jsx";

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
            onClick={() => onRescan(report.email)}
            title="Re-resolve the schema and re-run every query"
          >
            <IconRefresh /> Rescan schema
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
            className="fds-btn fds-btn--tertiary"
            onClick={() => runExport("internal")}
            disabled={!!exporting}
            title="Prints the internal audit record for your compliance file — adds API names and schema provenance"
          >
            <IconFile /> {exporting === "internal" ? "Exporting…" : "Internal record"}
          </button>
          <button
            className="fds-btn fds-btn--danger"
            onClick={() => setShowAnon(true)}
            disabled={report.alreadyAnonymized || !!erased}
            title={report.alreadyAnonymized ? "This contact is already anonymized" : "Irreversibly pseudonymise this contact"}
          >
            <IconEraser /> Anonymize…
          </button>
        </div>

        {erased && <SuccessBanner token={erased.token} results={erased.results} />}

        <PartialBanner failures={report.failures} onRetry={() => onRescan(report.email)} />

        {report.alreadyAnonymized && !erased && (
          <InfoBanner title="This contact has already been anonymized">
            Its email matches the portal&apos;s redaction pattern, so there is nothing further to erase.
          </InfoBanner>
        )}

        {report.duplicateContacts?.length > 0 && (
          <InfoBanner title={`${report.duplicateContacts.length + 1} Tenant Contact records share this email`}>
            This report covers <span className="t-mono">#{report.contact.id}</span>. The others (
            {report.duplicateContacts.map((d) => `#${d.id}`).join(", ")}) need their own case — erasing
            one does not touch the rest.
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
