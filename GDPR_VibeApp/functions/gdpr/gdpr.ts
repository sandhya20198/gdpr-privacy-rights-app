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
 *
 * These are the SYSTEM Tenants / Tenant Contacts modules, reached through the
 * dedicated tenant actions (`get-tenant-contact`, `update-tenant`, …) rather
 * than the generic custom-module ones. The org also carries custom look-alikes
 * (`custom_tenants` / `custom_tenantcontact`); this app does not touch them.
 * ------------------------------------------------------------------ */
const CONTACT_MODULE = "tenantcontact";
const TENANT_MODULE = "tenant";

const F_EMAIL = "email";
const F_PHONE = "phone";
const F_PARENT = "tenant";
const F_PRIMARY = "isPrimaryContact";
const F_PHOTO = "avatar"; // system FILE field — the contact's photo section

const T_NAME = "primaryContactName";
const T_EMAIL = "primaryContactEmail";
const T_PHONE = "primaryContactPhone";

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
  description: "Compute exactly which fields would change, the pseudonym that would be assigned, and whether the erasure is allowed at all. Performs no writes.",
  parameters: {
    contactId: { description: "tenantcontact record id", type: "number" },
  },
  execute: async (args) => {
    const contactId = Number(args.contactId);
    if (!contactId) throw new Error("contactId is required");

    const got = await callAction("facilio-cmms", "get-tenant-contact", { id: contactId });
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

    const photo = await fetchPhoto(contactId);
    if (photo != null) {
      changes.push({ module: CONTACT_MODULE, recordId: contactId, field: F_PHOTO, label: "Photo", from: photoLabel(photo), to: "(removed)" });
    }

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

    // The verdict rides along with the scope so the drawer can refuse on its
    // first screen rather than letting an operator type a case reference for a
    // write the `anonymize` handler is going to reject anyway.
    const elig: any = await evaluateEligibility(contactId);

    return {
      alreadyAnonymized: false,
      contactId,
      parentId,
      parentName: parent?.name ?? null,
      token,
      changes,
      parentChanges,
      totalFields: changes.length + parentChanges.length,
      eligible: !!elig.eligible,
      eligibilityReason: elig.reason ?? null,
      isPrimary: !!elig.isPrimary,
      contactState: elig.contactState ?? "",
      tenantState: elig.tenantState ?? "",
      tenantName: elig.tenantName ?? null,
    };
  },
});

/**
 * The photo field is NOT in the record's default projection, so it takes a
 * dedicated select to know whether one exists. Returns the raw value (object,
 * id, …) or null. A failure here degrades to "no photo" rather than blocking
 * the erasure — the photo is still nulled by the write either way.
 */
async function fetchPhoto(contactId: number): Promise<any> {
  try {
    const got = await callAction("facilio-cmms", "list-tenant-contacts", {
      filters: `id(is)=${contactId}`,
      select: `id,${F_PHOTO}`,
      page_size: 1,
    });
    return got?.data?.[0]?.[F_PHOTO] ?? null;
  } catch (_) {
    return null;
  }
}

function photoLabel(v: any): string {
  if (v && typeof v === "object") return String(v.fileName ?? v.name ?? `file #${v.id ?? "?"}`);
  return `file #${v}`;
}

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
    contactId: { description: "tenantcontact record id", type: "number" },
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

    // The same gate the scheduled flow enforces. Erasing now is not a weaker act
    // than booking it for later, so it does not get a weaker check — and the
    // browser's copy of the verdict is never trusted.
    const elig: any = await evaluateEligibility(contactId);
    if (!elig.eligible && !elig.alreadyAnonymized) {
      audit(db(), { actorEmail: actor, action: "ANONYMIZE", referenceNo: ref,
                    moduleName: CONTACT_MODULE, recordId: contactId,
                    outcome: "refused", detail: String(elig.reason ?? "not eligible").slice(0, 300) });
      throw new Error(elig.reason);
    }

    const res: any = await performAnonymize(contactId, ref, actor);

    /* A booked erasure for someone who has just been erased by hand has nothing
     * left to do, so it is retired here rather than left to fire years later
     * and find the work already done. Only on a clean result: a partial one
     * leaves real fields outstanding, and the booking is the reminder. */
    const cancelledSchedules = res?.ok ? cancelPendingSchedules(contactId, ref, actor) : [];

    return { ...res, cancelledSchedules };
  },
});

