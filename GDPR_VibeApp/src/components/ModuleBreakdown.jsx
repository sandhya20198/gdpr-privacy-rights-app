import React, { useState } from "react";
import { CLASS, CLASS_DOT } from "../lib/engine.js";
import { IconChevronRight, IconFile, IconUser, IconBuilding, IconDatabase } from "../lib/icons.jsx";

/**
 * Module → Record → Field.
 * Accordion at both levels: at most one module and one record open at a time, so
 * expanding never turns the page into a wall.
 */
export default function ModuleBreakdown({ report }) {
  const [openModule, setOpenModule] = useState(null);

  const groups = [
    {
      key: "__contact",
      displayName: "Tenant Contact",
      icon: <IconUser size={16} />,
      badge: "Identity",
      records: [
        {
          id: report.contact.id,
          title: report.contact.name,
          state: null,
          fields: report.contact.fields,
          attachments: null,
          attachmentsScanned: false,
        },
      ],
    },
    ...(report.parent
      ? [{
          key: "__tenant",
          displayName: "Tenants",
          icon: <IconBuilding size={16} />,
          badge: "Household",
          records: [
            {
              id: report.parent.id,
              title: report.parent.name,
              state: null,
              fields: report.parent.fields,
              attachments: null,
              attachmentsScanned: false,
            },
          ],
        }]
      : []),
    ...report.moduleGroups.map((g) => ({
      key: g.module,
      displayName: g.displayName,
      icon: <IconDatabase size={16} />,
      badge: g.isCustom ? "Custom module" : null,
      lookupFields: g.lookupFields,
      records: g.records,
      noAttachmentSupport: report.modulesWithoutAttachmentSupport?.includes(g.displayName),
    })),
  ];

  return (
    <div className="fds-widget">
      <div className="fds-widget__header">
        <span className="t-h16">Where the data lives</span>
        <span className="t-cap-d nowrap">{groups.length} modules hold data</span>
      </div>

      <div className="fds-widget__body fds-widget__body--flush">
        <div className="acc">
          {groups.map((g) => {
            const isOpen = openModule === g.key;
            const dots = classDots(g.records);
            return (
              <div className="acc__item" key={g.key}>
                <button
                  className={`acc__head ${isOpen ? "is-open" : ""}`}
                  onClick={() => setOpenModule(isOpen ? null : g.key)}
                  aria-expanded={isOpen}
                >
                  <span className={`acc__chev ${isOpen ? "is-open" : ""}`}>
                    <IconChevronRight size={16} />
                  </span>
                  <span style={{ color: "var(--colors-iconNeutralLight)", display: "flex" }}>{g.icon}</span>
                  <span className="acc__label">
                    <span className="t-h14">{g.displayName}</span>
                    <span className="t-cap">
                      {g.records.length} record{g.records.length === 1 ? "" : "s"}
                      {g.lookupFields?.length
                        ? ` · via ${g.lookupFields.map((f) => f.displayName).join(", ")}`
                        : ""}
                    </span>
                  </span>
                  <span className="spacer" />
                  <span className="row" aria-hidden="true">
                    {dots.map((d) => <span key={d} className={`dot dot--${CLASS_DOT[d]}`} title={d} />)}
                  </span>
                  {g.badge && <span className="chip chip--muted nowrap">{g.badge}</span>}
                </button>

                {isOpen && (
                  <div className="acc__body">
                    <RecordList group={g} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="fds-widget__footer">
        <span className="t-cap">
          Scanned {report.counts.moduleCount} modules; {groups.length} hold data for this contact.
          Modules holding nothing are not listed.
        </span>
      </div>
    </div>
  );
}

function classDots(records) {
  const set = new Set();
  for (const r of records) for (const f of r.fields ?? []) set.add(f.klass);
  const order = [CLASS.DIRECT, CLASS.INDIRECT, CLASS.CONTENT, CLASS.META];
  return order.filter((o) => set.has(o));
}

function RecordList({ group }) {
  const [openRecord, setOpenRecord] = useState(
    group.records.length === 1 ? group.records[0].id : null
  );

  return (
    <div className="acc">
      {group.noAttachmentSupport && (
        <div
          style={{
            padding: "var(--spacing-containerLarge) var(--spacing-sectionLarge)",
            borderBottom: "1px solid var(--colors-borderNeutralBaseSubtle)",
          }}
        >
          <span className="t-cap">
            Attachments were not scanned for this module — no attachment action is available for it.
          </span>
        </div>
      )}

      {group.records.map((r) => {
        const isOpen = openRecord === r.id;
        return (
          <div className="acc__item" key={r.id}>
            <button
              className={`acc__head ${isOpen ? "is-open" : ""}`}
              onClick={() => setOpenRecord(isOpen ? null : r.id)}
              aria-expanded={isOpen}
            >
              <span className={`acc__chev ${isOpen ? "is-open" : ""}`}>
                <IconChevronRight size={14} />
              </span>
              <span className="acc__label">
                <span className="t-body">{r.title}</span>
                <span className="t-cap t-mono">#{r.id}</span>
              </span>
              <span className="spacer" />
              {r.attachments?.length > 0 && (
                <span className="chip chip--muted nowrap">
                  <IconFile size={12} /> {r.attachments.length}
                </span>
              )}
              {r.state && (
                <span className="row nowrap">
                  <span className={`dot dot--${stateDot(r.state)}`} />
                  <span className="t-cap">{r.state}</span>
                </span>
              )}
            </button>

            {isOpen && <FieldTable record={r} />}
          </div>
        );
      })}
    </div>
  );
}

function stateDot(state) {
  if (/closed|complete|resolved/i.test(state)) return "success";
  if (/hold|pending|submitted/i.test(state)) return "warning";
  if (/cancel|reject/i.test(state)) return "error";
  return "info";
}

function FieldTable({ record }) {
  const hasContent = record.fields?.some((f) => f.klass === CLASS.CONTENT);
  return (
    <div className="acc__detail">
      <div className="tbl-scroll">
        <table className="fds-table">
          <thead>
            <tr>
              <th>Field</th>
              <th>Value held</th>
              <th>Classification</th>
              <th>Anonymizable</th>
            </tr>
          </thead>
          <tbody>
            {record.fields?.map((f) => (
              <tr key={f.field}>
                <td className="nowrap"><span className="t-h14">{f.label}</span></td>
                <td>
                  <span className={f.klass === CLASS.DIRECT ? "t-body t-mono" : "t-desc"}>{f.value}</span>
                  {f.note && <div className="t-cap" style={{ marginTop: 2 }}>{f.note}</div>}
                </td>
                <td className="nowrap">
                  <span className="row">
                    <span className={`dot dot--${CLASS_DOT[f.klass]}`} />
                    <span className="t-desc">{f.klass}</span>
                  </span>
                </td>
                <td className="nowrap">
                  {f.anonymizable === "Yes"
                    ? <span className="row"><span className="dot dot--success" /><span className="t-desc">Yes</span></span>
                    : <span className="t-cap">{f.anonymizable}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {record.attachments?.length > 0 && (
        <div
          style={{
            borderTop: "1px solid var(--colors-borderNeutralBaseSubtler)",
            padding: "var(--spacing-containerXxLarge)",
          }}
        >
          <div className="section-head">
            <span className="t-eyebrow">Related items</span>
            <span className="section-head__rule" />
          </div>
          <div className="stack-s" style={{ marginTop: "var(--spacing-containerLarge)" }}>
            {record.attachments.map((a) => (
              <div className="row" key={a.id}>
                <span style={{ color: "var(--colors-iconNeutralLight)", display: "flex" }}>
                  <IconFile size={14} />
                </span>
                <span className="t-body">{a.name}</span>
                {a.size != null && <span className="t-cap">{fmtBytes(a.size)}</span>}
                {a.uploadedBy && <span className="t-cap">· {a.uploadedBy}</span>}
                <span className="spacer" />
                <span className="t-cap">Manual action required</span>
              </div>
            ))}
          </div>
          <p className="t-cap" style={{ marginTop: "var(--spacing-containerLarge)", marginBottom: 0 }}>
            Attachments are listed because this record is provably the subject&apos;s. Filenames are not
            matched or classified, and the portal cannot delete files.
          </p>
        </div>
      )}

      {hasContent && (
        <div
          style={{
            borderTop: "1px solid var(--colors-borderNeutralBaseSubtler)",
            padding: "var(--spacing-containerLarge) var(--spacing-containerXxLarge)",
            background: "var(--colors-backgroundMidgroundSubtle)",
          }}
        >
          <span className="t-cap">
            Record content is displayed so you can see what is written where. The portal does not search
            it and will not rewrite it.
          </span>
        </div>
      )}
    </div>
  );
}

function fmtBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)} KB`;
  return `${(v / 1024 / 1024).toFixed(1)} MB`;
}
