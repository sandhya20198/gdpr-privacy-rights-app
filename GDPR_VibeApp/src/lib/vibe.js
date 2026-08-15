import { createVibe } from "@facilio/vibe-sdk";

export const vibe = createVibe();

/**
 * Connection actions come back in one of a few envelope shapes depending on who
 * is asking (browser SDK vs. the CLI vs. the in-sandbox fetch). Normalise to the
 * action's own payload — `{ data, pagination, success, count }`.
 */
export function unwrap(res) {
  let node = res;
  for (let i = 0; i < 4 && node && typeof node === "object"; i++) {
    if (Array.isArray(node.results) && node.results.length) { node = node.results[0]; continue; }
    if ("result" in node && node.result && typeof node.result === "object") { node = node.result; continue; }
    break;
  }
  return node ?? {};
}

/** Rows out of an action payload, whatever it calls its list. */
export function rowsOf(payload) {
  const p = unwrap(payload);
  if (Array.isArray(p)) return p;
  if (Array.isArray(p.data)) return p.data;
  if (Array.isArray(p.items)) return p.items;
  if (Array.isArray(p.records)) return p.records;
  return [];
}

export function countOf(payload, fallbackRows) {
  const p = unwrap(payload);
  if (typeof p.count === "number") return p.count;
  return (fallbackRows ?? rowsOf(p)).length;
}

export async function action(connection, slug, input = {}) {
  const res = await vibe.executeAction(connection, slug, input);
  const p = unwrap(res);
  if (p && p.success === false) {
    const msg = p.error?.message || p.error?.code || "action rejected";
    throw new Error(`${connection}.${slug}: ${msg}`);
  }
  return p;
}

/** DEV ONLY: with ?mock=1 the backend is unreachable from `vite dev`, so serve
 *  fixture responses for the gdpr handlers. Stripped from production builds. */
export function devMockMode() {
  if (!import.meta.env.DEV) return null;
  const q = new URLSearchParams(window.location.search).get("mock");
  if (q) { try { sessionStorage.setItem("prc-mock", q); } catch (_) {} return q; }
  try { return sessionStorage.getItem("prc-mock"); } catch (_) { return null; }
}

