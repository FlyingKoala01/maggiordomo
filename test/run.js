// Unit tests for the pure, browser-independent logic. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';

// Minimal chrome stub so shared modules can be imported outside the browser.
globalThis.chrome = { runtime: { getURL: (p) => 'chrome-extension://test/' + p }, storage: { local: {}, onChanged: { addListener() {} } } };

const { codecs } = await import('../src/tools/encode.js');
const { md5, digest, toHex } = await import('../src/tools/hash.js');
const { decodeJwt, signHs, verifyJwt } = await import('../src/tools/jwt.js');
const { uuidV7, inspectUuid, randomString } = await import('../src/tools/uuid.js');
const { parseInput, isoWeek } = await import('../src/tools/timestamp.js');
const { findMatches } = await import('../src/tools/regex.js');
const { rgbToHsl, hslToRgb, contrast, toHex: colorHex } = await import('../src/tools/color.js');
const { transforms, lorem } = await import('../src/tools/text.js');
const { highlightJson, positionToLineCol, relativeTime } = await import('../src/shared/util.js');
const { normalizeUrl, cleanTags, filterLinks, sortLinks } = await import('../src/shared/links.js');

test('codecs round-trip unicode', () => {
  const samples = ['hello', 'héllo wörld ✓ 🚀', '<a href="x">&\'"</a>', ''];
  for (const [name, c] of Object.entries(codecs)) {
    for (const s of samples) assert.equal(c.decode(c.encode(s)), s, `${name}: ${s}`);
  }
  assert.equal(codecs.base64.encode('hello'), 'aGVsbG8=');
  assert.equal(codecs.base64url.encode('hello?>'), 'aGVsbG8_Pg');
  assert.equal(codecs.hex.encode('AB'), '4142');
  assert.equal(codecs.rot13.encode('Hello'), 'Uryyb');
  assert.equal(codecs.html.encode('<b>'), '&lt;b&gt;');
  assert.equal(codecs.html.decode('&amp;&eacute;'), '&é');
  assert.throws(() => codecs.hex.decode('zz'));
});

test('md5 matches node crypto', () => {
  const inputs = ['', 'a', 'abc', 'message digest', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'x'.repeat(1000), 'héllo 🚀'];
  for (const s of inputs) {
    const bytes = new TextEncoder().encode(s);
    assert.equal(toHex(md5(bytes)), createHash('md5').update(bytes).digest('hex'), JSON.stringify(s.slice(0, 20)));
  }
});

test('digest and hmac match node crypto', async () => {
  const msg = new TextEncoder().encode('the quick brown fox');
  const key = new TextEncoder().encode('secret');
  for (const [algo, nodeName] of [['MD5', 'md5'], ['SHA-1', 'sha1'], ['SHA-256', 'sha256'], ['SHA-512', 'sha512']]) {
    assert.equal(toHex(await digest(algo, msg)), createHash(nodeName).update(msg).digest('hex'), algo);
    assert.equal(toHex(await digest(algo, msg, key)), createHmac(nodeName, key).update(msg).digest('hex'), 'HMAC ' + algo);
  }
  const longKey = new Uint8Array(100).fill(7);
  assert.equal(toHex(await digest('MD5', msg, longKey)), createHmac('md5', longKey).update(msg).digest('hex'), 'HMAC MD5 long key');
});

test('jwt decode, sign and verify', async () => {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = { sub: '42', exp: 4102444800 };
  const token = await signHs(header, payload, 'top-secret');
  const decoded = decodeJwt(token);
  assert.deepEqual(decoded.header, header);
  assert.deepEqual(decoded.payload, payload);
  assert.equal(await verifyJwt(decoded, 'top-secret'), true);
  assert.equal(await verifyJwt(decoded, 'wrong'), false);
  assert.throws(() => decodeJwt('a.b'), /3 dot-separated/);
  // Known token from jwt.io
  const known = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
  assert.equal(await verifyJwt(decodeJwt(known), 'your-256-bit-secret'), true);
});

