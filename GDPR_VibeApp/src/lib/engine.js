/**
 * Discovery engine.
 *
 * ONE rule governs everything here: a record enters the report if and only if it
 * holds a LOOKUP to the subject's Tenant Contact record. There is no free-text
 * matching, no name comparison, and no notes access anywhere in this file.
 */

import { action, rowsOf, countOf, mapLimit, fn } from "./vibe.js";

/**
 * The SYSTEM Tenants / Tenant Contacts modules — not the custom look-alikes.
 * Both live in this org, but the system pair is the one the product writes to,
 * so its field names are plain (`email`, not `email_custom_tenantcontact`) and
 * it is read through the dedicated tenant actions rather than the generic
 * custom-module ones.
 */
export const CONTACT_MODULE = "tenantcontact";
export const TENANT_MODULE = "tenant";

export const F_EMAIL = "email";
export const F_PHONE = "phone";
export const F_PRIMARY = "isPrimaryContact";
export const F_PARENT = "tenant";
/** System FILE field on Tenant Contact — the "photo section". Not in the
 *  default projection, so it must be selected explicitly. */
export const F_PHOTO = "avatar";

const T_NAME = "primaryContactName";
const T_EMAIL = "primaryContactEmail";
const T_PHONE = "primaryContactPhone";
const T_ADDRESS = "address";
const T_TYPE = "tenantType";

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SWEEP_CONCURRENCY = 8;

/**
 * Attachment listing is NOT generic — each module has its own action and its own
 * id parameter name. Only verified pairs live here; any other module is reported
 * as "attachments not scanned" rather than silently claiming zero.
 */
const ATTACHMENT_ACTIONS = {
  workorder: { slug: "list-workorder-attachments", param: "work_order_id" },
  serviceRequest: { slug: "list-service-request-attachments", param: "service_request_id" },
  workpermit: { slug: "list-permit-attachments", param: "work_permit_id" },
  visitorlog: { slug: "list-visit-attachments", param: "visit_id" },
};

/* ------------------------------------------------------------------ *
 * Classification — a LABEL on fields of an already-matched record.
 * It performs no comparison and never decides whether a record matches.
 * ------------------------------------------------------------------ */
export const CLASS = {
  DIRECT: "Direct identifier",
  INDIRECT: "Indirect identifier",
  CONTENT: "Record content",
  META: "Metadata",
};

export const CLASS_DOT = {
  [CLASS.DIRECT]: "error",
  [CLASS.INDIRECT]: "warning",
  [CLASS.CONTENT]: "accent",
  [CLASS.META]: "neutral",
};

/* ------------------------------------------------------------------ *
 * Schema resolver — the dynamic-module requirement
 * ------------------------------------------------------------------ */

/**
 * Sweep every module in the org and keep the fields that look up to the Tenant
 * Contact module. Nothing about which modules matter is hardcoded, so a lookup
 * added to any module later is picked up on the next sweep with no code change.
 */
export async function sweepSchema({ onProgress } = {}) {
  const modsPayload = await action("facilio-cmms", "list-modules", {});
  const modules = rowsOf(modsPayload)
    .filter((m) => m && typeof m.name === "string")
    .map((m) => ({ name: m.name, displayName: m.displayName || m.name, isCustom: !!m.isCustom }));

  let done = 0;
  const failures = [];
  const linked = [];

  await mapLimit(modules, SWEEP_CONCURRENCY, async (m) => {
    try {
      const payload = await action("facilio-customization", "list-fields", { moduleName: m.name });
      const fields = rowsOf(payload);
      const hits = fields.filter((f) => f && f.lookupModuleName === CONTACT_MODULE);
      if (hits.length) {
        linked.push({
          module: m.name,
          displayName: m.displayName,
          isCustom: m.isCustom,
          fields: hits.map((f) => ({ name: f.name, displayName: f.displayName || f.name })),
          allFields: fields.map((f) => ({
            name: f.name,
            displayName: f.displayName || f.name,
            dataType: f.dataType,
            lookupModuleName: f.lookupModuleName,
          })),
        });
      }
    } catch (e) {
      failures.push({ module: m.name, error: String(e?.message ?? e) });
    } finally {
      done++;
      onProgress?.({ done, total: modules.length, module: m.displayName });
    }
  });

  linked.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return { moduleCount: modules.length, linked, failures, contactModule: CONTACT_MODULE,
           sweptAt: new Date().toISOString() };
}

