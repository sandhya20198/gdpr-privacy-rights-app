import React, { useEffect, useState } from "react";
import { fn } from "../lib/vibe.js";
import { IconX, IconAlert, IconCheck, IconEraser, IconSpinner } from "../lib/icons.jsx";

const STEPS = ["Scope", "Preview", "Confirm"];

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
                      : "The original name, email and phone no longer exist in the org."}
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
          {!loading && !result && !preview?.alreadyAnonymized && step === 0 && (
            <div className="stack">
              <p className="t-desc" style={{ margin: 0 }}>
                Erasure is limited to these two records. This is the whole blast radius — the portal
                holds no write access to any other module.
              </p>

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

              <div className="card">
                <div className="section-head">
                  <span className="t-eyebrow">Excluded, and why</span>
                  <span className="section-head__rule" />
                </div>
                <div className="check-row is-blocked">
                  <input type="checkbox" disabled />
                  <div>
                    <div className="t-body">Linked work orders, service requests and other records</div>
                    <div className="t-cap">
                      Kept deliberately. They reference the contact, so they follow the pseudonym and
                      operational history survives the erasure.
                    </div>
                  </div>
                </div>
                <div className="check-row is-blocked">
                  <input type="checkbox" disabled />
                  <div>
                    <div className="t-body">Attachments</div>
                    <div className="t-cap">Manual action required — the portal cannot delete files.</div>
                  </div>
                </div>
                <div className="check-row is-blocked">
                  <input type="checkbox" disabled />
                  <div>
                    <div className="t-body">Free text in descriptions, and notes</div>
                    <div className="t-cap">
                      Out of scope by design — a text match cannot be attributed to one person with
                      certainty, so the portal never rewrites it.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ---------- step 2: preview ---------- */}
          {!loading && !result && !preview?.alreadyAnonymized && step === 1 && (
            <div className="stack">
              <div className="banner">
                <IconEraser />
                <div className="banner__body">
                  <strong>This contact will become {preview?.token}</strong>
                  <span className="t-desc">
                    Generated by the portal and unique to this contact, so two erased people never
                    collapse into the same value. It is not editable.
                  </span>
                </div>
              </div>

              <div className="card">
                <div className="section-head">
                  <span className="t-eyebrow">{allChanges.length} fields · before → after</span>
                  <span className="section-head__rule" />
                </div>
                {allChanges.map((c) => (
                  <div className="diff" key={`${c.module}.${c.recordId}.${c.field}`}>
                    <div style={{ minWidth: 0 }}>
                      <div className="t-cap">{c.label}</div>
                      <div className="diff__val t-strike t-mono">{String(c.from || "—")}</div>
                    </div>
                    <span className="diff__arrow">→</span>
                    <div style={{ minWidth: 0 }}>
                      <div className="t-cap">{c.module.replace("custom_", "")}</div>
                      <div className="diff__val t-mono">{c.to}</div>
                    </div>
                  </div>
                ))}
              </div>

              <p className="t-cap" style={{ margin: 0 }}>
                {allChanges.length} field{allChanges.length === 1 ? "" : "s"} across{" "}
                {new Set(allChanges.map((c) => c.recordId)).size} record
                {new Set(allChanges.map((c) => c.recordId)).size === 1 ? "" : "s"} will be permanently
                overwritten.
              </p>
            </div>
          )}

          {/* ---------- step 3: confirm ---------- */}
          {!loading && !result && !preview?.alreadyAnonymized && step === 2 && (
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
              {step < 2 ? (
                <button
                  className="fds-btn fds-btn--primary"
                  onClick={() => setStep(step + 1)}
                  disabled={loading || !!error || !allChanges.length}
                >
                  Continue
                </button>
              ) : (
                <button className="fds-btn fds-btn--danger" onClick={run} disabled={!armed || running}>
                  {running ? <><span className="spin"><IconSpinner size={16} /></span> Erasing…</>
                           : <><IconEraser /> Anonymize {allChanges.length} fields</>}
                </button>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
