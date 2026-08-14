/**
 * DEV-ONLY visual fixture.
 *
 * Local `vite dev` cannot reach the Vibe backend (the SDK calls host-relative
 * /api/runtime/* paths that only exist on the Vibe host), so this exists purely
 * so the report UI can be SEEN and verified in both themes before shipping.
 *
 * Values are copied verbatim from the live Article 17 org, so the shapes match
 * what discover() really returns. Gated on import.meta.env.DEV and reached only
 * via ?mock=1 — Vite drops it from the production bundle entirely.
 */

import { CLASS } from "./engine.js";

const D = CLASS.DIRECT, I = CLASS.INDIRECT, C = CLASS.CONTENT, M = CLASS.META;

const woFields = (subject, desc) => [
  { field: "tenant_contact_workorder", label: "Tenant Contact", value: "James Carter · james.carter@acmeretail.example", klass: D, anonymizable: "Via contact record", note: "The lookup that put this record in the report. Erasing the contact updates what resolves here." },
  { field: "siteId", label: "Site", value: "site-A", klass: I, anonymizable: "No" },
  { field: "subject", label: "Subject", value: subject, klass: C, anonymizable: "No", note: "Shown for completeness. The portal never matches on or modifies free text." },
  { field: "description", label: "Description", value: desc, klass: C, anonymizable: "No", note: "Shown for completeness. The portal never matches on or modifies free text." },
  { field: "createdTime", label: "Created Time", value: "13 Aug 2026", klass: M, anonymizable: "No" },
  { field: "sysModifiedTime", label: "System Modified Time", value: "13 Aug 2026", klass: M, anonymizable: "No" },
  { field: "sysCreatedBy", label: "System Created By", value: "Article 17", klass: M, anonymizable: "No" },
];

const srFields = (subject, desc) => [
  { field: "tenantcontactsystem_serviceRequest", label: "Tenant Contact", value: "James Carter · james.carter@acmeretail.example", klass: D, anonymizable: "Via contact record", note: "The lookup that put this record in the report. Erasing the contact updates what resolves here." },
  { field: "site", label: "Site", value: "site-A", klass: I, anonymizable: "No" },
  { field: "subject", label: "Subject", value: subject, klass: C, anonymizable: "No", note: "Shown for completeness. The portal never matches on or modifies free text." },
  { field: "description", label: "Description", value: desc, klass: C, anonymizable: "No", note: "Shown for completeness. The portal never matches on or modifies free text." },
  { field: "sysCreatedTime", label: "System Created Time", value: "13 Aug 2026", klass: M, anonymizable: "No" },
];