/** Cached map, refreshing only when stale or forced. */
export async function getLookupMap({ force = false, onProgress } = {}) {
  if (!force) {
    try {
      const cached = await fn("cache-get", {});
      // A map swept for a different contact module lists lookup fields that no
      // longer resolve — it must be re-swept, not merely aged out.
      if (cached?.found && cached.payload?.linked && cached.payload.contactModule === CONTACT_MODULE) {
        const age = Date.now() - new Date(cached.fetchedAt).getTime();
        if (Number.isFinite(age) && age < CACHE_MAX_AGE_MS) {
          return { ...cached.payload, moduleCount: cached.moduleCount, fromCache: true, fetchedAt: cached.fetchedAt };
        }
      }
    } catch (_) {
      /* cache is an optimisation, never a hard dependency */
    }
  }

  const swept = await sweepSchema({ onProgress });
  try {
    await fn("cache-put", {
      payload: JSON.stringify({ linked: swept.linked, failures: swept.failures,
                                contactModule: swept.contactModule, sweptAt: swept.sweptAt }),
      moduleCount: swept.moduleCount,
    });
  } catch (_) {
    /* a failed cache write must not fail the search */
  }
  return { ...swept, fromCache: false, fetchedAt: swept.sweptAt };
}

/* ------------------------------------------------------------------ *
 * Field helpers
 * ------------------------------------------------------------------ */

const META_FIELDS = new Set([
  "sysCreatedTime", "sysModifiedTime", "sysCreatedBy", "sysModifiedBy",
  "createdTime", "modifiedTime", "createdBy", "modifiedBy",
]);

const INDIRECT_FIELDS = new Set([
  "tenant", "site", "siteId", "space", "buildingSpace", "tenantunit", "resource",
  "client", "vendor", "territory", "zoneId", "countryId", "stateId", "county",
]);

const CONTENT_FIELDS = new Set(["subject", "description", "name", "title", "remarks", "comments"]);

/**
 * Fields worth asking for, in preference order. Only those the module actually
 * declares are requested, so this stays valid for a module nobody anticipated.
 */
const INTERESTING = [
  "subject", "name", "title", "description",
  "moduleState", "status", "priority", "urgency",
  "tenant", "site", "siteId", "space", "buildingSpace", "resource",
  "createdTime", "sysCreatedTime", "modifiedTime", "sysModifiedTime",
  "createdBy", "sysCreatedBy", "noOfAttachments",
];

function selectFor(moduleMeta, lookupField) {
  const declared = new Set((moduleMeta.allFields ?? []).map((f) => f.name));
  const picks = ["id", lookupField];
  for (const f of INTERESTING) if (declared.has(f) && !picks.includes(f)) picks.push(f);
  return picks.join(",");
}

function displayValue(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    if (v.name) return String(v.name);
    if (v.displayName) return String(v.displayName);
    if (v.fileName) return String(v.fileName);
    if (v.email) return String(v.email);
    if (v.id) return `#${v.id}`;
    return null;
  }
  return String(v);
}

/**
 * A FILE field's value shape is not documented and no contact in this org has a
 * photo yet, so both helpers are deliberately tolerant: any recognisable URL
 * renders as an image, anything else degrades to a label. Neither ever throws.
 */
export function photoSrc(v) {
  if (!v) return null;
  if (typeof v === "string") return /^(https?:|data:)/.test(v) ? v : null;
  if (typeof v === "object") {
    for (const k of ["url", "downloadUrl", "previewUrl", "src", "filePath", "downloadUrl2"]) {
      const c = v[k];
      if (typeof c === "string" && /^(https?:|data:)/.test(c)) return c;
    }
  }
  return null;
}

export function photoLabel(v) {
  if (!v) return null;
  if (typeof v === "object") return String(v.fileName ?? v.name ?? (v.id != null ? `file #${v.id}` : "On file"));
  return typeof v === "string" && !/^(https?:|data:)/.test(v) ? v : "On file";
}

/**
 * The system Tenant's address is a LOOKUP to a location record, so it arrives as
 * an object. Render the parts that carry meaning; a location holding nothing but
 * ids and coordinates is reported as absent rather than as "#3439107".
 */
