// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RecordMetaForm } from './RecordMetaForm';

describe('RecordMetaForm unit suffixes', () => {
  it('renders time and travel costs through end InputAdornments without changing numeric input constraints', () => {
    render(<RecordMetaForm
      actualServiceTypeId="" serviceTypes={[]} selectedHelpers={['テスト担当']}
      selectableStaffs={[{ id: 'staff-1', name: 'テスト担当', defaultTravelCostYen: 500 }]}
      actualStaffs={[{ staff_id: 'staff-1', staff_role_id: null }]} staffRoles={[]}
      startDateTime="2026-10-02T09:00" endDateTime="2026-10-02T10:00"
      serviceTime="1" travelTime="0.5" travelExpenses={{ 'staff-1': { method: 'car', amountYen: '500' } }}
      applyDefaultTravelCosts={true} errors={{}} aiFilledFields={new Set()} disabled={false}
      onServiceTypeChange={vi.fn()} onStaffChange={vi.fn()} onActualStaffsChange={vi.fn()}
      onStartChange={vi.fn()} onEndChange={vi.fn()} onServiceTimeChange={vi.fn()}
      onTravelTimeChange={vi.fn()} onTravelExpenseChange={vi.fn()}
    />);
    const fields = [
      { name: 'サービス提供', unit: '時間', step: '0.5', mode: 'decimal' },
      { name: '移動', unit: '時間', step: '0.5', mode: 'decimal' },
      { name: '精算額', unit: '円', step: '1', mode: 'numeric' },
    ];
    for (const { name, unit, step, mode } of fields) {
      const input = screen.getByRole('spinbutton', { name });
      expect(input.getAttribute('step')).toBe(step);
      expect(input.getAttribute('inputmode')).toBe(mode);
      const adornment = input.parentElement?.querySelector('.MuiInputAdornment-positionEnd');
      expect(adornment?.textContent).toBe(unit);
      expect(getComputedStyle(adornment!).whiteSpace).toBe('nowrap');
      expect(getComputedStyle(adornment!).flexShrink).toBe('0');
    }
  });
});
