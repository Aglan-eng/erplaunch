import React, { useCallback, useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Question } from '@ofoq/shared';

interface QuestionInputProps {
  question: Question;
  value: unknown;
  onChange: (value: unknown) => void;
}

export function QuestionInput({ question, value, onChange }: QuestionInputProps) {
  const { inputType, options } = question;

  if (inputType === 'BOOLEAN') {
    return (
      <div className="flex gap-3 mt-1">
        {['Yes', 'No'].map((opt) => {
          const optVal = opt === 'Yes';
          const selected = value === optVal;
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onChange(optVal)}
              className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                selected
                  ? 'bg-brand-600 border-brand-600 text-white'
                  : 'bg-white border-gray-200 text-gray-700 hover:border-brand-300 hover:bg-brand-50'
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>
    );
  }

  if (inputType === 'SINGLE_SELECT' && options) {
    return (
      <div className="flex flex-wrap gap-2 mt-1">
        {options.map((opt) => {
          const selected = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                selected
                  ? 'bg-brand-600 border-brand-600 text-white'
                  : 'bg-white border-gray-200 text-gray-700 hover:border-brand-300 hover:bg-brand-50'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    );
  }

  if (inputType === 'MULTI_SELECT' && options) {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="flex flex-wrap gap-2 mt-1">
        {options.map((opt) => {
          const isSelected = selected.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                if (isSelected) {
                  onChange(selected.filter((v) => v !== opt.value));
                } else {
                  onChange([...selected, opt.value]);
                }
              }}
              className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                isSelected
                  ? 'bg-brand-600 border-brand-600 text-white'
                  : 'bg-white border-gray-200 text-gray-700 hover:border-brand-300 hover:bg-brand-50'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    );
  }

  if (inputType === 'NUMBER') {
    return (
      <input
        type="number"
        value={value !== undefined && value !== null ? String(value) : ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className="mt-1 w-40 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
      />
    );
  }

  if (inputType === 'DATE') {
    return (
      <input
        type="date"
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-48 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
      />
    );
  }

  if (inputType === 'TABLE') {
    return <TableInput value={value} onChange={onChange} />;
  }

  // TEXT (default)
  return (
    <textarea
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.target.value)}
      rows={3}
      className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
    />
  );
}

// ─── TABLE Input ──────────────────────────────────────────────────────────────

interface TableInputProps {
  value: unknown;
  onChange: (value: string[]) => void;
}

function TableInput({ value, onChange }: TableInputProps) {
  const rows: string[] = useMemo(
    () => (Array.isArray(value) ? (value as string[]) : []),
    [value],
  );

  const handleRowChange = useCallback(
    (index: number, text: string) => {
      const next = [...rows];
      next[index] = text;
      onChange(next);
    },
    [rows, onChange],
  );

  const handleAddRow = useCallback(() => {
    onChange([...rows, '']);
  }, [rows, onChange]);

  const handleRemoveRow = useCallback(
    (index: number) => {
      onChange(rows.filter((_, i) => i !== index));
    },
    [rows, onChange],
  );

  return (
    <div className="mt-2 space-y-2">
      {rows.length === 0 && (
        <p className="text-xs text-slate-400 italic py-2">
          No rows added yet. Click "Add row" to start.
        </p>
      )}

      {rows.map((row, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <span className="flex-shrink-0 w-6 text-center text-xs font-mono text-slate-400 select-none">
            {idx + 1}
          </span>
          <input
            type="text"
            value={row}
            onChange={(e) => handleRowChange(idx, e.target.value)}
            placeholder={`Row ${idx + 1}`}
            className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50 transition-shadow"
          />
          <button
            type="button"
            onClick={() => handleRemoveRow(idx)}
            className="flex-shrink-0 p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
            title="Remove row"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={handleAddRow}
        className="mt-1 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-slate-300 text-xs font-medium text-slate-500 hover:border-brand-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
      >
        <Plus className="h-3.5 w-3.5" />
        Add row
      </button>
    </div>
  );
}
