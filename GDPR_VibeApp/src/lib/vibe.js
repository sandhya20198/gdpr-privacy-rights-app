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
    case "audit-list":
      return {
        rows: [
          { event_id: "E3", occurred_at: new Date().toISOString(), actor_email: "admin@article17.test", action: "ANONYMIZE", reference_no: "PRC-20260813-DEMO", module_name: C, record_id: 4830454, field_name: "email", outcome: "success", detail: null },
          { event_id: "E2", occurred_at: new Date(Date.now() - 6e4).toISOString(), actor_email: "admin@article17.test", action: "EXPORT", reference_no: "PRC-20260813-DEMO", module_name: null, record_id: null, field_name: null, outcome: "dsar-response", detail: "7 records across 4 modules" },
          { event_id: "E1", occurred_at: new Date(Date.now() - 12e4).toISOString(), actor_email: "admin@article17.test", action: "SEARCH", reference_no: "PRC-20260813-DEMO", module_name: null, record_id: null, field_name: null, outcome: "match", detail: "7 records across 4 modules" },
        ],
      };
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
