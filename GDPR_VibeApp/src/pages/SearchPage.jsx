import React, { useEffect, useState } from "react";
import { fn } from "../lib/vibe.js";
import { IconSearch, IconShield, IconInfo } from "../lib/icons.jsx";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function mintReference() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `PRC-${y}${m}${day}-${rnd}`;
}

export default function SearchPage({ onSearch, actor }) {
  const [ref, setRef] = useState("");
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState({});
  const [recent, setRecent] = useState([]);

  useEffect(() => {
    fn("recent-cases", { limit: 6 })
      .then((r) => setRecent(r?.rows ?? []))
      .catch(() => setRecent([]));
  }, []);

  const refError = touched.ref && !ref.trim() ? "A case reference is required." : null;
  const emailError =
    touched.email && !EMAIL_RE.test(email.trim()) ? "Enter a valid email address." : null;
  const canSubmit = ref.trim() && EMAIL_RE.test(email.trim());

  function submit(e) {
    e.preventDefault();
    setTouched({ ref: true, email: true });
    if (!canSubmit) return;
    onSearch(ref.trim(), email.trim());
  }

  return (
    <div className="wrap wrap--narrow">
      <div className="stack">
        <div className="stack-s" style={{ textAlign: "center", alignItems: "center" }}>
          <span className="topbar__mark" style={{ width: 40, height: 40 }}>
            <IconShield size={22} />
          </span>
          <h1 className="t-display" style={{ marginTop: "var(--spacing-containerLarge)" }}>
            Find a person&apos;s data
          </h1>
          <p className="t-desc" style={{ maxWidth: "52ch" }}>
            Enter a tenant contact&apos;s email address to see every module, record and field
            holding their personal data — then erase it.
          </p>
        </div>

        <form className="card" onSubmit={submit}>
          <div className="stack">
            <div>
              <label className="fds-field-label" htmlFor="caseref">Case reference</label>
              <div className={`fds-field ${refError ? "fds-field--error" : ""}`}>
                <input
                  id="caseref"
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, ref: true }))}
                  placeholder="DSAR-2026-014"
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="fds-btn fds-btn--tertiary fds-btn--sm"
                  onClick={() => { setRef(mintReference()); setTouched((t) => ({ ...t, ref: true })); }}
                >
                  Generate
                </button>
              </div>
              <div className={`fds-help ${refError ? "fds-help--error" : ""}`}>
                {refError ?? "Recorded in the audit trail in place of the email address."}
              </div>
            </div>

            <div>
              <label className="fds-field-label" htmlFor="email">Email address</label>
              <div className={`fds-field ${emailError ? "fds-field--error" : ""}`}>
                <IconSearch />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                  placeholder="name@example.com"
                  autoComplete="off"
                  spellCheck="false"
                />
              </div>
              <div className={`fds-help ${emailError ? "fds-help--error" : ""}`}>
                {emailError ?? "Used for this search only. Never written to the audit log."}
              </div>
            </div>

            <button type="submit" className="fds-btn fds-btn--primary fds-btn--lg fds-btn--block" disabled={!canSubmit}>
              <IconSearch /> Search
            </button>

            <p className="t-cap" style={{ margin: 0 }}>
              Searches every module that holds a lookup to Tenant Contact, plus attachments on the
              records it finds. Notes are not scanned.
            </p>
          </div>
        </form>

        {recent.length > 0 && (
          <div className="fds-widget">
            <div className="fds-widget__header">
              <span className="t-h16">Recent cases</span>
              <span className="t-cap-d">references only</span>
            </div>
            <div className="fds-widget__body fds-widget__body--flush">
              <div className="tbl-scroll">
                <table className="fds-table fds-table--hover">
                  <thead>
                    <tr><th>Case</th><th>Last activity</th><th>Events</th><th>Erased</th></tr>
                  </thead>
                  <tbody>
                    {recent.map((r) => (
                      <tr key={r.reference_no}>
                        <td className="t-mono">{r.reference_no}</td>
                        <td className="t-desc nowrap">{fmt(r.last_at)}</td>
                        <td className="t-desc">{r.events}</td>
                        <td>
                          {Number(r.anonymized) === 1
                            ? <span className="row"><span className="dot dot--success" /> <span className="t-desc">Yes</span></span>
                            : <span className="t-cap">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="fds-widget__footer">
              <span className="t-cap">
                Not one-click repeatable — the email was never stored, so re-enter it to run a case again.
              </span>
            </div>
          </div>
        )}

        <div className="banner banner--info">
          <IconInfo />
          <div className="banner__body">
            <strong>What this portal will and will not do</strong>
            <span className="t-desc">
              It reports only records provably linked to a Tenant Contact record, and erases only that
              contact and its parent Tenant. It never matches free text, never reads notes, and never
              writes to any other module.
            </span>
            {actor && <span className="t-cap">Acting as {actor}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function fmt(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
