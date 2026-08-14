import React, { useEffect, useState } from "react";
import { fn } from "../lib/vibe.js";
import { IconX, IconAlert, IconCheck, IconEraser, IconSpinner } from "../lib/icons.jsx";

const STEPS = ["Scope", "Confirm"];

/**
 * Three-step erasure. The scope step is deliberately not expandable: the two
 * records shown are the entire blast radius, and everything excluded is listed
 * with its reason so the least-privilege boundary is visible rather than implied.
 */
export default function AnonymizePanel({ report, caseRef, actor, onClose, onDone }) {
  const [step, setStep] = useState(0);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirmText, setConfirmText] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    fn("preview-anonymize", { contactId: report.contact.id })
      .then((p) => { setPreview(p); setLoading(false); })
      .catch((e) => { setError(String(e?.message ?? e)); setLoading(false); });
  }, [report.contact.id]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !running) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, running]);

  const allChanges = preview ? [...(preview.changes ?? []), ...(preview.parentChanges ?? [])] : [];
  const armed = confirmText.trim() === caseRef.trim();
  /* Erasing now clears the same gate as booking it for later. The server refuses
   * either way; blocking here is so the operator learns it on the first screen. */
  const blocked = !!preview && !preview.alreadyAnonymized && preview.eligible === false;

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const r = await fn("anonymize", {
        contactId: report.contact.id,
        referenceNo: caseRef,
        actorEmail: actor,
        confirm: confirmText.trim(),
      });
      setResult(r);
      onDone?.(r);
    } catch (e) {
      setError(String(e?.message ?? e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <div className="scrim" onClick={() => !running && onClose()} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Anonymize contact">
        <div className="drawer__head">
          <div className="stack-s" style={{ minWidth: 0, flex: 1 }}>
            <span className="t-eyebrow">Case {caseRef}</span>
            <span className="t-h20">Anonymize contact</span>
            <div className="steps" style={{ marginTop: "var(--spacing-containerMedium)" }}>
              {STEPS.map((s, i) => (
                <React.Fragment key={s}>
                  {i > 0 && <span className="step__rule" />}
                  <span className={`step ${i === step ? "is-active" : i < step ? "is-done" : ""}`}>
                    <span className="step__n">{i < step ? "✓" : i + 1}</span> {s}
                  </span>
                </React.Fragment>
              ))}
            </div>
          </div>
          <button className="icon-btn" onClick={() => !running && onClose()} aria-label="Close">
            <IconX size={16} />
          </button>
        </div>

        <div className="drawer__body">
          {loading && (
            <div className="row"><span className="spin"><IconSpinner /></span> <span className="t-desc">Computing scope…</span></div>
          )}

          {error && !result && (
            <div className="banner banner--error">
              <IconAlert />
              <div className="banner__body">
                <strong>Could not complete</strong>
                <span className="t-desc">{error}</span>
              </div>
            </div>
          )}

          {!loading && preview?.alreadyAnonymized && (
            <div className="banner banner--info">
              <IconCheck />
              <div className="banner__body">
                <strong>Already anonymized</strong>
                <span className="t-desc">
                  This contact is {preview.token}. There is nothing left to erase.
                </span>
              </div>
            </div>
          )}

          {blocked && !result && (
            <div className="banner banner--warning">
              <IconAlert />
              <div className="banner__body">
                <strong>
                  {report.contact.name}
                  {preview.isPrimary ? " — primary contact" : " — not the primary contact"}
                  {preview.tenantName ? ` · ${preview.tenantName}` : ""}
                </strong>
                <span className="t-desc">{preview.eligibilityReason}</span>
                <span className="t-cap">
                  Contact status: {preview.contactState || "unknown"}
                  {preview.parentId ? ` · Tenant status: ${preview.tenantState || "unknown"}` : ""}
                </span>
              </div>
            </div>
          )}

          {result && (
            <div className="stack">
              <div className={`banner ${result.partial ? "banner--warning" : "banner--success"}`}>
                {result.partial ? <IconAlert /> : <IconCheck />}
                <div className="banner__body">
                  <strong>
                    {result.alreadyAnonymized
                      ? "Nothing to do — already anonymized"
                      : result.partial
                        ? "Partially complete"
                        : `Complete — this contact is now ${result.token}`}
                  </strong>
                  <span className="t-desc">
                    {result.partial
                      ? "Some records were written and others failed. Every attempt is in the audit log."
                      : "The original name, email, phone and photo no longer exist in the org."}
                    {result.cancelledSchedules?.length
                      ? ` The booked erasure (${result.cancelledSchedules.join(", ")}) was cancelled — there is nothing left for it to do.`
                      : ""}
                  </span>
                </div>
              </div>

              <div className="card">
                <div className="stack-s">
                  {result.results?.map((r, i) => (
                    <div className="row" key={i}>
                      <span className={`dot dot--${r.ok ? "success" : "error"}`} />
                      <span className="t-body t-mono">{r.module}</span>
                      <span className="t-cap">#{r.recordId}</span>
                      <span className="spacer" />
                      <span className="t-cap">
                        {r.ok
                          ? (r.fields?.length ? `${r.fields.length} field${r.fields.length === 1 ? "" : "s"} written` : (r.note ?? "no change needed"))
                          : r.error}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ---------- step 1: scope ---------- */}
          {!loading && !result && !preview?.alreadyAnonymized && !blocked && step === 0 && (
            <div className="stack">
              <div className="card">
                <div className="section-head">
                  <span className="t-eyebrow">Will be rewritten</span>
                  <span className="section-head__rule" />
                </div>
                {allChanges.map((c) => (
                  <div className="check-row" key={`${c.module}.${c.recordId}.${c.field}`}>
                    <input type="checkbox" checked readOnly aria-label={c.label} />
                    <div style={{ minWidth: 0 }}>
                      <div className="t-body">{c.label}</div>
                      <div className="t-cap t-mono">{c.module} #{c.recordId} · {c.field}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ---------- step 2: confirm ---------- */}
          {!loading && !result && !preview?.alreadyAnonymized && !blocked && step === 1 && (
            <div className="stack">
              <div className="banner banner--warning">
                <IconAlert />
                <div className="banner__body">
                  <strong>This cannot be undone</strong>
                  <span className="t-desc">
                    The values are overwritten in your live org. This portal keeps no copy — the audit
                    trail records that a field changed, never what it used to hold.
                  </span>
                </div>
              </div>

              <div>
                <label className="fds-field-label" htmlFor="confirm">
                  Type the case reference to confirm
                </label>
                <div className="fds-field">
                  <input
                    id="confirm"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder={caseRef}
                    autoComplete="off"
                    spellCheck="false"
                  />
                </div>
                <div className="fds-help">
                  Enter <span className="t-mono">{caseRef}</span> exactly.
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="drawer__foot">
          {result || preview?.alreadyAnonymized ? (
            <button className="fds-btn fds-btn--primary" onClick={onClose}>Done</button>
          ) : blocked ? (
            <button className="fds-btn fds-btn--secondary" onClick={onClose}>Close</button>
          ) : (
            <>
              <button
                className="fds-btn fds-btn--secondary"
                onClick={() => (step === 0 ? onClose() : setStep(step - 1))}
                disabled={running}
              >
                {step === 0 ? "Cancel" : "Back"}
              </button>
              <span className="spacer" />
              {step < 1 ? (
                <button
                  className="fds-btn fds-btn--primary"
                  onClick={() => setStep(step + 1)}
                  disabled={loading || !!error || !allChanges.length}
                >
                  Continue
                </button>
              ) : (
                <button className="fds-btn fds-btn--danger" onClick={run} disabled={!armed || running}>
                  {running ? <><span className="spin"><IconSpinner size={16} /></span> Processing…</>
                           : <><IconEraser /> Anonymize</>}
                </button>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
