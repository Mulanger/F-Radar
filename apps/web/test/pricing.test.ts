import { describe, expect, it } from 'vitest';
import {
  billingNote, formatNumber, formatOrgNumber, formatSek, intervalOptions, isValidOrgNumber, monthlyPriceSek, orderSummary, orgDigits,
} from '@/lib/pricing/plans';

const NBSP = String.fromCharCode(0xa0);
const plain = (s: string) => s.split(NBSP).join(' ');

describe('pricing figures (design brief)', () => {
  it('shows the monthly equivalents from the brief for yearly and quarterly invoicing', () => {
    expect([monthlyPriceSek('start', 'year'), monthlyPriceSek('pro', 'year'), monthlyPriceSek('business', 'year')]).toEqual([208, 575, 1242]);
    expect([monthlyPriceSek('start', 'quarter'), monthlyPriceSek('pro', 'quarter'), monthlyPriceSek('business', 'quarter')]).toEqual([249, 690, 1490]);
  });

  it('says what is actually invoiced, excluding VAT', () => {
    expect(plain(billingNote('pro', 'year'))).toBe('Faktureras årsvis (6 900 kr/år exkl. moms)');
    expect(plain(billingNote('start', 'quarter'))).toBe('Faktureras kvartalsvis (747 kr/kvartal exkl. moms)');
    expect(plain(billingNote('business', 'quarter'))).toBe('Kvartals- eller månadsfaktura (4 470 kr/kvartal exkl. moms)');
  });

  it('adds 25 % VAT to the order total, rounded to öre', () => {
    const pro = orderSummary('pro', 'year');
    expect([pro.netSek, pro.vatSek, pro.grossSek]).toEqual([6900, 1725, 8625]);
    const start = orderSummary('start', 'quarter');
    expect([start.netSek, start.vatSek, start.grossSek]).toEqual([747, 186.75, 933.75]);
    expect(plain(formatSek(start.vatSek))).toBe('186,75 kr');
  });

  it('offers monthly invoicing only for Business and falls back to yearly for unknown intervals', () => {
    expect(intervalOptions('pro').map((o) => o.id)).toEqual(['year', 'quarter']);
    expect(intervalOptions('business').map((o) => o.id)).toEqual(['year', 'quarter', 'month']);
    expect(orderSummary('pro', 'month').interval.id).toBe('year');
  });

  it('formats numbers the Swedish way with non-breaking group spaces', () => {
    expect(formatNumber(14900)).toBe(`14${NBSP}900`);
    expect(formatNumber(1234567.5)).toBe(`1${NBSP}234${NBSP}567,50`);
    expect(formatNumber(0)).toBe('0');
  });
});

describe('organisation numbers', () => {
  it('keeps ten digits and inserts the hyphen while typing', () => {
    expect(orgDigits('559 000-0005 extra 99')).toBe('5590000005');
    expect(formatOrgNumber('559000')).toBe('559000');
    expect(formatOrgNumber('5590000005')).toBe('559000-0005');
  });

  it('validates the Luhn check digit', () => {
    expect(isValidOrgNumber('5590000005')).toBe(true);
    expect(isValidOrgNumber('5560360793')).toBe(true);
    expect(isValidOrgNumber('5590000004')).toBe(false);
    expect(isValidOrgNumber('559000000')).toBe(false);
  });
});
