import React from "react";
import { IconSearch, IconAlert, IconInfo } from "../lib/icons.jsx";

export function EmptyState({ title, body, children, icon }) {
  return (
    <div className="card">
      <div className="empty">
        {icon ?? <IconSearch size={32} />}
        <div className="empty__title">{title}</div>
        {body && <p className="empty__body">{body}</p>}
        {children}
      </div>
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="stack">
      <div className="banner banner--error">
        <IconAlert />
        <div className="banner__body">
          <strong>The search could not be completed</strong>
          <span className="t-desc">{message}</span>
          <span className="t-cap">
            Nothing was written to your org. No audit row was recorded for a search that never ran.
          </span>
        </div>
      </div>
      {onRetry && (
        <div>
          <button className="fds-btn fds-btn--secondary" onClick={onRetry}>Back to search</button>
        </div>
      )}
    </div>
  );
}

/**
 * Partial-failure banner. This is load-bearing, not decoration: because modules
 * with no data are hidden entirely, a module that FAILED to scan would otherwise
 * look identical to one that legitimately holds nothing.
 */
export function PartialBanner({ failures, onRetry }) {
  if (!failures?.length) return null;
  const modules = [...new Set(failures.map((f) => f.module).filter(Boolean))];
  return (
    <div className="banner banner--warning">
      <IconAlert />
      <div className="banner__body">
        <strong>This report is incomplete — {failures.length} query failed</strong>
        <span className="t-desc">
          {modules.length
            ? <>Could not read: {modules.join(", ")}. Those modules are missing from the counts below.</>
            : <>Some queries failed. The counts below may understate what exists.</>}
        </span>
        <span className="t-cap">
          Modules holding no data are hidden, so a failed scan can look like "no data" — treat this
          report as provisional until the retry succeeds.
        </span>
        {onRetry && (
          <div className="row" style={{ marginTop: "var(--spacing-containerMedium)" }}>
            <button className="fds-btn fds-btn--secondary fds-btn--sm" onClick={onRetry}>
              Retry the full sweep
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function InfoBanner({ title, children }) {
  return (
    <div className="banner banner--info">
      <IconInfo />
      <div className="banner__body">
        {title && <strong>{title}</strong>}
        <span className="t-desc">{children}</span>
      </div>
    </div>
  );
}
