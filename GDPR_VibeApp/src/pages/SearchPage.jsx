import React, { useState } from "react";
import SchedulePage from "./SchedulePage.jsx";
import { IconSearch, IconShield } from "../lib/icons.jsx";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SearchPage({ onSearch, actor, onScheduled }) {
  const [mode, setMode] = useState("now");
  const [ref, setRef] = useState("");
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState({});

  const refError = touched.ref && !ref.trim() ? "A reference number is required." : null;
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
            {mode === "now" ? "Find a person's data" : "Schedule an erasure"}
          </h1>
          <p className="t-desc" style={{ maxWidth: "52ch" }}>
            {mode === "now"
              ? "Enter a tenant contact's email address to see every module, record and field holding their personal data."
              : "Book a future date on which a tenant contact is pseudonymised automatically. Eligibility is checked before the date can be set."}
          </p>
        </div>

        {/* The two flows. "Now" discloses and erases on demand; "Schedule" books
            a date and performs the erasure unattended. */}
        <div className="modes" role="tablist" aria-label="Erasure flow">
          <button
            role="tab"
            aria-selected={mode === "now"}
            className={`mode ${mode === "now" ? "is-active" : ""}`}
            onClick={() => setMode("now")}
          >
            Now
          </button>
          <button
            role="tab"
            aria-selected={mode === "schedule"}
            className={`mode ${mode === "schedule" ? "is-active" : ""}`}
            onClick={() => setMode("schedule")}
          >
            Schedule
          </button>
        </div>

        {mode === "schedule" && <SchedulePage actor={actor} onScheduled={onScheduled} />}

        {mode === "now" && (
        <form className="card" onSubmit={submit}>
          <div className="stack">
            <div>
              <label className="fds-field-label" htmlFor="caseref">Reference No</label>
              <div className={`fds-field ${refError ? "fds-field--error" : ""}`}>
                <input
                  id="caseref"
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, ref: true }))}
                  autoComplete="off"
                />
              </div>
              {refError && <div className="fds-help fds-help--error">{refError}</div>}
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
                  autoComplete="off"
                  spellCheck="false"
                />
              </div>
              {emailError && <div className="fds-help fds-help--error">{emailError}</div>}
            </div>

            <button type="submit" className="fds-btn fds-btn--primary fds-btn--lg fds-btn--block" disabled={!canSubmit}>
              <IconSearch /> Search
            </button>
          </div>
        </form>
        )}
      </div>
    </div>
  );
}