/**
 * The erasure itself, shared by the immediate ("Now") handler and the scheduled
 * runner. Kept as one function so a scheduled erasure can never drift from the
 * one an operator performs by hand.
 */
async function performAnonymize(contactId: number, ref: string, actor: string) {
  {
    const d = db();

    const got = await callAction("facilio-cmms", "get-tenant-contact", { id: contactId });
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

    // ---- 1. the Tenant Contact record itself
    // The photo is nulled in the same write. It is reported as a changed field
    // only when one actually existed, so the result never overstates the work —
    // and the key is left out of the patch entirely when there is no photo,
    // keeping the common write to the three plain string fields.
    const hadPhoto = (await fetchPhoto(contactId)) != null;
    const contactFields = ["name", F_EMAIL, F_PHONE, ...(hadPhoto ? [F_PHOTO] : [])];
    try {
      await callAction("facilio-cmms", "update-tenant-contact", {
        id: contactId,
        tenantcontact: {
          name: token, [F_EMAIL]: newEmail, [F_PHONE]: newPhone,
          ...(hadPhoto ? { [F_PHOTO]: null } : {}),
        },
      });
      results.push({ module: CONTACT_MODULE, recordId: contactId, fields: contactFields, ok: true });
    } catch (e: any) {
      const msg = String(e?.message ?? e).slice(0, 300);
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
          await callAction("facilio-cmms", "update-tenant", {
            id: parentId,
            tenant: patch,
          });
          results.push({ module: TENANT_MODULE, recordId: parentId, fields: touched, ok: true });
        } catch (e: any) {
          const msg = String(e?.message ?? e).slice(0, 300);
          results.push({ module: TENANT_MODULE, recordId: parentId, ok: false, error: msg });
        }
      } else {
        results.push({ module: TENANT_MODULE, recordId: parentId, fields: [], ok: true, note: "no primary-contact field on the parent matched this person" });
      }
    }

    /* ---- one row per erasure, never one per field.
     * An erasure is a single act, so it gets a single audit entry. What the
     * per-field rows used to carry lives in the detail instead: the pseudonym,
     * and every record written with the fields it took. Field NAMES only —
     * the value that was erased is still never stored. */
    const failed = results.filter((r) => !r.ok).length;
    const written = results
      .filter((r) => r.ok && r.fields?.length)
      .map((r) => `${r.module} #${r.recordId}: ${r.fields.join(", ")}`);
    const errors = results.filter((r) => !r.ok).map((r) => `${r.module} #${r.recordId}: ${r.error}`);
    audit(d, {
      actorEmail: actor, action: "ANONYMIZE", referenceNo: ref,
      moduleName: CONTACT_MODULE, recordId: contactId,
      outcome: failed ? "partial" : "complete",
      detail: [`pseudonym ${token}`, ...written, ...errors].join(" · ").slice(0, 300),
    });

    return { ok: failed === 0, partial: failed > 0, token, results };
  }
}

/* ------------------------------------------------------------------ *
 * Scheduled erasure
 *
 * The second flow: instead of erasing now, an operator books a date and a job
 * performs the erasure then. Eligibility is deliberately re-checked at BOTH
 * ends — booking time and run time — because a tenant can reopen, or a contact
 * become primary, in the years between the two.
 * ------------------------------------------------------------------ */

const SCHEDULE_TABLE = "gdpr_anonymize_schedule";
const MAX_SCHEDULE_YEARS = 6;

/**
 * Retire every pending booking for a contact who has just been erased outright.
 *
 * Mirrors schedule-cancel: same status and the same SCHEDULE/cancelled audit
 * vocabulary, so a booking retired this way reads no differently in the
 * Scheduled list than one an operator cancelled by hand. The audit row is a
 * SCHEDULE event, not a second ANONYMIZE one — an erasure still writes exactly
 * one row of its own.
 *
 * Returns the event ids it retired.
 */
function cancelPendingSchedules(contactId: number, ref: string, actor: string): string[] {
  const d = db();
  const { rows } = d.query(
    `select event_id from ${SCHEDULE_TABLE} where contact_id = $1 and status = $2`,
    [contactId, "pending"]
  );
  const detail = `superseded by immediate erasure (case ${ref})`.slice(0, 300);
  const ids: string[] = [];
  for (const r of rows) {
    const eventId = String(r.event_id);
    d.query(`update ${SCHEDULE_TABLE} set status = $1, detail = $2 where event_id = $3`,
            ["cancelled", detail, eventId]);
    audit(d, {
      actorEmail: actor, action: "SCHEDULE", referenceNo: eventId,
      moduleName: CONTACT_MODULE, recordId: contactId,
      outcome: "cancelled", detail,
    });
    ids.push(eventId);
  }
  return ids;
}

