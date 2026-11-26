process.env.TZ = 'Europe/London';
import { describe, expect, it } from 'vitest';
import { describeServeAt, stageWhen } from './when.js';

describe('stageWhen', () => {
  it('groups a stage on the serving day as on the day', () => {
    expect(stageWhen('2026-11-29T13:00:00.000Z', 120).dayGroup).toBe('on the day');
  });
  it('groups a stage before midnight as the day before, even when the meal is just after midnight', () => {
    // serve 00:30, stage 3 hours earlier -> the previous calendar day
    expect(stageWhen('2026-11-29T00:30:00.000Z', 180).dayGroup).toBe('the day before');
  });
  it('counts whole days back beyond that', () => {
    expect(stageWhen('2026-11-29T13:00:00.000Z', 2880).dayGroup).toBe('two days before');
    expect(stageWhen('2026-11-29T13:00:00.000Z', 3 * 1440).dayGroup).toBe('3 days before');
  });
  it('gives the instant the stage happens', () => {
    expect(stageWhen('2026-11-29T13:00:00.000Z', 120).at).toBe('2026-11-29T11:00:00.000Z');
  });
  it('counts calendar days, not 24-hour blocks, across the clocks changing', () => {
    // Serve 13:00 GMT on Sunday 25 Oct 2026 (the clocks went back that morning). 25 real hours earlier is
    // 12:00 BST on Saturday: one calendar day, though more than 24 hours. (The spring case below is the one that
    // tells calendar days from 24-hour blocks; the midnight test above does the same for the UTC day.)
    expect(stageWhen('2026-10-25T13:00:00.000Z', 25 * 60).dayGroup).toBe('the day before');
  });
  it('uses the local day, not the UTC day, in summer', () => {
    // 00:30 BST on 29 June is 23:30Z on the 28th; the stage is 23:30 BST on the 28th. UTC would say "on the day".
    expect(stageWhen('2026-06-28T23:30:00.000Z', 60).dayGroup).toBe('the day before');
  });
  it('counts calendar days, not 24-hour blocks, when the clocks go forward', () => {
    // Serve 13:00 BST Sunday 29 March 2026; 23 hours earlier is 13:00 GMT on Saturday. A 24-hour block says "on the day".
    expect(stageWhen('2026-03-29T12:00:00.000Z', 23 * 60).dayGroup).toBe('the day before');
  });
  it('tolerates a stage that falls after serving', () => {
    expect(stageWhen('2026-11-29T13:00:00.000Z', -30).dayGroup).toBe('on the day');
  });
});

describe('describeServeAt', () => {
  it('renders the local time, not the UTC instant', () => {
    expect(describeServeAt('2026-11-29T13:00:00.000Z')).toBe('Sunday 29 November 2026, 13:00');
    expect(describeServeAt('2026-06-28T12:30:00.000Z')).toBe('Sunday 28 June 2026, 13:30');
  });
});
