#!/usr/bin/env node
/**
 * Generic Playwright mobile fetcher — real Chrome + device emulation.
 *
 * Usage:
 *   echo '{"url":"...", "device":"iPhone 13 Pro"}' | node playwright_mobile_chrome.js
 *
 * Device name must match playwright `devices[...]` keys (Pixel 7, iPhone 13 Pro,
 * iPad Pro 11, etc.). When in doubt, omit `device` — default is iPhone 13 Pro.
 *
 * NO-SITE-NAME RULE: same as playwright_real_chrome.js — no hostname branches.
 *
 * Dependencies (install once in engine/templates/ — node runs with cwd=engine/templates/,
 * so require('playwright') resolves from there; npm global prefix is NOT searched):
 *   cd engine/templates && npm install && npx playwright install chrome
 */

const dns = require('dns');
const net = require('net');

async function readStdinJson() {
  return await new Promise((resolve, reject) => {
    let data = '';
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch (e) { reject(e); }
    });
    process.stdin.on('error', reject);
  });
}

function describeError(error) {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

function warnBestEffort(action, error) {
  process.stderr.write(`best-effort ${action} failed: ${describeError(error)}\n`);
}

function isMissingTopLevelModule(error, moduleName) {
  return (
    error instanceof Error &&
    error.code === 'MODULE_NOT_FOUND' &&
    typeof error.message === 'string' &&
    error.message.includes(`Cannot find module '${moduleName}'`)
  );
}

function requireOptionalModule(moduleName) {
  let resolvedModule;
  try {
    resolvedModule = require.resolve(moduleName);
  } catch (e) {
    if (isMissingTopLevelModule(e, moduleName)) {
      warnBestEffort(`optional module ${moduleName}`, e);
      return null;
    }
    throw e;
  }
  return require(resolvedModule);
}

// --- SSRF guard --------------------------------------------------------------
// Refuse navigations / subresource requests whose target resolves to a
// non-routable or cloud-metadata address. Mirrors the curl path's host
// classification so an attacker-influenced redirect cannot steer this fallback
// at internal / 169.254.169.254 endpoints. Literal IPs are classified with no
// I/O; hostnames are resolved and every address classified; an unresolvable
// host is refused (fail closed).
const _BLOCKED_V4 = [
  ['0.0.0.0', 8],       // "this network"
  ['10.0.0.0', 8],      // RFC1918 private
  ['100.64.0.0', 10],   // CGNAT / shared
  ['127.0.0.0', 8],     // loopback
  ['169.254.0.0', 16],  // link-local incl. 169.254.169.254 metadata
  ['172.16.0.0', 12],   // RFC1918 private
  ['192.0.0.0', 24],    // IETF protocol assignments
  ['192.0.2.0', 24],    // TEST-NET-1
  ['192.168.0.0', 16],  // RFC1918 private
  ['198.18.0.0', 15],   // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24],  // TEST-NET-3
  ['224.0.0.0', 4],     // multicast
  ['240.0.0.0', 4],     // reserved + 255.255.255.255 broadcast
];

const _BLOCKED_V6 = [
  ['::1', 128],   // loopback
  ['::', 128],    // unspecified
  ['fc00::', 7],  // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8],  // multicast
];

function _ipv4ToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = (value << 8n) | BigInt(n);
  }
  return value;
}

function _ipv6ToBigInt(ip) {
  let s = ip;
  // Expand an embedded IPv4 tail (e.g. ::ffff:1.2.3.4) into two hextets.
  const v4 = s.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4) {
    const n = _ipv4ToInt(v4[1]);
    if (n === null) return null;
    s = s.slice(0, v4.index) + ((n >> 16n) & 0xffffn).toString(16) + ':' + (n & 0xffffn).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const groups = head.concat(Array(fill).fill('0'), tail);
  if (groups.length !== 8) return null;
  let value = 0n;
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    value = (value << 16n) | BigInt(parseInt(g, 16));
  }
  return value;
}