/**
 * A state name that means "this record has run its course", even where the state
 * flow types it OPEN. The system modules need this: Tenants types Expired as
 * REJECTED, and Tenant Contacts types active / inactive / pseudo-anonymized all
 * as OPEN, so type alone would leave both gates permanently shut.
 */
const TERMINAL_STATE_NAME = /^(close|closed|expire|expired|inactive|terminated|pseudo)/;

/**
 * Which status values on a module mean "closed"? Resolved from the module's own
 * state flow rather than hardcoded, so a state added to Tenants later counts
 * automatically.
 */
async function closedStatuses(moduleName: string): Promise<string[]> {
  try {
    const res = await callAction("facilio-process-automation", "list-states", { moduleName });
    return (res?.items ?? [])
      .filter((s: any) => {
        const type = String(s?.type ?? "").toUpperCase();
        const status = String(s?.status ?? "").toLowerCase();
        return type === "CLOSED" || type === "REJECTED" || TERMINAL_STATE_NAME.test(status);
      })
      .map((s: any) => String(s.status).toLowerCase());
  } catch (_) {
    return ["close", "closed", "expired", "inactive"];
  }
}

function stateOf(rec: any): string {
  const v = rec?.moduleState;
  if (v == null) return "";
  if (typeof v === "object") return String(v.status ?? v.name ?? v.displayName ?? "").toLowerCase();
  return String(v).toLowerCase();
}

/**
 * May this contact be erased — now or on a booked date?
 *
 * Primary contact  → the tenant must be expired/closed.
 * Not primary      → the contact itself must be inactive/closed.
 *
 * Both entry points ("Now" and "Schedule") run this same check, so erasing on
 * demand can never clear a lower bar than booking it for later.
 *
 * "Primary" is read generously: the contact's own flag OR the parent tenant
 * naming this person as its primary contact. Either marks them primary, because
 * under-detecting it would let the stricter rule be skipped.
 */
async function evaluateEligibility(contactId: number) {
  const listed = await callAction("facilio-cmms", "list-tenant-contacts", {
    filters: `id(is)=${contactId}`,
    select: `id,name,${F_EMAIL},${F_PRIMARY},${F_PARENT},moduleState`,
    expand: F_PARENT,
    page_size: 1,
  });
  const rec = listed?.data?.[0];
  if (!rec) throw new Error(`Tenant Contact ${contactId} not found`);

  const email = String(rec[F_EMAIL] ?? "");
  if (email.endsWith(REDACTED_DOMAIN)) {
    return { eligible: false, alreadyAnonymized: true, contactId, tenantId: null,
             reason: "This contact is already anonymized — there is nothing left to erase." };
  }

  const expanded = rec[F_PARENT] && typeof rec[F_PARENT] === "object" ? rec[F_PARENT] : null;
  const tenantId = expanded ? Number(expanded.id) : null;

  // The expanded lookup is projected down to a subset that omits moduleState, so
  // the tenant is re-read on its own. Reading a blank status here would silently
  // treat an active tenant as closed and let the primary-contact gate through.
  let parent: any = expanded;
  if (tenantId) {
    try {
      const t = await callAction("facilio-cmms", "list-tenants", {
        filters: `id(is)=${tenantId}`,
        select: `id,name,moduleState,${T_EMAIL}`,
        page_size: 1,
      });
      if (t?.data?.[0]) parent = { ...expanded, ...t.data[0] };
    } catch (_) { /* fall back to the expanded copy; the gate below still runs */ }
  }

  const flaggedPrimary = rec[F_PRIMARY] === true || rec[F_PRIMARY] === "true";
  const namedOnTenant =
    !!parent && !!email &&
    String(parent[T_EMAIL] ?? "").trim().toLowerCase() === email.trim().toLowerCase();
  const isPrimary = flaggedPrimary || namedOnTenant;

  const contactState = stateOf(rec);
  const tenantState = parent ? stateOf(parent) : "";

  const base = { contactId, tenantId, isPrimary, contactState, tenantState,
                 tenantName: parent?.name ?? null, alreadyAnonymized: false };

  if (isPrimary) {
    const closed = await closedStatuses(TENANT_MODULE);
    if (!parent) {
      return { ...base, eligible: false,
               reason: "This contact is marked primary but has no parent Tenant, so the tenant's status cannot be verified." };
    }
    if (!closed.includes(tenantState)) {
      return { ...base, eligible: false,
               reason: `Tenant is active and cannot do this for the primary contact. "${parent.name}" is ${tenantState || "not closed"} — a primary contact can only be erased or scheduled once their tenant is expired.` };
    }
    return { ...base, eligible: true, reason: "Primary contact of an expired tenant." };
  }

  const closedContact = await closedStatuses(CONTACT_MODULE);
  if (!closedContact.includes(contactState)) {
    return { ...base, eligible: false,
             reason: `This contact is ${contactState || "active"}. A non-primary contact can only be erased or scheduled once they are inactive.` };
  }
  return { ...base, eligible: true, reason: "Non-primary, inactive contact." };
}

