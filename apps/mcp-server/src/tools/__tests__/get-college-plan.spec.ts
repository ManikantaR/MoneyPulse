import { describe, it, expect } from 'vitest';
import { registerGetCollegePlan } from '../get-college-plan.js';

function makeServer() {
  let handler: (params: any) => Promise<any>;
  const server = {
    tool: (_name: string, _desc: string, _schema: any, fn: any) => {
      handler = fn;
    },
  } as any;
  registerGetCollegePlan(server);
  return (params: any) => handler(params);
}

describe('get_college_plan', () => {
  it('matches the api college-planner service fixture: $30k/year, 10y out, 4y program, $20k saved, 5%/6%, $500/mo income capacity', async () => {
    const call = makeServer();
    const result = await call({
      currentAnnualCostCents: 3_000_000,
      yearsUntilStart: 10,
      programYears: 4,
      currentSavingsCents: 2_000_000,
      tuitionInflationRateBps: 500,
      investmentReturnRateBps: 600,
      monthlyIncomeCapacityDuringSchoolCents: 50_000,
    });
    const text = result.content[0].text as string;

    expect(text).toContain('Projected annual cost in year 1: $48866.84');
    expect(text).toContain('Projected total cost across 4 year(s): $210622.18');
    expect(text).toContain('Required monthly savings contribution: $1063.19');
    expect(text).toContain('Savings third: $70207.39, Income third: $70207.39, Loans third: $70207.40');
    expect(text).toContain('NOT on track (gap $80026.85)');
  });

  it('reports an immediate lump sum with no monthly contribution when the student starts this year', async () => {
    const call = makeServer();
    const result = await call({
      currentAnnualCostCents: 2_000_000,
      yearsUntilStart: 0,
      programYears: 1,
      currentSavingsCents: 500_000,
    });
    const text = result.content[0].text as string;

    expect(text).toContain('Student starts this year — no time left to save monthly.');
    expect(text).toContain('Lump sum still needed today: $15000.00');
    expect(text).toContain('No income capacity during school provided — assumed $0 for the on-track check.');
  });

  it('applies the documented defaults (5% inflation, 6% return, 4-year program) when omitted', async () => {
    const call = makeServer();
    const result = await call({
      currentAnnualCostCents: 3_000_000,
      yearsUntilStart: 10,
      currentSavingsCents: 2_000_000,
    });
    const text = result.content[0].text as string;
    expect(text).toContain('tuition inflation 5.0%/year, investment return 6.0%/year');
    expect(text).toContain('Projected total cost across 4 year(s): $210622.18');
  });
});
