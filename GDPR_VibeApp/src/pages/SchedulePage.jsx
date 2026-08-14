import React, { useState } from "react";
import { fn } from "../lib/vibe.js";
import { findContactByEmail } from "../lib/engine.js";
import { IconSearch, IconAlert, IconCheck, IconSpinner, IconEraser } from "../lib/icons.jsx";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_SCHEDULE_YEARS = 6;

/** yyyy-mm-dd in local time — what <input type="date"> expects. */
function isoDay(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function dateBounds() {
  const min = new Date();
  min.setDate(min.getDate() + 1); // earliest is tomorrow; today would be "now"
  const max = new Date();
  max.setFullYear(max.getFullYear() + MAX_SCHEDULE_YEARS);
  return { min: isoDay(min), max: isoDay(max) };
}

/**
 * The scheduled flow: book a date on which the contact is pseudonymised.
 *
 * Deliberately different from the immediate flow in two ways — it takes no case
 * reference (nothing is disclosed at booking time, so there is no DSAR to cite),
 * and it refuses to proceed until the eligibility criteria pass.
 */
export default function SchedulePage({ actor, onScheduled }) {
  const [email, setEmail] = useState("");
  const [checking, setChecking] = useState(false);
  const [contact, setContact] = useState(null);
  const [elig, setElig] = useState(null);
  const [error, setError] = useState(null);

  const [date, setDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [booked, setBooked] = useState(null);

  const bounds = dateBounds();
  const emailValid = EMAIL_RE.test(email.trim());

  async function check(e) {
    e?.preventDefault();
    setChecking(true);
    setError(null); setElig(null); setContact(null); setBooked(null);
    try {
      const c = await findContactByEmail(email.trim());
      if (!c) {
        setError("No Tenant Contact holds that email address.");
        return;
      }
      setContact(c);
      setElig(await fn("schedule-eligibility", { contactId: c.id }));
    } catch (err) {
      setError(String(err?.message ?? err));
    } finally {
      setChecking(false);
    }
  }

  async function book() {
    if (!date || !contact) return;
    setSaving(true);
    setError(null);
    try {
      // Midday avoids a timezone rounding to the previous day.
      const res = await fn("schedule-create", {
        contactId: contact.id,
        scheduledFor: new Date(`${date}T12:00:00`).toISOString(),
        actorEmail: actor,
      });
      setBooked(res);
      onScheduled?.();
    } catch (err) {
      setError(String(err?.message ?? err));
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setEmail(""); setContact(null); setElig(null); setBooked(null); setError(null); setDate("");
  }

  return (
    <div className="stack">
      <form className="card" onSubmit={check}>
        <div className="stack">
          <div>
            <label className="fds-field-label" htmlFor="sched-email">Email address</label>
            <div className="fds-field">
              <IconSearch />
              <input
                id="sched-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                autoComplete="off"
                spellCheck="false"
              />
            </div>
            <div className="fds-help">
              No case reference is needed — nothing is disclosed when a date is booked.
            </div>
          </div>

          <button
            type="submit"
            className="fds-btn fds-btn--primary fds-btn--lg fds-btn--block"
            disabled={!emailValid || checking}
          >
            {checking
              ? <><span className="spin"><IconSpinner size={16} /></span> Checking…</>
              : <><IconSearch /> Check eligibility</>}
          </button>
        </div>
      </form>

      {error && (
        <div className="banner banner--error">
          <IconAlert />
          <div className="banner__body">
            <strong>Cannot schedule</strong>
            <span className="t-desc">{error}</span>
          </div>
        </div>
      )}

      {elig && !booked && (
        <div className={`banner ${elig.eligible ? "banner--success" : "banner--warning"}`}>
          {elig.eligible ? <IconCheck /> : <IconAlert />}
          <div className="banner__body">
            <strong>
              {contact?.name}
              {elig.isPrimary ? " — primary contact" : " — not the primary contact"}
              {contact?.tenantName ? ` · ${contact.tenantName}` : ""}
            </strong>
            <span className="t-desc">{elig.reason}</span>
            <span className="t-cap">
              Contact status: {elig.contactState || "unknown"}
              {elig.tenantId ? ` · Tenant status: ${elig.tenantState || "unknown"}` : ""}
            </span>
          </div>
        </div>
      )}

      {elig?.eligible && !booked && (
        <div className="card">
          <div className="stack">
            <div>
              <label className="fds-field-label" htmlFor="sched-date">Anonymise on</label>
              <div className="fds-field">
                <input
                  id="sched-date"
                  type="date"
                  value={date}
                  min={bounds.min}
                  max={bounds.max}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <div className="fds-help">
                Any date up to {MAX_SCHEDULE_YEARS} years ahead — no later than {bounds.max}.
              </div>
            </div>

            <button
              className="fds-btn fds-btn--danger fds-btn--lg fds-btn--block"
              onClick={book}
              disabled={!date || saving}
            >
              {saving
                ? <><span className="spin"><IconSpinner size={16} /></span> Scheduling…</>
                : <><IconEraser /> Schedule erasure</>}
            </button>

            <p className="t-cap" style={{ margin: 0 }}>
              The criteria are checked again on the day it runs, so a tenant that reopens or a contact
              who becomes primary stops the erasure rather than proceeding on a stale decision.
            </p>
          </div>
        </div>
      )}

      {booked && (
        <div className="banner banner--success">
          <IconCheck />
          <div className="banner__body">
            <strong>Scheduled — {contact?.name} on {new Date(booked.scheduledFor).toLocaleDateString()}</strong>
            <span className="t-desc">
              Reference <span className="t-mono">{booked.eventId}</span>. It appears in the Scheduled
              list, where it can be cancelled at any time before it runs.
            </span>
            <button className="fds-btn fds-btn--secondary fds-btn--sm" onClick={reset} style={{ marginTop: 8 }}>
              Schedule another
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
