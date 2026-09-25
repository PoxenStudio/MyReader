/** Builds `<base>/api/v1/query?word=` for a MyDict server (client + API route). */
export const buildMyDictQueryUrl = (baseUrl: string, word: string): string => {
  let base = baseUrl.trim().replace(/\/+$/, '');
  if (!/\/api\/v1\/query$/.test(base)) base += '/api/v1/query';
  const url = new URL(base);
  url.searchParams.set('word', word);
  return url.toString();
};