function devMock(handler) {
  if (!devMockMode()) return null;
  const token = "2PX952";
  const C = "tenantcontact", T = "tenant";
  switch (handler) {
    case "preview-anonymize":
      return {
        alreadyAnonymized: false, contactId: 4830454, parentId: 4830451,
        parentName: "Acme Retail Group", token, totalFields: 6,
        changes: [
          { module: C, recordId: 4830454, field: "name", label: "Name", from: "James Carter", to: token },
          { module: C, recordId: 4830454, field: "email", label: "Email", from: "james.carter@acmeretail.example", to: "2px952@redacted.invalid" },
          { module: C, recordId: 4830454, field: "phone", label: "Phone", from: "+1-555-0201", to: "+00-000-229952" },
        ],
        parentChanges: [
          { module: T, recordId: 4830451, field: "primaryContactName", label: "Primary Contact Name", from: "James Carter", to: token },
          { module: T, recordId: 4830451, field: "primaryContactEmail", label: "Primary Contact E-Mail", from: "james.carter@acmeretail.example", to: "2px952@redacted.invalid" },
          { module: T, recordId: 4830451, field: "primaryContactPhone", label: "Primary Contact Phone", from: "+1-555-0201", to: "+00-000-229952" },
        ],
      };
    case "anonymize":
      return {
        ok: true, partial: false, token,
        results: [
          { module: C, recordId: 4830454, fields: ["name", "email", "phone"], ok: true },
          { module: T, recordId: 4830451, fields: ["primaryContactName", "primaryContactEmail", "primaryContactPhone"], ok: true },
        ],
      };
    case "schedule-eligibility":
      // The fixture's subject is a primary contact of an active tenant — the
      // blocked case, so the gate is visible in dev without touching live data.
      return {
        contactId: 4830454, tenantId: 4830451, isPrimary: true,
        contactState: "active", tenantState: "active", tenantName: "Acme Retail Group",
        alreadyAnonymized: false, eligible: false,
        reason: 'Tenant is active and cannot do this for the primary contact. "Acme Retail Group" is active — a primary contact can only be anonymized or scheduled once their tenant is expired.',
      };
    case "audit-list": {
      // Spread over several days so the day-grouped log can be seen grouping.
      const DAY = 864e5;
      const at = (days, mins) => new Date(Date.now() - days * DAY - mins * 6e4).toISOString();
      return {
        rows: [
          { event_id: "E9", occurred_at: at(0, 0),    actor_email: "admin@article17.test",     action: "ANONYMIZE", reference_no: "PRC-20260813-DEMO", module_name: C, record_id: 4830454, field_name: "email", outcome: "success", detail: null },
          { event_id: "E8", occurred_at: at(0, 1),    actor_email: "admin@article17.test",     action: "EXPORT",    reference_no: "PRC-20260813-DEMO", module_name: null, record_id: null, field_name: null, outcome: "dsar-response", detail: "7 records across 4 modules" },
          { event_id: "E7", occurred_at: at(0, 2),    actor_email: "admin@article17.test",     action: "SEARCH",    reference_no: "PRC-20260813-DEMO", module_name: null, record_id: null, field_name: null, outcome: "match", detail: "7 records across 4 modules" },
          { event_id: "E6", occurred_at: at(1, 140),  actor_email: "dpo@article17.test",       action: "ANONYMIZE", reference_no: "PRC-20260812-ACME", module_name: C, record_id: 4830461, field_name: "phone", outcome: "partial", detail: "1 of 2 parent fields skipped" },
          { event_id: "E5", occurred_at: at(1, 205),  actor_email: "dpo@article17.test",       action: "SEARCH",    reference_no: "PRC-20260812-ACME", module_name: null, record_id: null, field_name: null, outcome: "match", detail: "4 records across 3 modules" },
          { event_id: "E4", occurred_at: at(3, 320),  actor_email: "ops@article17.test",       action: "RESCAN",    reference_no: "PRC-20260810-NORT", module_name: null, record_id: null, field_name: null, outcome: "complete", detail: "cache bypassed" },
          { event_id: "E3", occurred_at: at(3, 366),  actor_email: "ops@article17.test",       action: "SEARCH",    reference_no: "PRC-20260810-NORT", module_name: null, record_id: null, field_name: null, outcome: "no-match", detail: "no tenant contact for the supplied address" },
          { event_id: "E2", occurred_at: at(12, 410), actor_email: "admin@article17.test",     action: "ANONYMIZE", reference_no: "PRC-20260801-HELM", module_name: T, record_id: 4830451, field_name: "primaryContactName", outcome: "success", detail: null },
          { event_id: "E1", occurred_at: at(12, 455), actor_email: "admin@article17.test",     action: "SEARCH",    reference_no: "PRC-20260801-HELM", module_name: null, record_id: null, field_name: null, outcome: "match", detail: "9 records across 5 modules" },
        ],
      };
    }
    case "schedule-list": {
      const DAY = 864e5;
      const day = (n) => new Date(Date.now() + n * DAY).toISOString();
      return {
        rows: [
          { event_id: "S4", contact_id: 4830454, scheduled_for: day(3),   created_at: day(-1), created_by: "admin@article17.test", status: "pending",   detail: null },
          { event_id: "S3", contact_id: 4830461, scheduled_for: day(9),   created_at: day(-2), created_by: "dpo@article17.test",   status: "pending",   detail: null },
          { event_id: "S2", contact_id: 4830451, scheduled_for: day(-4),  created_at: day(-9), created_by: "ops@article17.test",   status: "done",      detail: "3 fields anonymised" },
          { event_id: "S1", contact_id: 4830449, scheduled_for: day(-11), created_at: day(-14), created_by: "admin@article17.test", status: "cancelled", detail: "superseded by immediate erasure (case PRC-20260801-HELM)" },
        ],
      };
    }
    case "recent-cases":
      return { rows: [{ reference_no: "PRC-20260813-DEMO", last_at: new Date().toISOString(), events: 3, anonymized: 1 }] };
    case "audit-log":
    case "cache-put":
      return { ok: true };
    case "cache-get":
      return { found: false };
    default:
      return null;
  }
}

export async function fn(handler, args = {}) {
  const mocked = devMock(handler);
  if (mocked) return mocked;
  return await vibe.executeFunction("gdpr", handler, args);
}

/** Bounded-concurrency map. The browser can genuinely parallelise these; the
 *  function sandbox cannot, which is why the sweep lives here. */
export async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  const runners = new Array(Math.min(limit, items.length || 1)).fill(0).map(async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        out[i] = { ok: true, value: await worker(items[i], i) };
      } catch (e) {
        out[i] = { ok: false, error: e?.message ? String(e.message) : String(e) };
      }
    }
  });
  await Promise.all(runners);
  return out;
}
