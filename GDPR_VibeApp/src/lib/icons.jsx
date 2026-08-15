/* Inline, self-contained icons — no external icon dependency to be stripped. */

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

function Svg({ children, size = 16, ...rest }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" {...base} {...rest}>
      {children}
    </svg>
  );
}

export const IconShield = (p) => (
  <Svg {...p}>
    <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
    <path d="M9.2 12.2l2 2 3.6-3.9" />
  </Svg>
);

export const IconSearch = (p) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </Svg>
);

export const IconChevronRight = (p) => (
  <Svg {...p}><path d="M9 5l7 7-7 7" /></Svg>
);

export const IconChevronDown = (p) => (
  <Svg {...p}><path d="M5 9l7 7 7-7" /></Svg>
);

export const IconCheck = (p) => (
  <Svg {...p}><path d="M4.5 12.5l5 5 10-11" /></Svg>
);

export const IconX = (p) => (
  <Svg {...p}><path d="M6 6l12 12M18 6L6 18" /></Svg>
);

export const IconAlert = (p) => (
  <Svg {...p}>
    <path d="M12 4.5l8.5 15h-17l8.5-15z" />
    <path d="M12 10v4" /><path d="M12 16.6v.2" />
  </Svg>
);

export const IconInfo = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5" /><path d="M12 8.2v.2" />
  </Svg>
);

export const IconSpinner = (p) => (
  <Svg {...p}>
    <path d="M12 3.5a8.5 8.5 0 108.5 8.5" />
  </Svg>
);

export const IconCircle = (p) => (
  <Svg {...p}><circle cx="12" cy="12" r="7" /></Svg>
);

export const IconDatabase = (p) => (
  <Svg {...p}>
    <ellipse cx="12" cy="6" rx="7.5" ry="3" />
    <path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6" />
    <path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" />
  </Svg>
);

export const IconFile = (p) => (
  <Svg {...p}>
    <path d="M13.5 3.5H7a1.5 1.5 0 00-1.5 1.5v14A1.5 1.5 0 007 20.5h10a1.5 1.5 0 001.5-1.5V8.5l-5-5z" />
    <path d="M13.5 3.5v5h5" />
  </Svg>
);

export const IconDownload = (p) => (
  <Svg {...p}>
    <path d="M12 4v10" /><path d="M8 10.5l4 4 4-4" /><path d="M5 19.5h14" />
  </Svg>
);

export const IconEraser = (p) => (
  <Svg {...p}>
    <path d="M8 18.5l-3.2-3.2a1.6 1.6 0 010-2.3l8-8a1.6 1.6 0 012.3 0l3.9 3.9a1.6 1.6 0 010 2.3l-7.3 7.3H8z" />
    <path d="M6.5 20.5h13" />
  </Svg>
);

export const IconRefresh = (p) => (
  <Svg {...p}>
    <path d="M20 12a8 8 0 10-2.6 5.9" />
    <path d="M20 5.5V12h-6" />
  </Svg>
);

export const IconList = (p) => (
  <Svg {...p}>
    <path d="M8.5 7h11M8.5 12h11M8.5 17h11" />
    <path d="M4.6 7v.2M4.6 12v.2M4.6 17v.2" />
  </Svg>
);

export const IconSun = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
  </Svg>
);

export const IconMoon = (p) => (
  <Svg {...p}>
    <path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z" />
  </Svg>
);

export const IconUser = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="8.5" r="3.8" />
    <path d="M4.8 20c.9-3.4 3.8-5.5 7.2-5.5s6.3 2.1 7.2 5.5" />
  </Svg>
);

export const IconBuilding = (p) => (
  <Svg {...p}>
    <path d="M5.5 20.5V5a1.5 1.5 0 011.5-1.5h6A1.5 1.5 0 0114.5 5v15.5" />
    <path d="M14.5 9.5H18A1.5 1.5 0 0119.5 11v9.5" />
    <path d="M3.5 20.5h17" />
    <path d="M8.5 7.5h3M8.5 11h3M8.5 14.5h3" />
  </Svg>
);
