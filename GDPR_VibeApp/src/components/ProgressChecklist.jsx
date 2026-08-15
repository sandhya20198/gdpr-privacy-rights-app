import React from "react";
import { STAGES } from "../lib/engine.js";
import { IconCheck, IconSpinner, IconCircle } from "../lib/icons.jsx";

export default function ProgressChecklist({ stages }) {
  return (
    <div className="checklist" role="status" aria-live="polite">
      {STAGES.map((s) => {
        const st = stages?.[s.key] ?? { state: "pending" };
        const cls =
          st.state === "done" ? "is-done" : st.state === "active" ? "is-active" : "is-pending";

        let meta = null;
        if (st.state === "done") {
          meta = typeof st.count === "number"
            ? `${st.count} ${st.count === 1 ? "result" : "results"}`
            : "done";
          if (st.note) meta = st.note;
          if (st.fromCache) meta += " · cached";
        } else if (st.state === "active") {
          if (typeof st.done === "number" && typeof st.total === "number") {
            meta = `${st.done} / ${st.total}${st.note ? ` · ${st.note}` : ""}`;
          } else if (st.note) meta = st.note;
          else meta = "working…";
        } else if (st.state === "skipped") {
          // A stage the search never reached, because the criteria stopped it.
          meta = st.note ?? "not run";
        }

        const pct =
          st.state === "active" && st.total ? Math.round((st.done / st.total) * 100) : null;

        return (
          <div key={s.key} className={`checkline ${cls}`}>
            <span className="checkline__mark">
              {st.state === "done" ? <IconCheck size={14} />
                : st.state === "active" ? <span className="spin"><IconSpinner size={14} /></span>
                : <IconCircle size={12} />}
            </span>
            <span className="checkline__label">
              {s.label}
              {pct !== null && (
                <span className="bar" style={{ marginTop: 6, display: "block", maxWidth: 240 }}>
                  <span className="bar__fill" style={{ width: `${pct}%` }} />
                </span>
              )}
            </span>
            {meta && <span className="checkline__meta">{meta}</span>}
          </div>
        );
      })}
    </div>
  );
}
