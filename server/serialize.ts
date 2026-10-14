/** Databricks values → JSON-safe values (BigInt, Int64, Decimal, Date, Buffer, nested). */
export function toJsonSafe(v: any): any {
  if (v === null || v === undefined) return null;
  switch (typeof v) {
    case 'bigint':
      return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString();
    case 'number':
      return Number.isFinite(v) ? v : null;
    case 'string':
    case 'boolean':
      return v;
    case 'object':
      if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
      if (Buffer.isBuffer(v)) return v.toString('base64');
      if (Array.isArray(v)) return v.map(toJsonSafe);
      if (v instanceof Map) return Object.fromEntries([...v].map(([k, x]) => [String(k), toJsonSafe(x)]));
      if (typeof v.toNumber === 'function' && typeof v.buffer !== 'undefined') return v.toNumber(); // node-int64
      if (typeof v.toJSON === 'function') return toJsonSafe(v.toJSON());
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toJsonSafe(x)]));
    default:
      return String(v);
  }
}