export const FIXTURE = {
  found: true,
  email: "james.carter@acmeretail.example",
  contact: {
    id: 4830454,
    name: "James Carter",
    email: "james.carter@acmeretail.example",
    phone: "+1-555-0201",
    // Stand-in URL: no contact in the org has a photo yet, so this exists only so
    // the photo path can be seen rendering in dev.
    photo: { id: 77001, fileName: "james-carter.jpg", url: "https://static.facilio.com/common/facilio-dark-logo.svg" },
    isPrimary: true,
    fields: [
      { field: "name", label: "Name", value: "James Carter", klass: D, anonymizable: "Yes" },
      { field: "email", label: "Email", value: "james.carter@acmeretail.example", klass: D, anonymizable: "Yes" },
      { field: "phone", label: "Phone", value: "+1-555-0201", klass: D, anonymizable: "Yes" },
      { field: "avatar", label: "Photo", value: "james-carter.jpg", klass: D, anonymizable: "Yes — removed" },
      { field: "isPrimaryContact", label: "Is Primary Contact", value: "Yes", klass: M, anonymizable: "No" },
      { field: "tenant", label: "Related Tenant", value: "Acme Retail Group", klass: I, anonymizable: "No" },
      { field: "sysCreatedTime", label: "Created", value: "13 Aug 2026", klass: M, anonymizable: "No" },
      { field: "sysModifiedTime", label: "Modified", value: "13 Aug 2026", klass: M, anonymizable: "No" },
    ],
  },
  alreadyAnonymized: false,
  duplicateContacts: [],
  parent: {
    id: 4830451,
    name: "Acme Retail Group",
    fields: [
      { field: "primaryContactName", label: "Primary Contact Name", value: "James Carter", klass: D, anonymizable: "Yes" },
      { field: "primaryContactEmail", label: "Primary Contact E-Mail", value: "james.carter@acmeretail.example", klass: D, anonymizable: "Yes" },
      { field: "primaryContactPhone", label: "Primary Contact Phone", value: "+1-555-0201", klass: D, anonymizable: "Yes" },
      { field: "address", label: "Address", value: "100 Market St, Suite 1, Springfield", klass: I, anonymizable: "No" },
      { field: "tenantType", label: "Tenant Type", value: "Commercial", klass: M, anonymizable: "No" },
      { field: "name", label: "Tenant Name", value: "Acme Retail Group", klass: I, anonymizable: "No" },
    ],
  },
  moduleGroups: [
    {
      module: "serviceRequest",
      displayName: "Service Requests",
      isCustom: false,
      lookupFields: [{ name: "tenantcontactsystem_serviceRequest", displayName: "Tenant Contact" }],
      records: [
        { id: 210410, title: "Request for cleaning service", state: "Open", created: "2026-08-13T10:28:51Z", via: ["tenantcontactsystem_serviceRequest"], attachments: [], attachmentsScanned: true, fields: srFields("Request for cleaning service", "Requested by James Carter (Acme Retail Group) at site-A") },
        { id: 210404, title: "Request for pest control service", state: "Open", created: "2026-08-13T10:28:51Z", via: ["tenantcontactsystem_serviceRequest"], attachments: [], attachmentsScanned: true, fields: srFields("Request for pest control service", "Requested by James Carter (Acme Retail Group) at site-A") },
        { id: 210402, title: "Request for extra trash bins", state: "Open", created: "2026-08-13T10:28:50Z", via: ["tenantcontactsystem_serviceRequest"], attachments: [], attachmentsScanned: true, fields: srFields("Request for extra trash bins", "Requested by James Carter (Acme Retail Group) at site-A") },
      ],
    },
    {
      module: "workorder",
      displayName: "Work Orders",
      isCustom: false,
      lookupFields: [{ name: "tenant_contact_workorder", displayName: "Tenant Contact" }],
      records: [
        {
          id: 14294695, title: "Ceiling tile water damage", state: "Submitted", created: "2026-08-13T11:16:30Z",
          via: ["tenant_contact_workorder"], attachmentsScanned: true,
          attachments: [{ id: 991, name: "carter-ceiling-damage.jpg", size: 284310, uploadedBy: "Article 17", at: "2026-08-13T11:20:00Z" }],
          fields: woFields("Ceiling tile water damage", "Reported by James Carter (Acme Retail Group) at site-A"),
        },
        { id: 14294691, title: "Parking lot pothole repair", state: "Submitted", created: "2026-08-13T11:16:25Z", via: ["tenant_contact_workorder"], attachments: [], attachmentsScanned: true, fields: woFields("Parking lot pothole repair", "Reported by James Carter (Acme Retail Group) at site-A") },
      ],
    },
  ],
  counts: {
    records: 7,
    linkedRecords: 5,
    modulesWithData: 4,
    lookupModules: 2,
    moduleCount: 70,
    attachments: 1,
    anonymizableFields: 6,
  },
  retention: { open: 5, closed: 0, oldestMonths: 0 },
  modulesWithoutAttachmentSupport: [],
  failures: [],
  schemaFromCache: false,
  schemaFetchedAt: new Date().toISOString(),
};

/** A second fixture exercising the partial-failure and no-linked-records paths. */
export const FIXTURE_EDGE = {
  ...FIXTURE,
  moduleGroups: [],
  counts: { ...FIXTURE.counts, records: 2, linkedRecords: 0, modulesWithData: 2, attachments: 0 },
  retention: { open: 0, closed: 0, oldestMonths: null },
  failures: [
    { stage: "linked", module: "workorder", field: "tenant_contact_workorder", error: "upstream timeout after 10s" },
  ],
  modulesWithoutAttachmentSupport: ["Inspections"],
};