function addressLabel(v) {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (typeof v !== "object") return String(v);
  const parts = [v.name, v.street, v.city, v.state, v.zip, v.country]
    .map((p) => (p == null ? "" : String(p).trim()))
    .filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

function fmtDate(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

/** Build the field-level rows for one linked record. */
function fieldsForLinkedRecord(record, lookupFieldNames, moduleMeta) {
  const rows = [];
  const labelOf = (n) => moduleMeta?.allFields?.find((f) => f.name === n)?.displayName || n;

  // The lookup itself — the reason this record is in the report at all.
  for (const ln of lookupFieldNames) {
    const v = record[ln];
    const nested = v && typeof v === "object" ? v : null;
    const nestedEmail = nested?.[F_EMAIL] ?? nested?.email ?? null;
    const shown = displayValue(v);
    rows.push({
      field: ln,
      label: labelOf(ln),
      value: shown && nestedEmail ? `${shown} · ${nestedEmail}` : (shown ?? "(linked)"),
      klass: CLASS.DIRECT,
      anonymizable: "Via contact record",
      note: "The lookup that put this record in the report. Erasing the contact updates what resolves here.",
    });
  }

  for (const [k, v] of Object.entries(record)) {
    if (lookupFieldNames.includes(k)) continue;
    if (k === "id" || k === "localId" || k === "serialNumber") continue;
    const shown = displayValue(v);
    if (shown === null) continue;

    if (META_FIELDS.has(k)) {
      rows.push({
        field: k, label: labelOf(k),
        value: /Time$/.test(k) ? fmtDate(v) : shown,
        klass: CLASS.META, anonymizable: "No",
      });
    } else if (INDIRECT_FIELDS.has(k)) {
      rows.push({ field: k, label: labelOf(k), value: shown, klass: CLASS.INDIRECT, anonymizable: "No" });
    } else if (CONTENT_FIELDS.has(k)) {
      rows.push({
        field: k, label: labelOf(k), value: shown, klass: CLASS.CONTENT, anonymizable: "No",
        note: "Shown for completeness. The portal never matches on or modifies free text.",
      });
    }
  }

  const order = [CLASS.DIRECT, CLASS.INDIRECT, CLASS.CONTENT, CLASS.META];
  rows.sort((a, b) => order.indexOf(a.klass) - order.indexOf(b.klass));
  return rows;
}

function recordTitle(record, moduleName) {
  return (
    displayValue(record.subject) ||
    displayValue(record.name) ||
    displayValue(record.title) ||
    `${moduleName} #${record.id}`
  );
}

/**
 * Resolve a contact by email — identity only.
 *
 * The scheduling flow needs the record id and nothing else, so it deliberately
 * skips the module sweep that discover() performs; booking a date is not a
 * disclosure and should not cost a 70-module scan.
 */
export async function findContactByEmail(email) {
  const clean = String(email || "").trim();
  if (!clean) return null;
  const payload = await action("facilio-cmms", "list-tenant-contacts", {
    filters: `${F_EMAIL}(is)=${clean}`,
    select: `id,name,${F_EMAIL},${F_PRIMARY},${F_PARENT},moduleState`,
    expand: F_PARENT,
    page_size: 5,
  });
  const rows = rowsOf(payload);
  if (!rows.length) return null;
  const c = rows[0];
  const parent = c[F_PARENT] && typeof c[F_PARENT] === "object" ? c[F_PARENT] : null;
  return {
    id: c.id,
    name: displayValue(c.name),
    email: String(c[F_EMAIL] ?? ""),
    tenantName: parent ? displayValue(parent.name) : null,
    duplicates: rows.length - 1,
  };
}

/** Names for a set of contact ids, for the scheduled list. Resolved live so no
 *  subject name is ever written to the app database. */
export async function contactNames(ids) {
  const unique = [...new Set(ids.filter((n) => Number.isFinite(Number(n))))];
  const out = new Map();
  await mapLimit(unique, 6, async (id) => {
    try {
      const payload = await action("facilio-cmms", "list-tenant-contacts", {
        filters: `id(is)=${id}`,
        select: `id,name,${F_EMAIL}`,
        page_size: 1,
      });
      const r = rowsOf(payload)[0];
      if (r) out.set(Number(id), { name: displayValue(r.name), email: String(r[F_EMAIL] ?? "") });
    } catch (_) { /* a name that will not resolve simply shows as the id */ }
  });
  return out;
}

/* ------------------------------------------------------------------ *
 * Discovery
 * ------------------------------------------------------------------ */

/**
 * @param email    the subject's address — used for THIS search only, never stored
 * @param onStage  progress callback for the checklist
 */
export async function discover(email, { onStage, force = false } = {}) {
  const clean = String(email || "").trim();
  const failures = [];

  /* ---- schema -------------------------------------------------- */
  onStage?.({ key: "schema", state: "active" });
  const map = await getLookupMap({
    force,
    onProgress: ({ done, total, module }) =>
      onStage?.({ key: "schema", state: "active", done, total, note: module }),
  });
  failures.push(...(map.failures || []).map((f) => ({ stage: "schema", ...f })));
  onStage?.({
    key: "schema", state: "done",
    count: map.linked.length,
    note: `${map.moduleCount} modules scanned · ${map.linked.length} link to Tenant Contact`,
    fromCache: map.fromCache,
  });

  /* ---- A. identity --------------------------------------------- */
  onStage?.({ key: "identity", state: "active" });
  const idPayload = await action("facilio-cmms", "list-tenant-contacts", {
    filters: `${F_EMAIL}(is)=${clean}`,
    select: `id,name,${F_EMAIL},${F_PHONE},${F_PRIMARY},${F_PARENT},${F_PHOTO},sysCreatedTime,sysModifiedTime`,
    expand: F_PARENT,
    include_count: true,
    page_size: 20,
  });
  const contacts = rowsOf(idPayload);

  if (!contacts.length) {
    onStage?.({ key: "identity", state: "done", count: 0 });
    return {
      found: false, email: clean, moduleCount: map.moduleCount,
      lookupModules: map.linked.length, failures,
      schemaFromCache: map.fromCache, schemaFetchedAt: map.fetchedAt,
    };
  }

  const contact = contacts[0];
  const contactId = contact.id;
  const duplicateContacts = contacts.slice(1);
  onStage?.({ key: "identity", state: "done", count: contacts.length });

  /* ---- B. erasure eligibility ---------------------------------- *
   * Resolved as soon as the person is identified, not after the module sweep:
   * the Schedule flow answers "may this contact be erased?" the moment you give
   * it an email, and the Now flow should not make you wait through a 70-module
   * scan for the same answer. A primary contact needs an expired tenant, anyone
   * else needs to be inactive.
   *
   * The erasure handlers re-check and are the ones that actually enforce it, so
   * a failure here must not fail the search: the verdict degrades to unknown
   * and nothing downstream treats that as permission. */
  onStage?.({ key: "eligibility", state: "active" });
  let eligibility = null;
  try {
    eligibility = await fn("schedule-eligibility", { contactId });
  } catch (e) {
    failures.push({ stage: "eligibility", error: String(e?.message ?? e) });
  }
  onStage?.({
    key: "eligibility", state: "done",
    note: eligibility ? (eligibility.eligible ? "may be erased" : "blocked") : "unknown",
  });

  /* ---- C. household ------------------------------------------- */
  onStage?.({ key: "household", state: "active" });
  let parent = contact[F_PARENT] && typeof contact[F_PARENT] === "object" ? contact[F_PARENT] : null;
  // An expanded lookup is projected down — its `moduleState` arrives as a bare
  // {id}, which would print as "#187637". Re-read the tenant on its own so the
  // household table shows resolved values.
  if (parent?.id) {
    try {
      const t = await action("facilio-cmms", "get-tenant", { id: Number(parent.id) });
      if (t?.data) parent = { ...parent, ...t.data };
    } catch (e) {
      failures.push({ stage: "household", module: TENANT_MODULE, recordId: parent.id, error: String(e?.message ?? e) });
    }
  }
  onStage?.({ key: "household", state: "done", count: parent ? 1 : 0 });

  /* ---- D. linked records, in EVERY module the resolver found --- */
  onStage?.({ key: "linked", state: "active", done: 0, total: map.linked.length });
  const moduleGroups = [];
  let scanned = 0;

  await mapLimit(map.linked, 6, async (m) => {
    // A module may hold more than one lookup to the same person.
    const byId = new Map();
    for (const f of m.fields) {
      try {
        const payload = await action("facilio-cmms", "list-custom-module-records", {
          custom_module: m.module,
          filters: `${f.name}(is)=${contactId}`,
          // The default projection omits the lookup field itself, so ask for it
          // explicitly — otherwise the field table can only say "(linked)".
          select: selectFor(m, f.name),
          expand: f.name,
          include_count: true,
          page_size: 200,
        });
        for (const r of rowsOf(payload)) {
          const prev = byId.get(r.id);
          if (prev) prev.__via.add(f.name);
          else { r.__via = new Set([f.name]); byId.set(r.id, r); }
        }
      } catch (e) {
        failures.push({ stage: "linked", module: m.module, field: f.name, error: String(e?.message ?? e) });
      }
    }

    const records = [...byId.values()].map((r) => {
      const via = [...r.__via];
      delete r.__via;
      return {
        id: r.id,
        title: recordTitle(r, m.displayName),
        state: displayValue(r.moduleState) || displayValue(r.status) || null,
        created: r.createdTime || r.sysCreatedTime || null,
        via,
        fields: fieldsForLinkedRecord(r, via, m),
        attachments: null,       // filled by pass D
        attachmentsScanned: false,
        raw: r,
      };
    });

    // Hide modules with no data entirely — an empty module is not shown at all.
    if (records.length) {
      moduleGroups.push({
        module: m.module,
        displayName: m.displayName,
        isCustom: m.isCustom,
        lookupFields: m.fields,
        records,
        allFields: m.allFields,
      });
    }
    scanned++;
    onStage?.({ key: "linked", state: "active", done: scanned, total: map.linked.length, note: m.displayName });
  });

  moduleGroups.sort((a, b) => b.records.length - a.records.length || a.displayName.localeCompare(b.displayName));
  const linkedRecordCount = moduleGroups.reduce((n, g) => n + g.records.length, 0);
  onStage?.({ key: "linked", state: "done", count: linkedRecordCount });

  /* ---- E. attachments on those records ------------------------ */
  onStage?.({ key: "attachments", state: "active" });
  const targets = [];
  for (const g of moduleGroups) {
    const spec = ATTACHMENT_ACTIONS[g.module];
    if (!spec) continue;
    for (const r of g.records) targets.push({ g, r, spec });
  }

  let attachmentCount = 0;
  await mapLimit(targets, 6, async ({ g, r, spec }) => {
    try {
      const payload = await action("facilio-cmms", spec.slug, { [spec.param]: r.id });
      const files = rowsOf(payload).map((f) => ({
        id: f.id,
        name: f.fileName || f.name || f.filename || `file-${f.id}`,
        size: f.fileSize ?? f.size ?? null,
        uploadedBy: displayValue(f.uploadedBy || f.createdBy),
        at: f.uploadedTime || f.createdTime || null,
      }));
      r.attachments = files;
      r.attachmentsScanned = true;
      attachmentCount += files.length;
    } catch (e) {
      r.attachments = [];
      r.attachmentsScanned = false;
      failures.push({ stage: "attachments", module: g.module, recordId: r.id, error: String(e?.message ?? e) });
    }
  });

  const modulesWithoutAttachmentSupport = moduleGroups
    .filter((g) => !ATTACHMENT_ACTIONS[g.module])
    .map((g) => g.displayName);

  onStage?.({ key: "attachments", state: "done", count: attachmentCount });

  /* ---- identity + household field tables ---------------------- */
  const contactFields = [
    { field: "name", label: "Name", value: displayValue(contact.name), klass: CLASS.DIRECT, anonymizable: "Yes" },
    { field: F_EMAIL, label: "Email", value: displayValue(contact[F_EMAIL]), klass: CLASS.DIRECT, anonymizable: "Yes" },
    { field: F_PHONE, label: "Phone", value: displayValue(contact[F_PHONE]), klass: CLASS.DIRECT, anonymizable: "Yes" },
    { field: F_PHOTO, label: "Photo", value: photoLabel(contact[F_PHOTO]),
      klass: CLASS.DIRECT, anonymizable: "Yes — removed" },
    { field: F_PRIMARY, label: "Is Primary Contact", value: displayValue(contact[F_PRIMARY]), klass: CLASS.META, anonymizable: "No" },
    { field: F_PARENT, label: "Related Tenant", value: displayValue(parent), klass: CLASS.INDIRECT, anonymizable: "No" },
    { field: "sysCreatedTime", label: "Created", value: fmtDate(contact.sysCreatedTime), klass: CLASS.META, anonymizable: "No" },
    { field: "sysModifiedTime", label: "Modified", value: fmtDate(contact.sysModifiedTime), klass: CLASS.META, anonymizable: "No" },
  ].filter((r) => r.value !== null);

  const subjectEmail = String(contact[F_EMAIL] ?? "");
  const alreadyAnonymized = subjectEmail.endsWith("@redacted.invalid");

  const parentFields = parent
    ? [
        { field: T_NAME, label: "Primary Contact Name", value: displayValue(parent[T_NAME]), klass: CLASS.DIRECT,
          anonymizable: sameStr(parent[T_NAME], contact.name) ? "Yes" : "No — differs from this contact" },
        { field: T_EMAIL, label: "Primary Contact E-Mail", value: displayValue(parent[T_EMAIL]), klass: CLASS.DIRECT,
          anonymizable: sameStr(parent[T_EMAIL], contact[F_EMAIL]) ? "Yes" : "No — differs from this contact" },
        { field: T_PHONE, label: "Primary Contact Phone", value: displayValue(parent[T_PHONE]), klass: CLASS.DIRECT,
          anonymizable: sameStr(parent[T_PHONE], contact[F_PHONE]) ? "Yes" : "No — differs from this contact" },
        { field: T_ADDRESS, label: "Address", value: addressLabel(parent[T_ADDRESS]), klass: CLASS.INDIRECT, anonymizable: "No" },
        { field: T_TYPE, label: "Tenant Type", value: displayValue(parent[T_TYPE]), klass: CLASS.META, anonymizable: "No" },
        { field: "name", label: "Tenant Name", value: displayValue(parent.name), klass: CLASS.INDIRECT, anonymizable: "No" },
      ].filter((r) => r.value !== null)
    : [];

  const anonymizableFieldCount =
    contactFields.filter((f) => f.anonymizable === "Yes").length +
    parentFields.filter((f) => f.anonymizable === "Yes").length;

  /* ---- retention, summary level only ------------------------- */
  const allRecords = moduleGroups.flatMap((g) => g.records);
  const openish = allRecords.filter((r) => isOpenState(r.state)).length;
  const oldest = allRecords.reduce((acc, r) => {
    const t = r.created ? new Date(r.created).getTime() : NaN;
    return Number.isFinite(t) ? Math.min(acc, t) : acc;
  }, Infinity);
  const oldestMonths = Number.isFinite(oldest)
    ? Math.max(0, Math.round((Date.now() - oldest) / (1000 * 60 * 60 * 24 * 30)))
    : null;

  return {
    found: true,
    email: clean,
    contact: {
      id: contactId,
      name: displayValue(contact.name),
      email: subjectEmail,
      phone: displayValue(contact[F_PHONE]),
      photo: contact[F_PHOTO] ?? null,
      isPrimary: !!contact[F_PRIMARY],
      fields: contactFields,
    },
    alreadyAnonymized,
    eligibility,
    duplicateContacts: duplicateContacts.map((c) => ({ id: c.id, name: displayValue(c.name) })),
    parent: parent
      ? { id: parent.id, name: displayValue(parent.name), fields: parentFields }
      : null,
    moduleGroups,
    counts: {
      records: linkedRecordCount + 1 + (parent ? 1 : 0),
      linkedRecords: linkedRecordCount,
      modulesWithData: moduleGroups.length + 1 + (parent ? 1 : 0),
      lookupModules: map.linked.length,
      moduleCount: map.moduleCount,
      attachments: attachmentCount,
      anonymizableFields: anonymizableFieldCount,
    },
    retention: { open: openish, closed: allRecords.length - openish, oldestMonths },
    modulesWithoutAttachmentSupport,
    failures,
    schemaFromCache: map.fromCache,
    schemaFetchedAt: map.fetchedAt,
  };
}

function sameStr(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

function isOpenState(state) {
  if (!state) return true;
  return !/closed|complete|resolved|cancel/i.test(String(state));
}

export const STAGES = [
  { key: "schema", label: "Resolve schema" },
  { key: "identity", label: "Identity" },
  { key: "eligibility", label: "Erasure eligibility" },
  { key: "household", label: "Household (parent Tenant)" },
  { key: "linked", label: "Linked records" },
  { key: "attachments", label: "Attachments" },
];
