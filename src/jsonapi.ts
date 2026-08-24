/**
 * JSON:API helpers.
 *
 * `flattenJsonApi` in @chrischall/mcp-utils merges `attributes` into the record
 * but does not resolve `included[]`, and the Client Portal leans on `include=`
 * for everything worth reading (an appointment without its clinician and office
 * is not useful). So relationship resolution lives here.
 */

export interface JsonApiResource {
  id?: string;
  type?: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: unknown }>;
  meta?: Record<string, unknown>;
}

export interface JsonApiDocument {
  data?: JsonApiResource | JsonApiResource[] | null;
  included?: JsonApiResource[];
  meta?: Record<string, unknown>;
  errors?: Array<{ title?: string; code?: string; status?: string; detail?: string }>;
}

/**
 * Parse a field the API sends as a JSON *string* rather than an object — the
 * client's `permissions` blob is one (`'{"messaging":true,…}'`). Returns null
 * rather than throwing: a portal that starts sending a real object, or none at
 * all, must not break the account tool.
 */
export function parseJsonString(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** `"true"`/`"false"` arrive as STRINGS on the wire — see `hasDocumentPdf`. */
export function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function flattenOne(resource: JsonApiResource): Record<string, unknown> {
  return { id: resource.id, type: resource.type, ...(resource.attributes ?? {}) };
}

function indexIncluded(included: JsonApiResource[]): Map<string, JsonApiResource> {
  const index = new Map<string, JsonApiResource>();
  for (const resource of included) {
    if (resource.type && resource.id) index.set(`${resource.type}:${resource.id}`, resource);
  }
  return index;
}

function resolveRef(ref: unknown, index: Map<string, JsonApiResource>): unknown {
  if (!ref || typeof ref !== 'object') return null;
  const { type, id } = ref as { type?: string; id?: string };
  if (!type || !id) return null;
  const hit = index.get(`${type}:${id}`);
  // A relationship whose record was not asked for via `include=` still tells us
  // the id — surfacing that beats dropping the field entirely.
  return hit ? flattenOne(hit) : { id, type };
}

/**
 * Flatten a JSON:API document into plain records, splicing each `include`d
 * relationship in beside the attributes under its relationship name.
 */
export function flattenDocument(doc: JsonApiDocument): {
  records: Array<Record<string, unknown>>;
  meta?: Record<string, unknown>;
} {
  const index = indexIncluded(doc.included ?? []);
  const list = Array.isArray(doc.data) ? doc.data : doc.data ? [doc.data] : [];
  const records = list.map((resource) => {
    const flat = flattenOne(resource);
    for (const [name, rel] of Object.entries(resource.relationships ?? {})) {
      const ref = rel?.data;
      if (ref === undefined) continue;
      flat[name] = Array.isArray(ref)
        ? ref.map((r) => resolveRef(r, index)).filter((r) => r !== null)
        : resolveRef(ref, index);
    }
    return flat;
  });
  return doc.meta ? { records, meta: doc.meta } : { records };
}

/** Render `.errors[]` into one line, for an McpToolError message. */
export function formatJsonApiErrors(doc: JsonApiDocument | null, status: number): string {
  const errors = doc?.errors;
  if (!errors?.length) return `SimplePractice returned HTTP ${status}`;
  return errors
    .map((e) => [e.title, e.detail].filter(Boolean).join(': ') || `HTTP ${e.status ?? status}`)
    .join('; ');
}