server.addHandler({
  name: "schedule-eligibility",
  description: "Check whether a Tenant Contact may be erased — now or on a booked date. Read-only.",
  parameters: { contactId: { description: "tenantcontact record id", type: "number" } },
  execute: async (args) => {
    const contactId = Number(args.contactId);
    if (!contactId) throw new Error("contactId is required");
    return await evaluateEligibility(contactId);
  },
});

server.addHandler({
  name: "schedule-create",
  description: "Book a future date on which a Tenant Contact will be pseudonymised. Re-checks eligibility server-side and refuses dates beyond six years.",
  parameters: {
    contactId: { description: "tenantcontact record id", type: "number" },
    scheduledFor: { description: "ISO date the erasure should run on", type: "string" },
    actorEmail: { description: "The admin creating the schedule", type: "string" },
  },
  execute: async (args) => {
    const contactId = Number(args.contactId);
    const actor = String(args.actorEmail || "");
    const when = new Date(String(args.scheduledFor || ""));
    if (!contactId) throw new Error("contactId is required");
    if (Number.isNaN(when.getTime())) throw new Error("scheduledFor must be a valid date");

    const now = new Date();
    if (when.getTime() <= now.getTime()) {
      throw new Error("scheduledFor must be in the future — use the immediate flow to erase now");
    }
    const limit = new Date();
    limit.setFullYear(limit.getFullYear() + MAX_SCHEDULE_YEARS);
    if (when.getTime() > limit.getTime()) {
      throw new Error(`scheduledFor cannot be more than ${MAX_SCHEDULE_YEARS} years from today`);
    }

    // Never trust the browser's check — re-run it here.
    const elig: any = await evaluateEligibility(contactId);
    if (!elig.eligible) throw new Error(elig.reason);

    const d = db();
    const dup = d.query(
      `select event_id from ${SCHEDULE_TABLE} where contact_id = $1 and status = $2`,
      [contactId, "pending"]
    );
    if (dup.rows.length) {
      throw new Error(`This contact already has a pending schedule (${dup.rows[0].event_id}). Cancel it before booking another.`);
    }

    const eventId = newEventId();
    d.query(
      `insert into ${SCHEDULE_TABLE}
         (event_id, contact_id, tenant_id, scheduled_for, created_at, created_by, status, executed_at, detail)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [eventId, contactId, elig.tenantId ?? null, when.toISOString(), nowIso(), actor, "pending", null, elig.reason]
    );

    audit(d, {
      actorEmail: actor, action: "SCHEDULE", referenceNo: eventId,
      moduleName: CONTACT_MODULE, recordId: contactId,
      outcome: "scheduled", detail: `erasure booked for ${when.toISOString().slice(0, 10)}`,
    });

    return { ok: true, eventId, contactId, scheduledFor: when.toISOString(), status: "pending" };
  },
});

server.addHandler({
  name: "schedule-list",
  description: "List booked erasures, soonest first. Returns record ids only — subject names are resolved by the caller, never stored here.",
  parameters: { status: { description: "Filter by status (pending | done | failed | cancelled)", type: "string" } },
  execute: async (args) => {
    const d = db();
    const status = String(args.status || "").trim();
    const { rows } = status
      ? d.query(
          `select event_id, contact_id, tenant_id, scheduled_for, created_at, created_by, status, executed_at, detail
             from ${SCHEDULE_TABLE} where status = $1 order by scheduled_for asc`,
          [status]
        )
      : d.query(
          `select event_id, contact_id, tenant_id, scheduled_for, created_at, created_by, status, executed_at, detail
             from ${SCHEDULE_TABLE} where status <> $1 order by scheduled_for asc`,
          ["seed"]
        );
    return { rows };
  },
});

server.addHandler({
  name: "schedule-cancel",
  description: "Cancel a booked erasure that has not run yet.",
  parameters: {
    eventId: { description: "The schedule's event id", type: "string" },
    actorEmail: { description: "The admin cancelling", type: "string" },
    purge: { description: "Pass \"yes\" to delete the row outright instead of marking it cancelled", type: "string" },
  },
  execute: async (args) => {
    const eventId = String(args.eventId || "").trim();
    if (!eventId) throw new Error("eventId is required");
    const d = db();

    if (String(args.purge || "").toLowerCase() === "yes") {
      d.query(`delete from ${SCHEDULE_TABLE} where event_id = $1`, [eventId]);
      return { ok: true, eventId, purged: true };
    }

    const found = d.query(`select status, contact_id from ${SCHEDULE_TABLE} where event_id = $1`, [eventId]);
    if (!found.rows.length) throw new Error(`No schedule ${eventId}`);
    if (String(found.rows[0].status) !== "pending") {
      throw new Error(`Schedule ${eventId} is ${found.rows[0].status} and cannot be cancelled`);
    }

    d.query(`update ${SCHEDULE_TABLE} set status = $1, detail = $2 where event_id = $3`,
            ["cancelled", "cancelled by operator", eventId]);
    audit(d, {
      actorEmail: String(args.actorEmail || ""), action: "SCHEDULE", referenceNo: eventId,
      moduleName: CONTACT_MODULE, recordId: Number(found.rows[0].contact_id),
      outcome: "cancelled",
    });
    return { ok: true, eventId, status: "cancelled" };
  },
});

server.addHandler({
  name: "run-due-schedules",
  description: "Run every booked erasure whose date has arrived. Intended for a recurring job; safe to call repeatedly.",
  parameters: {},
  execute: async () => {
    const d = db();
    const now = nowIso();
    const { rows } = d.query(
      `select event_id, contact_id, created_by from ${SCHEDULE_TABLE}
        where status = $1 and scheduled_for <= $2 order by scheduled_for asc`,
      ["pending", now]
    );

    const done: any[] = [];
    for (const row of rows) {
      const eventId = String(row.event_id);
      const contactId = Number(row.contact_id);
      const actor = String(row.created_by || "scheduled-job");
      try {
        // Years may have passed since booking, so the gate is re-checked here.
        const elig: any = await evaluateEligibility(contactId);
        if (!elig.eligible && !elig.alreadyAnonymized) {
          d.query(`update ${SCHEDULE_TABLE} set status = $1, executed_at = $2, detail = $3 where event_id = $4`,
                  ["failed", nowIso(), `no longer eligible: ${elig.reason}`.slice(0, 300), eventId]);
          audit(d, { actorEmail: actor, action: "SCHEDULE", referenceNo: eventId,
                     moduleName: CONTACT_MODULE, recordId: contactId,
                     outcome: "failed", detail: "no longer eligible at run time" });
          done.push({ eventId, contactId, ok: false, reason: "not eligible" });
          continue;
        }

        const res: any = await performAnonymize(contactId, eventId, actor);
        d.query(`update ${SCHEDULE_TABLE} set status = $1, executed_at = $2, detail = $3 where event_id = $4`,
                [res.ok ? "done" : "failed", nowIso(),
                 res.alreadyAnonymized ? "already anonymized" : `${res.results?.length ?? 0} records written`, eventId]);
        done.push({ eventId, contactId, ok: !!res.ok });
      } catch (e: any) {
        const msg = String(e?.message ?? e).slice(0, 300);
        d.query(`update ${SCHEDULE_TABLE} set status = $1, executed_at = $2, detail = $3 where event_id = $4`,
                ["failed", nowIso(), msg, eventId]);
        audit(d, { actorEmail: actor, action: "SCHEDULE", referenceNo: eventId,
                   moduleName: CONTACT_MODULE, recordId: contactId, outcome: "failed", detail: msg });
        done.push({ eventId, contactId, ok: false, error: msg });
      }
    }

    return { ok: true, ranAt: now, considered: rows.length, results: done };
  },
});

server.execute();
