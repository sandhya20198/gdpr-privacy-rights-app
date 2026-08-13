import React, { useEffect, useState } from "react";
import { fn } from "../lib/vibe.js";
import { EmptyState, ErrorState } from "../components/states.jsx";
import { IconList, IconSpinner, IconRefresh } from "../lib/icons.jsx";

const ACTION_DOT = {
  SEARCH: "info",
  EXPORT: "accent",
  ANONYMIZE: "error",
  RESCAN: "neutral",
};

const OUTCOME_DOT = {
  success: "success", complete: "success", match: "success", ok: "success",
  partial: "warning", started: "warning", skipped: "warning",
  failed: "error",
  "no-match": "neutral",
};

export default function AuditLogPage({ nonce }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setBusy(true);
    fn("audit-list", { limit: 200 })
      .then((r) => { setRows(r?.rows ?? []); setError(null); })
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setBusy(false));
  };

  useEffect(load, [nonce]);

  return (
    <div className="wrap">
      <div className="stack">
        <div className="row-wrap">
          <div className="stack-s" style={{ flex: 1, minWidth: 0 }}>
            <span className="t-eyebrow">Accountability</span>
            <h1 className="t-h20">Audit log</h1>
            <p className="t-desc" style={{ margin: 0 }}>
              Every search, export and erasure this portal has performed — keyed on the case reference.
            </p>
          </div>
          <button className="fds-btn fds-btn--secondary" onClick={load} disabled={busy}>
            {busy ? <span className="spin"><IconSpinner size={16} /></span> : <IconRefresh />} Refresh
          </button>
        </div>

        <div className="banner">
          <IconList />
          <div className="banner__body">
            <strong>No data-subject identifiers are stored in this log</strong>
            <span className="t-desc">
              There is no column for an email, name or phone number, and none for a previous value —
              recording the identifier we were asked to erase would defeat the erasure. Accountability
              rides on the case reference plus the record id.
            </span>
          </div>
        </div>

        {error && <ErrorState message={error} onRetry={load} />}

        {!error && rows === null && (
          <div className="card">
            <div className="row"><span className="spin"><IconSpinner /></span> <span className="t-desc">Loading…</span></div>
          </div>
        )}

        {!error && rows?.length === 0 && (
          <EmptyState
            icon={<IconList size={32} />}
            title="Nothing logged yet"
            body="Run a search from the Discovery tab and it will appear here, recorded against its case reference."
          />
        )}

        {!error && rows?.length > 0 && (
          <div className="fds-widget">
            <div className="fds-widget__header">
              <span className="t-h16">Events</span>
              <span className="t-cap-d nowrap">{rows.length} most recent</span>
            </div>
            <div className="fds-widget__body fds-widget__body--flush">
              <div className="tbl-scroll">
                <table className="fds-table fds-table--hover fds-table--wide">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Action</th>
                      <th>Case</th>
                      <th>Actor</th>
                      <th>Target</th>
                      <th>Outcome</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.event_id}>
                        <td className="nowrap t-desc">{fmt(r.occurred_at)}</td>
                        <td className="nowrap">
                          <span className="row">
                            <span className={`dot dot--${ACTION_DOT[r.action] ?? "neutral"}`} />
                            <span className="t-body">{r.action}</span>
                          </span>
                        </td>
                        <td className="nowrap t-mono">{r.reference_no}</td>
                        <td className="t-desc">{r.actor_email}</td>
                        <td className="nowrap">
                          {r.module_name
                            ? <span className="t-cap t-mono">
                                {String(r.module_name).replace("custom_", "")}
                                {r.record_id ? ` #${Number(r.record_id)}` : ""}
                                {r.field_name ? ` · ${r.field_name}` : ""}
                              </span>
                            : <span className="t-cap">—</span>}
                        </td>
                        <td className="nowrap">
                          <span className="row">
                            <span className={`dot dot--${OUTCOME_DOT[r.outcome] ?? "neutral"}`} />
                            <span className="t-desc">{r.outcome}</span>
                          </span>
                        </td>
                        <td className="t-cap">{r.detail ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="fds-widget__footer">
              <span className="t-cap">
                Filtering, export and a retention policy for this log are not built yet.
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function fmt(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString(undefined, {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}
