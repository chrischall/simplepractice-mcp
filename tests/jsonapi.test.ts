import { describe, expect, it } from 'vitest';
import {
  asBoolean,
  flattenDocument,
  formatJsonApiErrors,
  parseJsonString,
} from '../src/jsonapi.js';

describe('asBoolean', () => {
  // The portal sends hasDocumentPdf as the STRING "true"/"false". A plain
  // truthiness test reports every row as having a PDF — verified live, where
  // the naive filter matched 10 of 10 rows and the correct one matched 5.
  it('reads the stringly-typed booleans the portal actually sends', () => {
    expect(asBoolean('true')).toBe(true);
    expect(asBoolean('false')).toBe(false);
  });

  it('passes real booleans through', () => {
    expect(asBoolean(true)).toBe(true);
    expect(asBoolean(false)).toBe(false);
  });

  it('is undefined for anything else, rather than guessing', () => {
    expect(asBoolean(undefined)).toBeUndefined();
    expect(asBoolean(null)).toBeUndefined();
    expect(asBoolean('yes')).toBeUndefined();
    expect(asBoolean(1)).toBeUndefined();
  });

  it('does not treat the string "false" as truthy', () => {
    // The whole point: this is the assertion that fails on the naive version.
    expect(asBoolean('false')).not.toBeTruthy();
  });
});

describe('flattenDocument', () => {
  it('merges attributes up and keeps id and type', () => {
    const { records } = flattenDocument({
      data: [{ id: '1', type: 'appointments', attributes: { startTime: 'T', fee: '10' } }],
    });
    expect(records).toEqual([{ id: '1', type: 'appointments', startTime: 'T', fee: '10' }]);
  });

  it('wraps a singular resource into a one-record list', () => {
    const { records } = flattenDocument({
      data: { id: 'production', type: 'environments', attributes: {} },
    });
    expect(records).toEqual([{ id: 'production', type: 'environments' }]);
  });

  it('returns an empty list for a null or absent data member', () => {
    expect(flattenDocument({ data: null }).records).toEqual([]);
    expect(flattenDocument({}).records).toEqual([]);
  });

  it('splices an included relationship in beside the attributes', () => {
    const { records } = flattenDocument({
      data: [
        {
          id: '5',
          type: 'appointments',
          attributes: { startTime: 'T' },
          relationships: { clinician: { data: { id: '3', type: 'clinicians' } } },
        },
      ],
      included: [{ id: '3', type: 'clinicians', attributes: { firstName: 'Dana' } }],
    });
    expect(records[0].clinician).toEqual({ id: '3', type: 'clinicians', firstName: 'Dana' });
  });

  it('resolves a to-many relationship into a list', () => {
    const { records } = flattenDocument({
      data: {
        id: 'production',
        type: 'environments',
        relationships: { currentClientOptions: { data: [{ id: '9', type: 'clients' }] } },
      },
      included: [{ id: '9', type: 'clients', attributes: { firstName: 'Sam' } }],
    });
    // Always a list — one login can cover several clients.
    expect(records[0].currentClientOptions).toEqual([
      { id: '9', type: 'clients', firstName: 'Sam' },
    ]);
  });

  it('keeps the id of a relationship that was not included', () => {
    const { records } = flattenDocument({
      data: [{ id: '5', type: 'appointments', relationships: { office: { data: { id: '7', type: 'offices' } } } }],
    });
    // Better than dropping the field: the caller can still fetch it.
    expect(records[0].office).toEqual({ id: '7', type: 'offices' });
  });

  it('represents an empty to-one relationship as null', () => {
    const { records } = flattenDocument({
      data: [{ id: '5', type: 'appointments', relationships: { card: { data: null } } }],
    });
    expect(records[0].card).toBeNull();
  });

  it('skips a relationship with no data member at all', () => {
    const { records } = flattenDocument({
      data: [{ id: '5', type: 'appointments', relationships: { card: {} } }],
    });
    expect(records[0]).not.toHaveProperty('card');
  });

  it('drops unresolvable entries out of a to-many list', () => {
    const { records } = flattenDocument({
      data: [{ id: '5', type: 'x', relationships: { things: { data: [{ type: 'y' }] } } }],
    });
    expect(records[0].things).toEqual([]);
  });

  it('ignores included resources missing an id or type', () => {
    const { records } = flattenDocument({
      data: [{ id: '5', type: 'x', relationships: { thing: { data: { id: '1', type: 'y' } } } }],
      included: [{ type: 'y', attributes: { a: 1 } }],
    });
    expect(records[0].thing).toEqual({ id: '1', type: 'y' });
  });

  it('passes the document meta through when present', () => {
    expect(flattenDocument({ data: [], meta: { endBalance: '150.0' } }).meta).toEqual({
      endBalance: '150.0',
    });
    expect(flattenDocument({ data: [] }).meta).toBeUndefined();
  });
});

describe('formatJsonApiErrors', () => {
  it('renders title and detail together', () => {
    expect(
      formatJsonApiErrors({ errors: [{ title: 'Nope', detail: 'because', status: '422' }] }, 422)
    ).toBe('Nope: because');
  });

  it('joins several errors', () => {
    expect(formatJsonApiErrors({ errors: [{ title: 'A' }, { title: 'B' }] }, 400)).toBe('A; B');
  });

  it('falls back to the status when an error carries no text', () => {
    expect(formatJsonApiErrors({ errors: [{ status: '500' }] }, 500)).toBe('HTTP 500');
    expect(formatJsonApiErrors({ errors: [{}] }, 500)).toBe('HTTP 500');
  });

  it('describes a bare status when the body had no errors at all', () => {
    expect(formatJsonApiErrors(null, 503)).toBe('SimplePractice returned HTTP 503');
    expect(formatJsonApiErrors({ errors: [] }, 503)).toBe('SimplePractice returned HTTP 503');
  });
});

describe('parseJsonString', () => {
  // The client's `permissions` blob arrives as a JSON string, and it decides
  // which portal features the client actually has.
  it('parses the permissions blob the portal actually sends', () => {
    expect(
      parseJsonString(
        '{"messaging":true,"selfScheduling":true,"billingDocuments":true,"payments":true,"appointments":true}'
      )
    ).toEqual({
      messaging: true,
      selfScheduling: true,
      billingDocuments: true,
      payments: true,
      appointments: true,
    });
  });

  it('passes a real object through, in case the API starts sending one', () => {
    expect(parseJsonString({ messaging: true })).toEqual({ messaging: true });
  });

  it('returns null instead of throwing on unparseable or absent input', () => {
    expect(parseJsonString('not json')).toBeNull();
    expect(parseJsonString(undefined)).toBeNull();
    expect(parseJsonString(null)).toBeNull();
    expect(parseJsonString(42)).toBeNull();
  });

  it('returns null for JSON that is valid but not an object', () => {
    expect(parseJsonString('"a string"')).toBeNull();
    expect(parseJsonString('null')).toBeNull();
  });
});
