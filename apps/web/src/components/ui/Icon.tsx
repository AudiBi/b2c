import type { SVGProps } from 'react';

const paths = {
  plane: 'M2 16.5l9-3.5V6a2 2 0 114 0v7l7 3.5v2l-7-1.5v3l2.5 1.5V22L12 21l-5.5 1v-1.5L9 19v-3l-7 1.5z',
  ship: 'M3 17l2 4h14l2-4M5 17l-1-6 8-3 8 3-1 6M12 8V3h4M7 13h10',
  globe: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  truck: 'M2 6h11v10H2zM13 9h4l3 3v4h-7M6 18.5a1.5 1.5 0 100-.01M17 18.5a1.5 1.5 0 100-.01',
  box: 'M12 2l9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10',
  shield: 'M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5zM8.5 12l2.5 2.5L16 9.5',
  pin: 'M12 22s7-6.5 7-12a7 7 0 10-14 0c0 5.5 7 12 7 12zM12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  clock: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2',
  mail: 'M3 5h18v14H3zM3 6l9 7 9-7',
  phone: 'M5 3h4l2 5-2.5 1.5a11 11 0 006 6L16 13l5 2v4a2 2 0 01-2 2A16 16 0 013 5a2 2 0 012-2z',
  receipt: 'M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h4',
  route: 'M6 19a2 2 0 100-4 2 2 0 000 4zM18 9a2 2 0 100-4 2 2 0 000 4zM8 17h6a4 4 0 004-4V9',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
      <path d={paths[name]} />
    </svg>
  );
}
