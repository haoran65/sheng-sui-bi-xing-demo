(function (root) {
  'use strict';

  const MAGIC = 'SONATA-ALBUM/1';
  const END = 'END-SONATA-ALBUM';
  const MAX_FILE_BYTES = 5 * 1024 * 1024;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true });

  function bytesToBase64Url(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function base64UrlToBytes(value) {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('专辑负载不是有效的 Base64URL 编码');
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  async function sha256Hex(bytes) {
    if (!root.crypto?.subtle) throw new Error('当前环境不支持 SHA-256 内容校验');
    const digest = await root.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function validatePayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('专辑内容不是有效对象');
    if (payload.schemaVersion !== 'sonata-album/1.0') throw new Error('暂不支持这个专辑版本');
    if (typeof payload.title !== 'string' || typeof payload.text !== 'string') throw new Error('专辑缺少标题或正文');
    if (payload.title.length > 200 || payload.text.length > 2_000_000) throw new Error('专辑文字超过可导入上限');
    if (typeof payload.trackId !== 'string' || payload.trackId.length > 200) throw new Error('专辑曲目标识无效');
    const trace = payload.performance?.trace;
    if (!Array.isArray(trace) || trace.length > 20_000) throw new Error('专辑演绎轨迹无效或过长');
    const traceFormat = payload.performance?.format || 'conductor-trace/1';
    if (!['conductor-trace/1', 'conductor-trace/2'].includes(traceFormat)) {
      throw new Error('暂不支持这个指挥轨迹版本');
    }
    for (const frame of trace) {
      if (!frame || typeof frame !== 'object' || !Number.isFinite(Number(frame.at))
        || !Number.isFinite(Number(frame.energy ?? frame.charge))) throw new Error('专辑包含无效的演绎帧');
    }
    if (payload.performance.transport !== undefined) {
      const events = payload.performance.transport;
      if (!Array.isArray(events) || events.length > 20000) throw new Error('播放轨迹无效或过长');
      let previous = -1;
      for (const event of events) {
        if (!event || !['play', 'pause', 'seek'].includes(event.action)
          || !Number.isFinite(event.at) || event.at < previous || event.at < 0
          || !Number.isFinite(event.seconds) || event.seconds < 0 || typeof event.playing !== 'boolean') {
          throw new Error('专辑包含无效的播放位置');
        }
        previous = event.at;
      }
    }
    return payload;
  }

  function formatFingerprint(hex, groups = 6) {
    const compact = String(hex || '').replace(/[^a-f0-9]/gi, '').toUpperCase();
    return (compact.match(/.{1,4}/g) || []).slice(0, groups).join('-');
  }

  async function encode(payload) {
    validatePayload(payload);
    const json = JSON.stringify(payload);
    const bytes = encoder.encode(json);
    if (bytes.byteLength > MAX_FILE_BYTES) throw new Error('专辑内容超过 5 MB，无法导出');
    const fingerprint = await sha256Hex(bytes);
    const encoded = bytesToBase64Url(bytes);
    const text = [
      MAGIC,
      'ENCODING: base64url+utf8+json',
      `FINGERPRINT: sha256:${fingerprint}`,
      'PAYLOAD:',
      encoded,
      END,
      '',
    ].join('\n');
    return { text, fingerprint, shortFingerprint: formatFingerprint(fingerprint) };
  }

  async function decode(text) {
    const source = String(text || '').replace(/^\uFEFF/, '').trim();
    if (encoder.encode(source).byteLength > MAX_FILE_BYTES) throw new Error('文件超过 5 MB 导入上限');
    const lines = source.split(/\r?\n/);
    if (lines[0]?.trim() !== MAGIC) throw new Error('这不是声随笔行数字专辑');
    const fingerprintLine = lines.find((line) => line.startsWith('FINGERPRINT:')) || '';
    const expected = fingerprintLine.replace(/^FINGERPRINT:\s*sha256:/i, '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error('专辑缺少完整的 SHA-256 指纹');
    const payloadIndex = lines.findIndex((line) => line.trim() === 'PAYLOAD:');
    const endIndex = lines.findIndex((line, index) => index > payloadIndex && line.trim() === END);
    if (payloadIndex < 0 || endIndex <= payloadIndex + 1) throw new Error('专辑负载不完整');
    const encoded = lines.slice(payloadIndex + 1, endIndex).join('').trim();
    const bytes = base64UrlToBytes(encoded);
    const actual = await sha256Hex(bytes);
    if (actual !== expected) throw new Error('数字指纹不匹配，文件可能已被修改或损坏');
    let payload;
    try { payload = JSON.parse(decoder.decode(bytes)); } catch { throw new Error('专辑正文无法解码'); }
    validatePayload(payload);
    return { payload, fingerprint: actual, shortFingerprint: formatFingerprint(actual) };
  }

  root.SonataAlbumCodec = Object.freeze({
    MAGIC, MAX_FILE_BYTES, encode, decode, validatePayload, formatFingerprint,
  });
})(globalThis);