function _matchCidr(value, baseValue, bits, totalBits) {
  if (baseValue === null) return false;
  const full = (1n << BigInt(totalBits)) - 1n;
  const mask = bits === 0 ? 0n : ((full << BigInt(totalBits - bits)) & full);
  return (value & mask) === (baseValue & mask);
}

function classifyIp(ip) {
  if (net.isIPv4(ip)) {
    const intVal = _ipv4ToInt(ip);
    if (intVal === null) return true;
    return _BLOCKED_V4.some(([base, bits]) => _matchCidr(intVal, _ipv4ToInt(base), bits, 32));
  }
  if (net.isIPv6(ip)) {
    const big = _ipv6ToBigInt(ip);
    if (big === null) return true;
    if ((big >> 32n) === 0xffffn) {           // IPv4-mapped ::ffff:0:0/96
      const v4 = big & 0xffffffffn;
      return _BLOCKED_V4.some(([base, bits]) => _matchCidr(v4, _ipv4ToInt(base), bits, 32));
    }
    return _BLOCKED_V6.some(([base, bits]) => _matchCidr(big, _ipv6ToBigInt(base), bits, 128));
  }
  return true; // not a recognizable IP literal — refuse
}

async function isBlockedHost(host) {
  if (!host) return true;
  let h = host.toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1); // strip IPv6 brackets
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (net.isIP(h)) return classifyIp(h);
  let addrs;
  try {
    addrs = await dns.promises.lookup(h, { all: true });
  } catch (e) {
    return true; // unresolvable — refuse rather than follow into the unknown
  }
  return addrs.some((a) => classifyIp(a.address));
}

async function installSsrfGuard(context) {
  await context.route('**/*', async (route) => {
    let host = '';
    try {
      const target = new URL(route.request().url());
      if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        return route.continue();
      }
      host = target.hostname;
    } catch (e) {
      return route.continue(); // unparseable target — let the browser reject it
    }
    if (await isBlockedHost(host)) {
      process.stderr.write(`ssrf: blocked request to internal host ${host}\n`);
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
}

async function main() {
  const args = await readStdinJson();
  const url = args.url;
  if (!url) {
    process.stderr.write('missing url\n');
    process.exitCode = 2;
    return;
  }

  const profileDir = args.profileDir || '/tmp/.insane_pw_mobile_profile';
  const deviceName = args.device || 'iPhone 13 Pro';
  const waitSelector = args.waitSelector || null;
  const timeoutMs = args.timeout || 60000;
  const headless = args.headless ?? false;

  let chromium, devices;
  const playwrightExtra = requireOptionalModule('playwright-extra');
  const stealthPlugin = playwrightExtra ? requireOptionalModule('puppeteer-extra-plugin-stealth') : null;
  if (playwrightExtra && stealthPlugin) {
    ({ chromium, devices } = playwrightExtra);
    const stealth = stealthPlugin();
    chromium.use(stealth);
  } else {
    ({ chromium, devices } = require('playwright'));
  }

  const dev = devices[deviceName];
  if (!dev) {
    process.stderr.write(`unknown device: ${deviceName}\n`);
    process.exitCode = 2;
    return;
  }

  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(profileDir, {
      channel: 'chrome',
      headless,
      ...dev,
    });
    await installSsrfGuard(ctx);
    const page = await ctx.newPage();
    const navTimeout = Math.min(timeoutMs, 90000);
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navTimeout });

    if (waitSelector) {
      try {
        await page.waitForSelector(waitSelector, { timeout: Math.min(timeoutMs, 20000) });
      } catch (e) {
        warnBestEffort('waitSelector', e);
      }
    }

    const html = await page.content();
    const status = response ? response.status() : 0;
    process.stdout.write(JSON.stringify({ status, final_url: page.url(), html }));
    process.exitCode = 0;
    return;
  } catch (e) {
    process.stderr.write(`${describeError(e)}\n`);
    process.exitCode = 1;
    return;
  } finally {
    try {
      if (ctx) await ctx.close();
    } catch (e) {
      warnBestEffort('browser context close', e);
    }
  }
}

module.exports = { classifyIp, isBlockedHost, installSsrfGuard };

if (require.main === module) {
  main();
}
