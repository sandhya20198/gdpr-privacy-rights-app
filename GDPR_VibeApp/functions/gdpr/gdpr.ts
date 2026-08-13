/**
 * Privacy Rights Center — server side.
 *
 * Holds the three things that must NOT live in the browser:
 *   1. the append-only audit trail (and its no-PII guarantee),
 *   2. the pseudonym mint (uniqueness must be checked against stored state),
 *   3. the anonymization writes — scoped to exactly two modules.
 *
 * The module sweep and the read-only discovery queries deliberately run in the
 * browser instead: fetch is SERIALIZED inside this sandbox (~527ms/module, so a
 * 70-module sweep costs ~37s), while the browser can issue them concurrently.
 */

import StudioFunctions, { StudioDatabase } from "@facilio/studio-functions";

const server = new StudioFunctions({ name: "gdpr" });

/* ------------------------------------------------------------------ *
 * The only two modules this function is ever allowed to write to.
 * ------------------------------------------------------------------ */
const CONTACT_MODULE = "custom_tenantcontact";
const TENANT_MODULE = "custom_tenants";

const F_EMAIL = "email_custom_tenantcontact";
const F_PHONE = "phone_custom_tenantcontact";
const F_PARENT = "tenant_custom_tenantcontact_1";

const T_NAME = "primarycontactname_custom_tenants";
const T_EMAIL = "primarycontactemail_custom_tenants";
const T_PHONE = "primarycontactphone_custom_tenants";

const REDACTED_DOMAIN = "@redacted.invalid";

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function db() {
  return new StudioDatabase({
    userName: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    schema: process.env.SCHEMA,
  });
}

async function callAction(connection: string, action: string, input: any) {
  const res = await fetch(
    `${process.system.CONNECTIONS_URL}/api/v1/connections/${connection}/actions/${action}/execute`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input }),
    }
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`${connection}.${action} failed (${res.status}): ${text.slice(0, 400)}`);
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch (_) { throw new Error(`${connection}.${action}: non-JSON response`); }
  if (parsed && parsed.success === false) {
    const msg = parsed.error?.message ?? JSON.stringify(parsed.error ?? parsed).slice(0, 300);
    throw new Error(`${connection}.${action} rejected: ${msg}`);
  }
  return parsed;
}

function nowIso() {
  return new Date().toISOString();
}

/** Crockford base32 without the ambiguous letters, so a pseudonym is safe to read aloud. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function randomToken(len: number) {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));
  }
  return out;
}

function newEventId() {
  return `${Date.now().toString(36).toUpperCase()}-${randomToken(6)}`;
}

/**
 * Append one audit row.
 *
 * NOTE: there is no column here for the data subject's email, name or phone,
 * and none for a previous value. Storing the identifier we were asked to erase
 * would defeat the erasure, so accountability rides on reference_no + record_id.
 */
