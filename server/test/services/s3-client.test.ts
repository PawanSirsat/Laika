import { describe, expect, it } from 'vitest';
import {
  amzDate,
  canonicalRequest,
  EMPTY_SHA256,
  presignQuery,
  signedHeaders,
  storeClient,
  StoreUnavailableError,
  stringToSign,
  uriEncode,
  UNSIGNED_PAYLOAD,
} from '../../src/services/s3-client.ts';
import { browserPut, FAKE_STORE, fakeS3 } from '../helpers/fake-s3.ts';

/**
 * The SigV4 signer and the store client (D-150, LAI-1300).
 *
 * **The signer is held to AWS's own published examples, byte for byte.**
 * Every expected value below was copied from the AWS pages on 2026-11-17 —
 * *Authenticating Requests: Using Query Parameters (AWS Signature Version 4)*
 * and *Signature Calculations for the Authorization Header: Transferring
 * Payload in a Single Chunk* (Amazon S3 Developer Guide) — never computed by
 * this code and pasted back. A signer that agreed only with itself would pass
 * every fake-store test in this repository and fail against a real store.
 *
 * The examples are virtual-host style (`examplebucket.s3.amazonaws.com`,
 * path `/test.txt`), which is why the signer takes host and path as inputs.
 */

/** AWS's example credentials, from the pages above. Not real. */
const AWS_EXAMPLE = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
};
const HOST = 'examplebucket.s3.amazonaws.com';
/** Fri, 24 May 2013 00:00:00 GMT. */
const MAY_24_2013 = Date.UTC(2013, 4, 24, 0, 0, 0);

