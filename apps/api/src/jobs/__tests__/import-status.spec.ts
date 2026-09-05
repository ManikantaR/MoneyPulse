/**
 * Import Pipeline Radar Phase 1 / BS-7: a parse that completes with 0 rows
 * imported previously always reported 'completed', indistinguishable from a
 * healthy import (e.g. every row was a duplicate, or a real parse failure
 * that happened to leave 0 new rows). These tests cover the status decision
 * used by both the CSV/Excel and PDF completion paths in IngestionProcessor.
 */
import { describe, it, expect } from 'vitest';
import { IngestionProcessor } from '../ingestion.processor';

describe('IngestionProcessor.determineImportStatus', () => {
  const processor = Object.create(IngestionProcessor.prototype) as any;

  it('returns "completed" when rows were imported, regardless of errors', () => {
    expect(processor.determineImportStatus(5, 0)).toBe('completed');
    expect(processor.determineImportStatus(5, 2)).toBe('completed');
  });

  it('returns "failed" when nothing was imported and there were row errors', () => {
    expect(processor.determineImportStatus(0, 3)).toBe('failed');
  });

  it('returns "empty" when nothing was imported and there were no errors (e.g. all duplicates)', () => {
    expect(processor.determineImportStatus(0, 0)).toBe('empty');
  });
});
