import React, { useEffect, useState, useCallback } from "react";
import { vibe, fn, devMockMode } from "./lib/vibe.js";
import { discover, STAGES } from "./lib/engine.js";
import { IconShield, IconSearch, IconList } from "./lib/icons.jsx";
import SearchPage from "./pages/SearchPage.jsx";
import ReportPage from "./pages/ReportPage.jsx";
import AuditLogPage from "./pages/AuditLogPage.jsx";
import ScheduledListPage from "./pages/ScheduledListPage.jsx";
import ProgressChecklist from "./components/ProgressChecklist.jsx";
import { ErrorState } from "./components/states.jsx";
// Under Vite's 4 KB inline limit, so this resolves to a data: URI — no network
// request for the brand mark, in the app or in the printed report.
import logoUrl from "./assets/facilio-logo.svg";

const ORG_LABEL = "Article 17";

/** The portal always renders in light mode — the OS preference is ignored and
 *  there is no toggle. Pinning the attribute overrides the tokens file's
 *  prefers-color-scheme fallback. */
function useLightTheme() {
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "light");
  }, []);
}

export default function App() {
  const [tab, setTab] = useState("discovery");
  useLightTheme();
  const [actor, setActor] = useState("");

  // discovery flow: idle → running → report | empty | error
  const [phase, setPhase] = useState("idle");
  const [stages, setStages] = useState({});
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [caseRef, setCaseRef] = useState("");
  const [auditNonce, setAuditNonce] = useState(0);
  const [scheduleNonce, setScheduleNonce] = useState(0);

  useEffect(() => {
    vibe.getCurrentUser().then((u) => {
      const email = u?.email || u?.user?.email || u?.data?.email || "";
      setActor(email || "unknown-admin");
    }).catch(() => setActor("unknown-admin"));
  }, []);

  /* DEV ONLY — render the report from a fixture so the UI can be visually
     verified without the Vibe backend. Vite strips this from production. */
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const mock = devMockMode();
    if (!mock) return;
    import("./lib/devFixture.js").then(({ FIXTURE, FIXTURE_EDGE }) => {
      setCaseRef("PRC-20260813-DEMO");
      setReport(
        mock === "edge" ? FIXTURE_EDGE
          : mock === "blocked" ? { ...FIXTURE, blocked: true, moduleGroups: undefined, counts: undefined }
          : FIXTURE
      );
      setPhase("report");
    });
  }, []);

  const runSearch = useCallback(async (referenceNo, email, { force = false } = {}) => {
    setCaseRef(referenceNo);
    setPhase("running");
    setError(null);
    setReport(null);
    setStages(Object.fromEntries(STAGES.map((s) => [s.key, { state: "pending" }])));

    try {
      const result = await discover(email, {
        force,
        onStage: (u) => setStages((prev) => ({ ...prev, [u.key]: { ...prev[u.key], ...u } })),
      });

      // Audit the search against the case reference only — never the email.
      try {
        await fn("audit-log", {
          actorEmail: actor,
          action: "SEARCH",
          referenceNo,
          outcome: result.blocked ? "blocked" : result.found ? "match" : "no-match",
          detail: result.blocked
            ? "erasure criteria not met — discovery not run"
            : result.found
              ? `${result.counts.records} records across ${result.counts.modulesWithData} modules`
              : "no tenant contact for the supplied address",
        });
        setAuditNonce((n) => n + 1);
      } catch (_) { /* a failed audit write must not hide the result */ }

      setReport(result);
      setPhase(result.found ? "report" : "empty");
    } catch (e) {
      setError(String(e?.message ?? e));
      setPhase("error");
    }
  }, [actor]);

  const reset = useCallback(() => {
    setPhase("idle"); setReport(null); setError(null); setCaseRef("");
  }, []);

  return (
    <div className="app">
      <header className="topbar fds-frost">
        <div className="topbar__inner">
          <span className="topbar__logo"><img src={logoUrl} alt="Facilio" /></span>
          <div className="topbar__titles">
            <span className="topbar__title">Privacy Rights Center</span>
            <span className="topbar__sub">GDPR data discovery for tenant contacts</span>
          </div>

          <span className="topbar__spacer" />

          <nav className="tabs" aria-label="Sections">
            <button
              className={`tab ${tab === "discovery" ? "is-active" : ""}`}
              onClick={() => setTab("discovery")}
              aria-current={tab === "discovery" ? "page" : undefined}
            >
              Discovery
            </button>
            <button
              className={`tab ${tab === "scheduled" ? "is-active" : ""}`}
              onClick={() => setTab("scheduled")}
              aria-current={tab === "scheduled" ? "page" : undefined}
            >
              Scheduled
            </button>
            <button
              className={`tab ${tab === "audit" ? "is-active" : ""}`}
              onClick={() => setTab("audit")}
              aria-current={tab === "audit" ? "page" : undefined}
            >
              Audit Log
            </button>
          </nav>

          <span className="badge" title="The org this portal is reading and writing">
            <span className="dot dot--success" /> {ORG_LABEL}
          </span>

        </div>
      </header>

      <main className="page">
        {tab === "audit" && <AuditLogPage nonce={auditNonce} />}

        {tab === "scheduled" && (
          <ScheduledListPage
            actor={actor}
            nonce={scheduleNonce}
            onChanged={() => setAuditNonce((n) => n + 1)}
          />
        )}

        {tab === "discovery" && phase === "idle" && (
          <SearchPage
            onSearch={runSearch}
            actor={actor}
            onScheduled={() => { setScheduleNonce((n) => n + 1); setAuditNonce((n) => n + 1); }}
          />
        )}

        {tab === "discovery" && phase === "running" && (
          <div className="wrap wrap--narrow">
            <div className="stack">
              <div className="stack-s">
                <span className="t-eyebrow">Case {caseRef}</span>
                <h1 className="t-h20">Searching every module linked to Tenant Contact</h1>
                <p className="t-desc">
                  Each pass reports its own count, so you can see the sweep was complete
                  rather than trusting a spinner.
                </p>
              </div>
              <div className="card">
                <ProgressChecklist stages={stages} />
              </div>
              <div>
                <button className="fds-btn fds-btn--tertiary" onClick={reset}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {tab === "discovery" && (phase === "report" || phase === "empty") && report && (
          <ReportPage
            report={report}
            caseRef={caseRef}
            actor={actor}
            onReset={reset}
            onRescan={(email) => runSearch(caseRef, email, { force: true })}
            onAudited={() => setAuditNonce((n) => n + 1)}
            onReplaceReport={setReport}
          />
        )}

        {tab === "discovery" && phase === "error" && (
          <div className="wrap wrap--narrow">
            <ErrorState message={error} onRetry={reset} />
          </div>
        )}
      </main>
    </div>
  );
}
