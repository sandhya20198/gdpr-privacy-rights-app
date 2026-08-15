import React, { useEffect, useMemo, useState } from "react";
import { fn } from "../lib/vibe.js";
import { EmptyState, ErrorState } from "../components/states.jsx";
import { IconList, IconSpinner, IconRefresh, IconSearch, IconChevronDown } from "../lib/icons.jsx";

const ACTION_DOT = {
  SEARCH: "info",
  EXPORT: "accent",
  ANONYMIZE: "error",
  RESCAN: "neutral",
};

const OUTCOME_DOT = {
  success: "success", complete: "success", match: "success", ok: "success",
  partial: "warning", skipped: "warning", refused: "warning", blocked: "warning",
  failed: "error",
  scheduled: "accent", cancelled: "neutral", "no-match": "neutral",
};

/** Time-period filter. `days` is the size of the trailing window; `today` is the
 *  one option anchored to midnight rather than to a rolling 24h. */
const PERIODS = [
  { key: "all",   label: "All time" },
  { key: "today", label: "Today" },
  { key: "7",     label: "Last 7 days",  days: 7 },
  { key: "30",    label: "Last 30 days", days: 30 },
  { key: "90",    label: "Last 90 days", days: 90 },
];

export default function AuditLogPage({ nonce }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState("all");

  const load = () => {
    setBusy(true);
    fn("audit-list", { limit: 200 })
      .then((r) => { setRows(r?.rows ?? []); setError(null); })
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setBusy(false));
  };

  useEffect(load, [nonce]);

  // Search and time period are applied client-side over the loaded page — the
  // handler already caps at 200 rows, so there is nothing to re-fetch.
  const filtered = useMemo(() => {
    if (!rows) return null;
    const from = periodStart(period);
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (from) {
        const t = new Date(r.occurred_at).getTime();
        if (!Number.isNaN(t) && t < from) return false;
      }
      return !q || haystack(r).includes(q);
    });
  }, [rows, query, period]);

  const groups = useMemo(() => groupByDay(filtered ?? []), [filtered]);
  const filtering = query.trim() !== "" || period !== "all";

  return (
    <div className="wrap">
      <div className="stack">
        <div className="row-wrap">
          <div className="stack-s" style={{ flex: 1, minWidth: 0 }}>
            <span className="t-eyebrow">Accountability</span>
            <h1 className="t-h20">Audit Log</h1>
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
          <>
            <div className="log-toolbar">
              <div className="log-toolbar__period">
                <label className="fds-field-label" htmlFor="audit-period">Time</label>
                <div className="fds-select">
                  <select
                    id="audit-period"
                    value={period}
                    onChange={(e) => setPeriod(e.target.value)}
                  >
                    {PERIODS.map((p) => (
                      <option key={p.key} value={p.key}>{p.label}</option>
                    ))}
                  </select>
                  <IconChevronDown />
                </div>
              </div>

              <div className="log-toolbar__search">
                <div className="fds-field">
                  <IconSearch />
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search action, case, performed by…"
                    aria-label="Search the audit log"
                  />
                </div>
              </div>
            </div>

            <div className="fds-widget">
              <div className="fds-widget__header">
                <span className="t-h16">Events</span>
                <span className="t-cap-d nowrap">
                  {filtering
                    ? `${filtered.length} of ${rows.length} shown`
                    : `${rows.length} most recent`}
                </span>
              </div>
              <div className="fds-widget__body fds-widget__body--flush">
                {groups.length === 0 ? (
                  <EmptyState
                    icon={<IconSearch size={32} />}
                    title="No events match those filters"
                    body="Try a different search term, or widen the time period."
                  />
                ) : (
                  <div className="tbl-scroll">
                    <table className="fds-table fds-table--hover fds-table--wide fds-table--log">
                      {groups.map((g) => (
                        <tbody className="day-group" key={g.key}>
                          <tr className="day-head-row">
                            <td colSpan={7}>
                              <div className="day-head">
                                <span className="day-head__label">{g.label}</span>
                              </div>
                            </td>
                          </tr>
                          <tr className="day-cols">
                            <th>Time</th>
                            <th>Action</th>
                            <th>Reference Number</th>
                            <th>Performed By</th>
                            <th>Target</th>
                            <th>Outcome</th>
                            <th>Detail</th>
                          </tr>
                          {g.rows.map((r) => (
                            <tr key={r.event_id}>
                              <td className="nowrap t-desc">{fmtTime(r.occurred_at)}</td>
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
                      ))}
                    </table>
                  </div>
                )}
              </div>
              <div className="fds-widget__footer">
                <span className="t-cap">
                  Export and a retention policy for this log are not built yet.
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Everything a row can be searched on. Deliberately excludes nothing the table
 *  itself shows — and the table shows no data-subject identifier. */
function haystack(r) {
  return [
    r.action, r.reference_no, r.actor_email, r.outcome, r.detail,
    r.module_name && String(r.module_name).replace("custom_", ""),
    r.record_id, r.field_name,
  ].filter(Boolean).join(" ").toLowerCase();
}

function periodStart(key) {
  const p = PERIODS.find((x) => x.key === key);
  if (!p || key === "all") return null;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (p.days) d.setDate(d.getDate() - (p.days - 1));
  return d.getTime();
}

/** Rows arrive newest-first, so a single pass keeps the days in that order too. */
function groupByDay(rows) {
  const out = [];
  const seen = new Map();
  for (const r of rows) {
    const d = new Date(r.occurred_at);
    const ok = !Number.isNaN(d.getTime());
    const key = ok ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` : "unknown";
    let g = seen.get(key);
    if (!g) {
      g = { key, label: ok ? dayLabel(d) : "Undated", rows: [] };
      seen.set(key, g);
      out.push(g);
    }
    g.rows.push(r);
  }
  return out;
}

/** "Friday, 14 Aug 2026" — assembled part by part so the order holds whatever
 *  the browser locale would otherwise impose. */
function dayLabel(d) {
  const weekday = d.toLocaleDateString(undefined, { weekday: "long" });
  const month = d.toLocaleDateString(undefined, { month: "short" });
  const day = String(d.getDate()).padStart(2, "0");
  return `${weekday}, ${day} ${month} ${d.getFullYear()}`;
}

function fmtTime(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}
