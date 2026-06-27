const MAX_HISTORY_ENTRIES = 10;

const MYBOOKS_HOST_HISTORY_KEY = 'mybooks_host_history';
const MYBOOKS_USERNAME_HISTORY_KEY = 'mybooks_username_history';

const getHistory = (key: string): string[] => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
};

const addToHistory = (key: string, value: string): void => {
  if (!value) return;
  const next = [value, ...getHistory(key).filter((entry) => entry !== value)].slice(
    0,
    MAX_HISTORY_ENTRIES,
  );
  localStorage.setItem(key, JSON.stringify(next));
};

export const getMyBooksHostHistory = (): string[] => getHistory(MYBOOKS_HOST_HISTORY_KEY);
export const addMyBooksHostToHistory = (host: string): void =>
  addToHistory(MYBOOKS_HOST_HISTORY_KEY, host);

export const getMyBooksUsernameHistory = (): string[] => getHistory(MYBOOKS_USERNAME_HISTORY_KEY);
export const addMyBooksUsernameToHistory = (username: string): void =>
  addToHistory(MYBOOKS_USERNAME_HISTORY_KEY, username);
