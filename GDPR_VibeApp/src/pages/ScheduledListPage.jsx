import React, { useCallback, useEffect, useState } from "react";
import { fn } from "../lib/vibe.js";
import { contactNames } from "../lib/engine.js";
import { EmptyState } from "../components/states.jsx";
import { IconRefresh, IconSpinner, IconAlert, IconCheck } from "../lib/icons.jsx";

const STATUS_DOT = {
  pending: "info",
  done: "success",
  failed: "error",
  cancelled: "neutral",
};

/**
 * Booked erasures: when each was raised, by whom, for whom, and the date it
 * fires. Subject names are resolved live from the record ids — the schedule
 * table stores ids only, so no subject's name is written to the app database.
 */
export default function ScheduledListPage({ actor, nonce, onChanged }) {
  const [rows, setRows] = useState([]);
  const [names, setNames] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fn("schedule-list", {});
      const list = res?.rows ?? [];
      setRows(list);
      try {
        setNames(await contactNames(list.map((r) => Number(r.contact_id))));
      } catch (_) { /* ids still render without names */ }
    } catch (e) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, nonce]);

  async function cancel(eventId) {
    setBusy(eventId);
    try {
      await fn("schedule-cancel", { eventId, actorEmail: actor });
      await load();
      onChanged?.();
    } catch (e) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(null);
    }
  }

  const pending = rows.filter((r) => r.status === "pending").length;

  return (
    <div className="wrap">
      <div className="stack">
        <div className="row-wrap">
          <div className="stack-s" style={{ minWidth: 0, flex: 1 }}>
            <span className="t-eyebrow">Scheduled</span>
            <h1 className="t-h20">Booked anonymizations</h1>
          </div>
          <button className="fds-btn fds-btn--secondary" onClick={load} disabled={loading}>
            <IconRefresh /> Refresh
          </button>
        </div>

        {error && (
          <div className="banner banner--error">
            <IconAlert />
            <div className="banner__body">
              <strong>Could not load the schedule</strong>
              <span className="t-desc">{error}</span>
            </div>
          </div>
        )}

        {loading ? (
          <div className="row"><span className="spin"><IconSpinner /></span> <span className="t-desc">Loading…</span></div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<IconCheck size={32} />}
            title="Nothing scheduled"
            body="Anonymizations booked from the Schedule flow appear here, with the date each one runs."
          />
        ) : (
          <div className="fds-widget">
            <div className="fds-widget__header">
              <span className="t-h16">{rows.length} schedule{rows.length === 1 ? "" : "s"}</span>
              <span className="t-cap-d nowrap">{pending} pending</span>
            </div>
            <div className="fds-widget__body fds-widget__body--flush">
              <div className="tbl-scroll">
                <table className="fds-table fds-table--hover">
                  <thead>
                    <tr>
                      <th>Anonymise on</th>
                      <th>For whom</th>
                      <th>Scheduled on</th>
                      <th>By whom</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const who = names.get(Number(r.contact_id));
                      return (
                        <tr key={r.event_id}>
                          <td className="nowrap"><span className="t-h14">{fmtDay(r.scheduled_for)}</span></td>
                          <td>
                            <span className="t-body">{who?.name ?? `Contact #${r.contact_id}`}</span>
                            <div className="t-cap t-mono">#{r.contact_id}</div>
                          </td>
                          <td className="t-desc nowrap">{fmtDay(r.created_at)}</td>
                          <td className="t-desc">{r.created_by || "—"}</td>
                          <td className="nowrap">
                            <span className="row">
                              <span className={`dot dot--${STATUS_DOT[r.status] ?? "neutral"}`} />
                              <span className="t-desc">{r.status}</span>
                            </span>
                            {r.detail && r.status !== "pending" && (
                              <div className="t-cap">{r.detail}</div>
                            )}
                          </td>
                          <td className="nowrap">
                            {r.status === "pending" && (
                              <button
                                className="fds-btn fds-btn--tertiary fds-btn--sm"
                                onClick={() => cancel(r.event_id)}
                                disabled={busy === r.event_id}
                              >
                                {busy === r.event_id ? "Cancelling…" : "Cancel"}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="fds-widget__footer">
              <span className="t-cap">
                Names are read live from the contact records. The schedule itself stores only the
                record id, so no subject&apos;s name is held in this app&apos;s database.
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function fmtDay(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}
