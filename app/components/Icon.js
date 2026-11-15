const paths = {
  globe: <><circle cx="12" cy="12" r="8.6" /><ellipse cx="12" cy="12" rx="3.7" ry="8.6" /><path d="M4 9h16M4 15h16" /></>,
  left: <path d="m13 6-6 6 6 6m-6-6h13" />,
  right: <path d="m11 6 6 6-6 6m6-6H4" />,
  upRight: <path d="M7 17 17 7M8 7h9v9" />,
  replay: <><path d="M7 7a7.1 7.1 0 1 1-1.4 8.4M7 3v5H2" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  focus: <><path d="M8 4H4v4m12-4h4v4m0 8v4h-4m-8 0H4v-4" /><circle cx="12" cy="12" r="2" /></>,
  pin: <><path d="M19 10c0 5-7 10-7 10S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2.3" /></>,
  down: <path d="m6 9 6 6 6-6" />,
  temp: <><path d="M9 14V6a3 3 0 0 1 6 0v8a5 5 0 1 1-6 0Z" /><path d="M12 10v7" /><circle cx="12" cy="17" r=".9" /></>,
  sun: <><circle cx="12" cy="12" r="3.9" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2m0-14-2 2M7 17l-2 2" /></>,
};

export function Icon({ name }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