describe('AWS’s published SigV4 examples', () => {
  it('the presigned GET: test.txt for 86400 s', () => {
    const query = presignQuery(AWS_EXAMPLE, {
      method: 'GET',
      host: HOST,
      path: '/test.txt',
      now: MAY_24_2013,
      expiresSeconds: 86_400,
    });

    // The page's own resulting URL, character for character.
    expect(`https://${HOST}/test.txt?${query}`).toBe(
      'https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
  });

  it('the presigned GET’s canonical request and string to sign, as the page prints them', () => {
    const request = canonicalRequest({
      method: 'GET',
      path: '/test.txt',
      query: [
        ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
        ['X-Amz-Credential', 'AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request'],
        ['X-Amz-Date', '20130524T000000Z'],
        ['X-Amz-Expires', '86400'],
        ['X-Amz-SignedHeaders', 'host'],
      ],
      headers: { host: HOST },
      payloadHash: UNSIGNED_PAYLOAD,
    });
    expect(request).toBe(
      [
        'GET',
        '/test.txt',
        'X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host',
        'host:examplebucket.s3.amazonaws.com',
        '',
        'host',
        'UNSIGNED-PAYLOAD',
      ].join('\n'),
    );
    expect(stringToSign('20130524T000000Z', 'us-east-1', request)).toBe(
      [
        'AWS4-HMAC-SHA256',
        '20130524T000000Z',
        '20130524/us-east-1/s3/aws4_request',
        '3bfa292879f6447bbcda7001decf97f4a54dc650c8942174ae0a9121cf58ad04',
      ].join('\n'),
    );
  });

  it('the header-signed GET Object: the first 10 bytes of test.txt', () => {
    const headers = signedHeaders(AWS_EXAMPLE, {
      method: 'GET',
      host: HOST,
      path: '/test.txt',
      headers: { range: 'bytes=0-9' },
      payloadHash: EMPTY_SHA256,
      now: MAY_24_2013,
    });

    expect(EMPTY_SHA256).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(headers).toEqual({
      range: 'bytes=0-9',
      'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      'x-amz-date': '20130524T000000Z',
      authorization:
        'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    });
  });

  it('the header-signed PUT Object: a `$` in the key is encoded in the canonical path', () => {
    const headers = signedHeaders(AWS_EXAMPLE, {
      method: 'PUT',
      host: HOST,
      path: '/test$file.text',
      headers: {
        date: 'Fri, 24 May 2013 00:00:00 GMT',
        'x-amz-storage-class': 'REDUCED_REDUNDANCY',
      },
      payloadHash: '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072',
      now: MAY_24_2013,
    });

    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class,Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd',
    );
  });

  it('the header-signed GET Bucket: a query string, sorted and encoded', () => {
    const headers = signedHeaders(AWS_EXAMPLE, {
      method: 'GET',
      host: HOST,
      path: '/',
      // Given out of order: the canonical form sorts them.
      query: [
        ['prefix', 'J'],
        ['max-keys', '2'],
      ],
      payloadHash: EMPTY_SHA256,
      now: MAY_24_2013,
    });

    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,SignedHeaders=host;x-amz-content-sha256;x-amz-date,Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7',
    );
  });
});

describe('the pieces', () => {
  it('encodes as SigV4 does, not as encodeURIComponent does', () => {
    expect(uriEncode("a b!'()*~._-/é")).toBe('a%20b%21%27%28%29%2A~._-%2F%C3%A9');
    expect(uriEncode('/p/01ABC/x y', true)).toBe('/p/01ABC/x%20y');
  });

  it('dates in ISO 8601 basic form, UTC', () => {
    expect(amzDate(Date.UTC(2026, 10, 17, 9, 5, 7, 999))).toBe('20261117T090507Z');
  });
});

describe('the client, against the fake store', () => {
  const NOW = Date.UTC(2026, 10, 17, 9, 0, 0);
  const KEY = 'p/01PROJECT0000000000000000/01FILE00000000000000000000';

  function client(fake = fakeS3()) {
    return {
      fake,
      store: storeClient({ store: FAKE_STORE, fetchImpl: fake.fetchImpl, now: () => NOW }),
    };
  }

  it('presigns a PUT path-style, signing type, disposition and length, for ten minutes', () => {
    const { store } = client();
    const put = store.presignPut(
      KEY,
      { contentType: 'image/png', contentLength: 4, contentDisposition: 'attachment' },
      NOW,
    );
    const url = new URL(put.url);

    expect(url.origin + url.pathname).toBe(`https://files.example.test/laika-attachments/${KEY}`);
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe(
      'content-disposition;content-length;content-type;host',
    );
    expect(url.searchParams.get('X-Amz-Expires')).toBe('600');
    expect(put).toMatchObject({
      method: 'PUT',
      headers: { 'content-type': 'image/png', 'content-disposition': 'attachment' },
      expiresAt: NOW + 600_000,
    });
  });

  it('is refused by the store for a different length or type, and accepted exactly', async () => {
    const { fake, store } = client();
    const put = store.presignPut(
      KEY,
      { contentType: 'image/png', contentLength: 4, contentDisposition: 'attachment' },
      NOW,
    );

    expect((await browserPut(fake, put, 'abcde')).status).toBe(403);
    expect((await browserPut(fake, put, 'abcd', { 'content-type': 'text/html' })).status).toBe(403);
    expect(fake.objects.size).toBe(0);
    expect((await browserPut(fake, put, 'abcd')).status).toBe(200);
    expect(await store.head(KEY)).toEqual({ size: 4 });
  });

  it('presigns a GET for five minutes with the response overrides signed', () => {
    const { store } = client();
    const get = store.presignGet(
      KEY,
      { contentType: 'application/octet-stream', contentDisposition: 'attachment' },
      NOW,
    );
    const url = new URL(get.url);

    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('response-content-type')).toBe('application/octet-stream');
    expect(url.searchParams.get('response-content-disposition')).toBe('attachment');
    expect(get.expiresAt).toBe(NOW + 300_000);
  });

  it('heads, reads a range and removes, header-signed', async () => {
    const { fake, store } = client();
    fake.objects.set(KEY, {
      body: new TextEncoder().encode('0123456789abcdefXYZ'),
      contentType: 'image/png',
      contentDisposition: 'attachment',
    });

    expect(await store.head(KEY)).toEqual({ size: 19 });
    expect(new TextDecoder().decode(await store.readRange(KEY, 0, 15))).toBe('0123456789abcdef');
    expect(fake.of('GET')[0]?.headers.get('range')).toBe('bytes=0-15');
    await store.remove(KEY);
    expect(await store.head(KEY)).toBeNull();
    // Removing what is gone is not an error.
    await store.remove(KEY);
  });

  it('reads no further than asked when a store ignores the range', async () => {
    const { fake, store } = client();
    fake.intercept = (req) =>
      req.method === 'GET'
        ? new Response('0123456789abcdefTHE-REST-OF-IT', { status: 200 })
        : undefined;

    expect(new TextDecoder().decode(await store.readRange(KEY, 0, 15))).toBe('0123456789abcdef');
  });

  it('never carries the store’s words in an error', async () => {
    const { fake, store } = client();
    fake.intercept = () =>
      new Response('<Error><Message>STORE-SECRET-WORDS</Message></Error>', { status: 500 });

    for (const call of [
      () => store.head(KEY),
      () => store.readRange(KEY, 0, 15),
      () => store.remove(KEY),
    ]) {
      const err = await call().then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(StoreUnavailableError);
      expect((err as StoreUnavailableError).code).toBe('unavailable');
      expect((err as StoreUnavailableError).details).toMatchObject({ reason: 'store_unreachable' });
      expect(JSON.stringify((err as StoreUnavailableError).toBody())).not.toContain('STORE-SECRET');
    }
  });

  it('gives up on a hung store after its timeout', async () => {
    const fake = fakeS3();
    fake.intercept = () => 'hang';
    const store = storeClient({ store: FAKE_STORE, fetchImpl: fake.fetchImpl, timeoutMs: 20 });

    const err = await store.head(KEY).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(StoreUnavailableError);
    expect((err as StoreUnavailableError).details).toMatchObject({ why: 'timed out' });
  });

  it('is refused by the store when signed with another secret — the fake checks', async () => {
    const fake = fakeS3();
    const wrong = storeClient({
      store: { ...FAKE_STORE, secretAccessKey: 'another-fixture-secret' },
      fetchImpl: fake.fetchImpl,
      now: () => NOW,
    });

    const err = await wrong.head(KEY).then(
      () => null,
      (e: unknown) => e,
    );
    expect((err as StoreUnavailableError).details).toMatchObject({ why: 'HEAD answered 403' });
  });
});
