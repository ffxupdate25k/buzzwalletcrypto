const wrap = (paths) => `<svg class="icon" viewBox="0 0 24 24">${paths}</svg>`;

export const icons = {
  profile: wrap('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>'),
  history: wrap('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  referral: wrap('<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.6 3-6 7-6s7 2.4 7 6"/><path d="M19 8v6M16 11h6"/>'),
  task: wrap('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12l3 3 5-6"/>'),
  withdrawal: wrap('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 21h16"/>'),
  admin: wrap('<path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>'),
  lock: wrap('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>')
};