test('uuid v7 is ordered and inspectable', () => {
  const a = uuidV7(1700000000000);
  const b = uuidV7(1700000000001);
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.ok(a < b);
  const info = inspectUuid(a);
  assert.equal(info.version, 7);
  assert.equal(info.timestamp, 1700000000000);
  assert.equal(inspectUuid('nope'), null);
  assert.equal(inspectUuid('{123E4567-E89B-12D3-A456-426614174000}').version, 1);
  assert.equal(randomString(20, 'ab').length, 20);
  assert.match(randomString(50, 'xyz'), /^[xyz]{50}$/);
});

test('timestamp parsing', () => {
  assert.equal(parseInput('1700000000').getTime(), 1700000000000);
  assert.equal(parseInput('1700000000000').getTime(), 1700000000000);
  assert.equal(parseInput('1700000000000000').getTime(), 1700000000000);
  assert.equal(parseInput('2024-01-31T12:00:00Z').toISOString(), '2024-01-31T12:00:00.000Z');
  assert.equal(parseInput('garbage'), null);
  assert.deepEqual(isoWeek(new Date(2021, 0, 1)), { year: 2020, week: 53 });
  assert.deepEqual(isoWeek(new Date(2024, 11, 30)), { year: 2025, week: 1 });
});

test('regex matching handles zero-width and groups', () => {
  const m = findMatches(/(?<word>\w+)@/g, 'a@ bb@ ccc');
  assert.equal(m.length, 2);
  assert.equal(m[1].named.word, 'bb');
  assert.equal(findMatches(/x*/g, 'aaa').length, 4);
  assert.equal(findMatches(/a/, 'aaa').length, 3, 'enumerates all even without g');
});

test('color conversions', () => {
  const rgb = { r: 245, g: 200, b: 66 };
  const hsl = rgbToHsl(rgb);
  const back = hslToRgb(hsl);
  assert.deepEqual(back, rgb);
  assert.equal(colorHex(rgb), '#f5c842');
  assert.equal(contrast({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 }).toFixed(0), '21');
});

test('text transforms', () => {
  assert.equal(transforms.camel.fn('hello world_foo-bar'), 'helloWorldFooBar');
  assert.equal(transforms.snake.fn('HelloWorldFooBar'), 'hello_world_foo_bar');
  assert.equal(transforms.kebab.fn('XMLHttpRequest'), 'xml-http-request');
  assert.equal(transforms.constant.fn('someValue'), 'SOME_VALUE');
  assert.equal(transforms.unique.fn('a\nb\na'), 'a\nb');
  assert.equal(transforms.slug.fn('Héllo, Wörld!'), 'hello-world');
  assert.equal(lorem(2).split('\n\n').length, 2);
});

test('json highlight and error position', () => {
  const html = highlightJson('{"a": "b\\"c", "n": -1.5e3, "t": true, "z": null}');
  assert.ok(html.includes('<span class="tok-key">&quot;a&quot;</span>:'));
  assert.ok(html.includes('<span class="tok-str">&quot;b\\&quot;c&quot;</span>'));
  assert.ok(html.includes('<span class="tok-num">-1.5e3</span>'));
  assert.ok(html.includes('<span class="tok-bool">true</span>'));
  assert.ok(html.includes('<span class="tok-null">null</span>'));
  assert.deepEqual(positionToLineCol('{\n  "a": 1,\n  x', 14), { line: 3, col: 3 });
  assert.equal(typeof relativeTime(Date.now() - 3600e3), 'string');
});

test('links helpers', () => {
  assert.equal(normalizeUrl('example.com/x'), 'https://example.com/x');
  assert.equal(normalizeUrl('http://a.b'), 'http://a.b/');
  assert.equal(normalizeUrl('   '), null);
  assert.deepEqual(cleanTags('Dev, #Tools tools'), ['dev', 'tools']);
  const links = [
    { title: 'GitHub', url: 'https://github.com', tags: ['git', 'code'], createdAt: 1, pinned: false },
    { title: 'MDN', url: 'https://developer.mozilla.org', tags: ['docs'], createdAt: 2, pinned: true },
  ];
  assert.equal(filterLinks(links, '#git').length, 1);
  assert.equal(filterLinks(links, 'mozilla #docs').length, 1);
  assert.equal(filterLinks(links, '#nope').length, 0);
  assert.equal(sortLinks(links, 'title')[0].title, 'MDN', 'pinned first');
});