function audit(
  d: any,
  row: {
    actorEmail: string;
    action: string;
    referenceNo: string;
    moduleName?: string;
    recordId?: number | null;
    fieldName?: string;
    outcome: string;
    detail?: string;
  }
) {
  d.query(
    `insert into gdpr_audit_log
       (event_id, occurred_at, actor_email, action, reference_no, module_name, record_id, field_name, outcome, detail)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      newEventId(),
      nowIso(),
      row.actorEmail || "unknown",
      row.action,
      row.referenceNo || "UNREFERENCED",
      row.moduleName ?? null,
      row.recordId ?? null,
      row.fieldName ?? null,
      row.outcome,
      row.detail ?? null,
    ]
  );
}

/* ------------------------------------------------------------------ *
 * Schema cache — the dynamic lookup map, resolved by the browser
 * ------------------------------------------------------------------ */

server.addHandler({
  name: "cache-get",
  description: "Read the cached module→lookup-field map produced by the schema sweep",
  parameters: {},
  execute: async () => {
    const d = db();
    const { rows } = d.query(
      "select cache_key, fetched_at, module_count, payload from gdpr_schema_cache where cache_key = $1",
      ["lookup_map"]
    );
    if (!rows.length) return { found: false };
    const r = rows[0];
    let payload: any = null;
    try { payload = JSON.parse(r.payload); } catch (_) { payload = null; }
    return {
      found: payload != null,
      fetchedAt: r.fetched_at,
      moduleCount: Number(r.module_count),
      payload,
    };
  },
});

server.addHandler({
  name: "cache-put",
  description: "Store the module→lookup-field map after a sweep",
  parameters: {
    payload: { description: "JSON string of the resolved lookup map", type: "string" },
    moduleCount: { description: "How many modules were swept", type: "number" },
  },
  execute: async (args) => {
    if (!args.payload) throw new Error("payload is required");
    try { JSON.parse(args.payload); } catch (_) { throw new Error("payload must be valid JSON"); }
    const d = db();
    d.query("delete from gdpr_schema_cache where cache_key = $1", ["lookup_map"]);
    d.query(
      "insert into gdpr_schema_cache (cache_key, fetched_at, module_count, payload) values ($1,$2,$3,$4)",
      ["lookup_map", nowIso(), Number(args.moduleCount) || 0, args.payload]
    );
    return { ok: true, fetchedAt: nowIso() };
  },
});

/* ------------------------------------------------------------------ *
 * Audit trail
 * ------------------------------------------------------------------ */

server.addHandler({
  name: "audit-log",
  description: "Append one audit event (SEARCH / EXPORT / RESCAN). Never accepts a data-subject identifier.",
  parameters: {
    actorEmail: { description: "The admin performing the action", type: "string" },
    action: { description: "SEARCH | EXPORT | RESCAN", type: "string" },
    referenceNo: { description: "Case reference number", type: "string" },
    outcome: { description: "Short outcome code", type: "string" },
    detail: { description: "Optional non-identifying detail", type: "string" },
  },
  execute: async (args) => {
    const ref = String(args.referenceNo || "").trim();
    if (!ref) throw new Error("referenceNo is required — the audit trail is keyed on it, never on an email");

    // Defence in depth: refuse to persist anything that looks like an email address.
    const blob = `${args.detail ?? ""} ${args.outcome ?? ""} ${ref}`;
    if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(blob)) {
      throw new Error("refusing to write an audit row containing an email address");
    }

    const d = db();
    audit(d, {
      actorEmail: String(args.actorEmail || ""),
      action: String(args.action || "UNKNOWN"),
      referenceNo: ref,
      outcome: String(args.outcome || "ok"),
      detail: args.detail ? String(args.detail) : undefined,
    });
    return { ok: true };
  },
});

server.addHandler({
  name: "audit-list",
  description: "Read the audit trail, newest first",
  parameters: { limit: { description: "Max rows (default 200)", type: "number" } },
  execute: async (args) => {
    const lim = Math.max(1, Math.min(Number(args.limit) || 200, 500));
    const d = db();
    const { rows } = d.query(
      `select event_id, occurred_at, actor_email, action, reference_no, module_name, record_id, field_name, outcome, detail
         from gdpr_audit_log
        order by occurred_at desc
        limit $1`,
      [lim]
    );
    return { rows };
  },
});

server.addHandler({
  name: "recent-cases",
  description: "Distinct recent case references, for the search page's recent list",
  parameters: { limit: { description: "Max cases (default 8)", type: "number" } },
  execute: async (args) => {
    const lim = Math.max(1, Math.min(Number(args.limit) || 8, 25));
    const d = db();
    const { rows } = d.query(
      `select reference_no,
              max(occurred_at) as last_at,
              count(*)::int    as events,
              max(case when action = 'ANONYMIZE' then 1 else 0 end)::int as anonymized
         from gdpr_audit_log
        group by reference_no
        order by max(occurred_at) desc
        limit $1`,
      [lim]
    );
    return { rows };
  },
});

/* ------------------------------------------------------------------ *
 * Anonymization — writes to CONTACT_MODULE and TENANT_MODULE only
 * ------------------------------------------------------------------ */

server.addHandler({
  name: "preview-anonymize",
  description: "Compute exactly which fields would change, and the pseudonym that would be assigned. Performs no writes.",
  parameters: {
    contactId: { description: "custom_tenantcontact record id", type: "number" },
  },
  execute: async (args) => {
    const contactId = Number(args.contactId);
    if (!contactId) throw new Error("contactId is required");

    const got = await callAction("facilio-cmms", "get-custom-module-record", {
      custom_module: CONTACT_MODULE,
      id: contactId,
    });
    const rec = got?.data;
    if (!rec) throw new Error(`Tenant Contact ${contactId} not found`);

    const email = rec[F_EMAIL] ?? "";
    if (typeof email === "string" && email.endsWith(REDACTED_DOMAIN)) {
      return { alreadyAnonymized: true, contactId, token: String(rec.name ?? "") };
    }

    const token = reservePseudonym(contactId, /* dryRun */ true);
    const parent = rec[F_PARENT];
    const parentId = parent && typeof parent === "object" ? Number(parent.id) : null;

    const changes: any[] = [
      { module: CONTACT_MODULE, recordId: contactId, field: "name", label: "Name", from: rec.name ?? "", to: token },
      { module: CONTACT_MODULE, recordId: contactId, field: F_EMAIL, label: "Email", from: email, to: `${token.toLowerCase()}${REDACTED_DOMAIN}` },
      { module: CONTACT_MODULE, recordId: contactId, field: F_PHONE, label: "Phone", from: rec[F_PHONE] ?? "", to: maskedPhone(token) },
    ];

    const parentChanges: any[] = [];
    if (parentId && parent) {
      // Only offer the parent's fields where the value really is this person's.
      if (parent[T_NAME] && rec.name && String(parent[T_NAME]) === String(rec.name)) {
        parentChanges.push({ module: TENANT_MODULE, recordId: parentId, field: T_NAME, label: "Primary Contact Name", from: parent[T_NAME], to: token });
      }
      if (parent[T_EMAIL] && email && String(parent[T_EMAIL]).toLowerCase() === String(email).toLowerCase()) {
        parentChanges.push({ module: TENANT_MODULE, recordId: parentId, field: T_EMAIL, label: "Primary Contact E-Mail", from: parent[T_EMAIL], to: `${token.toLowerCase()}${REDACTED_DOMAIN}` });
      }
      if (parent[T_PHONE] && rec[F_PHONE] && String(parent[T_PHONE]) === String(rec[F_PHONE])) {
        parentChanges.push({ module: TENANT_MODULE, recordId: parentId, field: T_PHONE, label: "Primary Contact Phone", from: parent[T_PHONE], to: maskedPhone(token) });
      }
    }

    return {
      alreadyAnonymized: false,
      contactId,
      parentId,
      parentName: parent?.name ?? null,
      token,
      changes,
      parentChanges,
      totalFields: changes.length + parentChanges.length,
    };
  },
});

function maskedPhone(token: string) {
  let digits = "";
  for (let i = 0; i < token.length && digits.length < 6; i++) {
    const idx = ALPHABET.indexOf(token.charAt(i));
    digits += String(idx % 10);
  }
  while (digits.length < 6) digits += "0";
  return `+00-000-${digits}`;
}

/**
 * Return this contact's pseudonym, minting a unique one if it has none.
 * Uniqueness is enforced here in application code: the CSV-import path that
 * creates the table cannot add a UNIQUE constraint, and the function's DB role
 * is denied DDL — so the invariant is held by a checked read before insert.
 */
function reservePseudonym(contactId: number, dryRun: boolean): string {
  const d = db();
  const existing = d.query("select token from gdpr_pseudonym where contact_id = $1", [contactId]);
  if (existing.rows.length) return String(existing.rows[0].token);

  for (let attempt = 0; attempt < 12; attempt++) {
    const token = randomToken(6);
    const clash = d.query("select 1 as hit from gdpr_pseudonym where token = $1", [token]);
    if (clash.rows.length) continue;
    if (dryRun) return token;
    d.query(
      "insert into gdpr_pseudonym (token, contact_id, created_at) values ($1,$2,$3)",
      [token, contactId, nowIso()]
    );
    return token;
  }
  throw new Error("could not mint a unique pseudonym after 12 attempts");
}

server.addHandler({
  name: "anonymize",
  description: "Irreversibly pseudonymise a Tenant Contact and the matching primary-contact fields on its parent Tenant. Writes to no other module.",
  parameters: {
    contactId: { description: "custom_tenantcontact record id", type: "number" },
    referenceNo: { description: "Case reference number", type: "string" },
    actorEmail: { description: "The admin performing the erasure", type: "string" },
    confirm: { description: "Must equal the referenceNo, proving an explicit confirmation step happened", type: "string" },
  },
  execute: async (args) => {
    const contactId = Number(args.contactId);
    const ref = String(args.referenceNo || "").trim();
    const actor = String(args.actorEmail || "");
    if (!contactId) throw new Error("contactId is required");
    if (!ref) throw new Error("referenceNo is required");
    if (String(args.confirm || "").trim() !== ref) {
      throw new Error("confirmation did not match the case reference — refusing to write");
    }

    const d = db();

    const got = await callAction("facilio-cmms", "get-custom-module-record", {
      custom_module: CONTACT_MODULE,
      id: contactId,
    });
    const rec = got?.data;
    if (!rec) throw new Error(`Tenant Contact ${contactId} not found`);

    const email = String(rec[F_EMAIL] ?? "");
    if (email.endsWith(REDACTED_DOMAIN)) {
      audit(d, { actorEmail: actor, action: "ANONYMIZE", referenceNo: ref, moduleName: CONTACT_MODULE, recordId: contactId, outcome: "skipped", detail: "already anonymized" });
      return { ok: true, alreadyAnonymized: true, token: String(rec.name ?? ""), results: [] };
    }

    const token = reservePseudonym(contactId, false);
    const newEmail = `${token.toLowerCase()}${REDACTED_DOMAIN}`;
    const newPhone = maskedPhone(token);

    const parent = rec[F_PARENT];
    const parentId = parent && typeof parent === "object" ? Number(parent.id) : null;

    const results: any[] = [];

    audit(d, { actorEmail: actor, action: "ANONYMIZE", referenceNo: ref, moduleName: CONTACT_MODULE, recordId: contactId, outcome: "started", detail: `pseudonym ${token}` });

    // ---- 1. the Tenant Contact record itself
    try {
      await callAction("facilio-cmms", "update-custom-module-record", {
        custom_module: CONTACT_MODULE,
        id: contactId,
        record: { name: token, [F_EMAIL]: newEmail, [F_PHONE]: newPhone },
      });
      for (const f of ["name", F_EMAIL, F_PHONE]) {
        audit(d, { actorEmail: actor, action: "ANONYMIZE", referenceNo: ref, moduleName: CONTACT_MODULE, recordId: contactId, fieldName: f, outcome: "success" });
      }
      results.push({ module: CONTACT_MODULE, recordId: contactId, fields: ["name", F_EMAIL, F_PHONE], ok: true });
    } catch (e: any) {
      const msg = String(e?.message ?? e).slice(0, 300);
      audit(d, { actorEmail: actor, action: "ANONYMIZE", referenceNo: ref, moduleName: CONTACT_MODULE, recordId: contactId, outcome: "failed", detail: msg });
      results.push({ module: CONTACT_MODULE, recordId: contactId, ok: false, error: msg });
    }

    // ---- 2. the parent Tenant's primary-contact fields, only where they are this person's
    if (parentId && parent) {
      const patch: any = {};
      const touched: string[] = [];
      if (parent[T_NAME] && rec.name && String(parent[T_NAME]) === String(rec.name)) { patch[T_NAME] = token; touched.push(T_NAME); }
      if (parent[T_EMAIL] && email && String(parent[T_EMAIL]).toLowerCase() === email.toLowerCase()) { patch[T_EMAIL] = newEmail; touched.push(T_EMAIL); }
      if (parent[T_PHONE] && rec[F_PHONE] && String(parent[T_PHONE]) === String(rec[F_PHONE])) { patch[T_PHONE] = newPhone; touched.push(T_PHONE); }

      if (touched.length) {
        try {
          await callAction("facilio-cmms", "update-custom-module-record", {
            custom_module: TENANT_MODULE,
            id: parentId,
            record: patch,
          });
          for (const f of touched) {
            audit(d, { actorEmail: actor, action: "ANONYMIZE", referenceNo: ref, moduleName: TENANT_MODULE, recordId: parentId, fieldName: f, outcome: "success" });
          }
          results.push({ module: TENANT_MODULE, recordId: parentId, fields: touched, ok: true });
        } catch (e: any) {
          const msg = String(e?.message ?? e).slice(0, 300);
          audit(d, { actorEmail: actor, action: "ANONYMIZE", referenceNo: ref, moduleName: TENANT_MODULE, recordId: parentId, outcome: "failed", detail: msg });
          results.push({ module: TENANT_MODULE, recordId: parentId, ok: false, error: msg });
        }
      } else {
        results.push({ module: TENANT_MODULE, recordId: parentId, fields: [], ok: true, note: "no primary-contact field on the parent matched this person" });
      }
    }

    const failed = results.filter((r) => !r.ok).length;
    audit(d, {
      actorEmail: actor, action: "ANONYMIZE", referenceNo: ref,
      moduleName: CONTACT_MODULE, recordId: contactId,
      outcome: failed ? "partial" : "complete",
      detail: `${results.length - failed}/${results.length} records written`,
    });

    return { ok: failed === 0, partial: failed > 0, token, results };
  },
});

server.execute();
