#!/usr/bin/env node
// Lists cookies stored in a macOS/WebKit `.binarycookies` file (the format
// used by WKWebView on macOS/iOS, e.g. `~/Library/HTTPStorages/*.binarycookies`
// and Safari's own `Cookies.binarycookies`).
//
// This is NOT SQLite and NOT a plain plist — it's Apple's own binary cookie
// format (magic bytes `cook`), so neither `sqlite3` nor `plutil` can read it.
// See https://github.com/interstateone/BinaryCookieReader for the reference
// this parser follows.
//
// Usage:
//   node tools/read-nas-cookies.mjs [path-to-.binarycookies]
//
// Defaults to `~/Library/HTTPStorages/MyReader.binarycookies` (the app's
// display name — see `productName` in `src-tauri/tauri.conf.json`) when no
// path is given.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MAC_EPOCH_OFFSET_SECONDS = 978307200; // 2001-01-01T00:00:00Z, as Unix seconds

const FLAG_LABELS = [
  [0x1, 'Secure'],
  [0x4, 'HttpOnly'],
];

const flagsToLabel = (flags) => {
  const labels = FLAG_LABELS.filter(([bit]) => flags & bit).map(([, label]) => label);
  return labels.length ? labels.join('|') : '-';
};

const macEpochToISOString = (seconds) => {
  if (!Number.isFinite(seconds) || seconds === 0) return '-';
  return new Date((seconds + MAC_EPOCH_OFFSET_SECONDS) * 1000).toISOString();
};

const readCString = (buf, offset) => {
  const end = buf.indexOf(0, offset);
  return buf.toString('utf8', offset, end === -1 ? buf.length : end);
};

const parseCookie = (page, recordOffset) => {
  const size = page.readUInt32LE(recordOffset);
  const flags = page.readUInt32LE(recordOffset + 8);
  const urlOffset = page.readUInt32LE(recordOffset + 16);
  const nameOffset = page.readUInt32LE(recordOffset + 20);
  const pathOffset = page.readUInt32LE(recordOffset + 24);
  const valueOffset = page.readUInt32LE(recordOffset + 28);
  const expires = page.readDoubleLE(recordOffset + 40);
  const created = page.readDoubleLE(recordOffset + 48);

  return {
    domain: readCString(page, recordOffset + urlOffset),
    name: readCString(page, recordOffset + nameOffset),
    path: readCString(page, recordOffset + pathOffset),
    value: readCString(page, recordOffset + valueOffset),
    flags: flagsToLabel(flags),
    created: macEpochToISOString(created),
    expires: macEpochToISOString(expires),
    size,
  };
};

const parsePage = (page) => {
  const cookieCount = page.readUInt32LE(4);
  const offsets = [];
  for (let i = 0; i < cookieCount; i++) {
    offsets.push(page.readUInt32LE(8 + i * 4));
  }
  return offsets.map((offset) => parseCookie(page, offset));
};

export const parseBinaryCookies = (buf) => {
  if (buf.length < 8 || buf.toString('ascii', 0, 4) !== 'cook') {
    throw new Error('Not a .binarycookies file (missing "cook" magic header)');
  }
  const pageCount = buf.readUInt32BE(4);
  const pageSizes = [];
  let offset = 8;
  for (let i = 0; i < pageCount; i++) {
    pageSizes.push(buf.readUInt32BE(offset));
    offset += 4;
  }

  const cookies = [];
  for (const pageSize of pageSizes) {
    const page = buf.subarray(offset, offset + pageSize);
    cookies.push(...parsePage(page));
    offset += pageSize;
  }
  return cookies;
};

const formatTable = (cookies) => {
  if (cookies.length === 0) return '(no cookies found)';
  const rows = cookies.map((c) => ({
    Domain: c.domain,
    Name: c.name,
    Value: c.value.length > 40 ? `${c.value.slice(0, 37)}...` : c.value,
    Path: c.path,
    Flags: c.flags,
    Created: c.created,
    Expires: c.expires,
  }));
  return rows;
};

const main = () => {
  const defaultPath = join(homedir(), 'Library', 'HTTPStorages', 'MyReader.binarycookies');
  const path = process.argv[2] ?? defaultPath;

  let buf;
  try {
    buf = readFileSync(path);
  } catch (e) {
    console.error(`Failed to read "${path}": ${e.message}`);
    process.exit(1);
  }

  let cookies;
  try {
    cookies = parseBinaryCookies(buf);
  } catch (e) {
    console.error(`Failed to parse "${path}": ${e.message}`);
    process.exit(1);
  }

  console.log(`${path} — ${cookies.length} cookie(s)\n`);
  console.table(formatTable(cookies));
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
