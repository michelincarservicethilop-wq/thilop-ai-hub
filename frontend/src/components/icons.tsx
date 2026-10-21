import type { ReactNode } from 'react';

function Svg({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const IconOverview = () => (
  <Svg>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </Svg>
);
export const IconChat = () => (
  <Svg>
    <path d="M4 5h16v11H9l-5 4z" />
  </Svg>
);
export const IconInbox = () => (
  <Svg>
    <path d="M3 13l3-8h12l3 8v6H3z" />
    <path d="M3 13h5l1 3h6l1-3h5" />
  </Svg>
);
export const IconApps = () => (
  <Svg>
    <circle cx="7" cy="7" r="3" />
    <circle cx="17" cy="7" r="3" />
    <circle cx="7" cy="17" r="3" />
    <circle cx="17" cy="17" r="3" />
  </Svg>
);
export const IconStudio = () => (
  <Svg>
    <rect x="3" y="5" width="13" height="14" rx="2" />
    <path d="M16 10l5-3v10l-5-3z" />
  </Svg>
);
export const IconKey = () => (
  <Svg>
    <circle cx="8" cy="15" r="4" />
    <path d="M11 12l9-9M17 6l3 3" />
  </Svg>
);
export const IconAdmin = () => (
  <Svg>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </Svg>
);
export const IconDoc = () => (
  <Svg size={20}>
    <path d="M6 3h9l4 4v14H6z" />
    <path d="M9 12h7M9 16h5" />
  </Svg>
);
export const IconSearchDoc = () => (
  <Svg size={20}>
    <path d="M6 3h9l4 4v6" />
    <path d="M6 3v18h6" />
    <circle cx="16.5" cy="17.5" r="3" />
    <path d="M18.8 19.8L21 22" />
  </Svg>
);
export const IconReceipt = () => (
  <Svg size={20}>
    <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
    <path d="M9 8h6M9 12h6M9 16h3" />
  </Svg>
);
export const IconQuote = () => (
  <Svg size={20}>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3" />
    <path d="M12 4v5M12 15v5M4 12h5M15 12h5" />
  </Svg>
);
export const IconMic = () => (
  <Svg size={20}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </Svg>
);
export const IconChart = () => (
  <Svg size={20}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </Svg>
);
export const IconPlus = () => (
  <Svg size={16}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const IconTrash = () => (
  <Svg size={16}>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
  </Svg>
);
export const IconImage = () => (
  <Svg size={18}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="2" />
    <path d="M21 16l-5-5-8 9" />
  </Svg>
);
export const IconClose = () => (
  <Svg size={16}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);
export const IconBack = () => (
  <Svg size={16}>
    <path d="M15 6l-6 6 6 6" />
  </Svg>
);
