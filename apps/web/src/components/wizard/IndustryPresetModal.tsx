import React, { useState, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  X, CircleCheck, Sparkles, Loader, Check,
  ShoppingCart, Factory, Package, Briefcase, Heart,
  Bird, ChefHat, FlaskConical, Building, Ship, Stethoscope,
  Eye, BookmarkPlus, Trash2, ChevronDown, ChevronUp,
  Zap, Server, AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { engagementsApi } from '@/lib/api';
import { useWizardStore } from '@/stores/wizardStore';
import { INDUSTRY_PRESETS, getAnswerSection, PRESET_SECTIONS } from '@/lib/industryPresets';
import type { IndustryPreset } from '@/lib/industryPresets';
import { Modal } from '@/components/ui/Modal';

// ─── Icon resolver ────────────────────────────────────────────────────────────
const ICON_MAP: Record<string, React.ElementType> = {
  ShoppingCart, Factory, Package, Briefcase, Heart,
  Bird, ChefHat, FlaskConical, Building, Ship, Stethoscope,
  Sparkles,
};

function PresetIcon({ preset, size = 'md' }: { preset: IndustryPreset; size?: 'sm' | 'md' }) {
  const Icon = ICON_MAP[preset.iconId] ?? Sparkles;
  const dims = size === 'sm' ? 'h-3.5 w-3.5' : 'h-5 w-5';
  const boxDims = size === 'sm' ? 'h-7 w-7' : 'h-11 w-11';
  return (
    <div className={cn('rounded-xl flex items-center justify-center flex-shrink-0', boxDims, preset.color)}>
      <Icon className={cn(dims, preset.textColor)} />
    </div>
  );
}

// ─── Custom preset storage (localStorage) ────────────────────────────────────
const CUSTOM_KEY = 'ofoq_custom_presets';

function loadCustomPresets(): IndustryPreset[] {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function saveCustomPresets(presets: IndustryPreset[]) {
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(presets));
}

// ─── Preview helpers ──────────────────────────────────────────────────────────
function computePreview(
  selectedIds: string[],
  allPresets: IndustryPreset[],
  existingAnswers: Record<string, unknown>,
): { total: number; bySection: Record<string, number>; merged: Record<string, unknown> } {
  const merged: Record<string, unknown> = {};
  for (const id of selectedIds) {
    const preset = allPresets.find((p) => p.id === id);
    if (!preset) continue;
    for (const [key, value] of Object.entries(preset.answers)) {
      merged[key] = value;
    }
  }
  const bySection: Record<string, number> = {};
  let total = 0;
  for (const key of Object.keys(merged)) {
    const existing = existingAnswers[key];
    if (existing === undefined || existing === null || existing === '') {
      const section = getAnswerSection(key);
      bySection[section] = (bySection[section] ?? 0) + 1;
      total++;
    }
  }
  return { total, bySection, merged };
}

// ─── Preset detail panel ──────────────────────────────────────────────────────
function PresetDetail({ preset }: { preset: IndustryPreset }) {
  const [showNotes, setShowNotes] = useState(false);
  return (
    <div className="rounded-xl border border-brand-100 bg-gradient-to-br from-brand-50/60 to-white p-4 space-y-4 text-sm">
      {/* Long description */}
      {preset.longDescription && (
        <p className="text-sm text-gray-700 leading-relaxed">{preset.longDescription}</p>
      )}

      {/* Key features */}
      {preset.keyFeatures && preset.keyFeatures.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Zap className="h-3.5 w-3.5 text-brand-500" />
            <p className="text-[11px] font-bold text-brand-700 uppercase tracking-wider">What this preset pre-configures</p>
          </div>
          <ul className="space-y-1.5">
            {preset.keyFeatures.map((f, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-gray-700">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-brand-400 flex-shrink-0" />
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* NS Modules */}
      {preset.nsModules && preset.nsModules.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Server className="h-3.5 w-3.5 text-violet-500" />
            <p className="text-[11px] font-bold text-violet-700 uppercase tracking-wider">Typical NetSuite modules needed</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {preset.nsModules.map((m, i) => (
              <span key={i} className="text-[10px] font-semibold bg-violet-50 text-violet-700 border border-violet-100 px-2 py-0.5 rounded-full">
                {m}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Consultant notes — collapsible */}
      {preset.consultantNotes && preset.consultantNotes.length > 0 && (
        <div className="border-t border-brand-100 pt-3">
          <button
            onClick={() => setShowNotes((v) => !v)}
            className="flex items-center gap-1.5 text-[11px] font-bold text-amber-700 hover:text-amber-800 transition-colors w-full"
          >
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
            Consultant notes & what to verify
            {showNotes ? <ChevronUp className="h-3.5 w-3.5 ml-auto" /> : <ChevronDown className="h-3.5 w-3.5 ml-auto" />}
          </button>
          {showNotes && (
            <ul className="mt-2 space-y-2">
              {preset.consultantNotes.map((note, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  <span className="font-black text-amber-500 flex-shrink-0 mt-px">!</span>
                  {note}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface IndustryPresetModalProps {
  engagementId: string;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────
export function IndustryPresetModal({ engagementId, onClose }: IndustryPresetModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [appliedCount, setAppliedCount] = useState<number | null>(null);
  const [appliedLabels, setAppliedLabels] = useState<string[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customPresets, setCustomPresets] = useState<IndustryPreset[]>(loadCustomPresets);
  const queryClient = useQueryClient();
  const { answers, mergeAnswers } = useWizardStore();

  const allPresets = useMemo(() => [
    ...INDUSTRY_PRESETS,
    ...customPresets,
  ], [customPresets]);

  const selectedArray = Array.from(selectedIds);

  const preview = useMemo(
    () => computePreview(selectedArray, allPresets, answers),
    [selectedArray, allPresets, answers],
  );

  function togglePreset(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleExpand(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  function handleSaveCustom() {
    const name = customName.trim();
    if (!name) return;
    const newPreset: IndustryPreset = {
      id: `custom_${Date.now()}`,
      label: name,
      iconId: 'Sparkles',
      color: 'bg-gray-100',
      textColor: 'text-gray-600',
      description: 'Custom preset from current answers',
      answers: { ...answers },
      isCustom: true,
    };
    const updated = [...customPresets, newPreset];
    saveCustomPresets(updated);
    setCustomPresets(updated);
    setCustomName('');
    setShowSaveForm(false);
  }

  function handleDeleteCustom(id: string) {
    const updated = customPresets.filter((p) => p.id !== id);
    saveCustomPresets(updated);
    setCustomPresets(updated);
    setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
  }

  const applyMutation = useMutation({
    mutationFn: async () => {
      const newAnswers: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(preview.merged)) {
        if (answers[key] === undefined || answers[key] === null || answers[key] === '') {
          newAnswers[key] = value;
        }
      }
      if (Object.keys(newAnswers).length > 0) {
        await engagementsApi.patchProfile(engagementId, newAnswers);
        mergeAnswers(newAnswers);
      }
      return Object.keys(newAnswers).length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['profile', engagementId] });
      setAppliedCount(count);
      setAppliedLabels(selectedArray.map((id) => allPresets.find((p) => p.id === id)?.label ?? id));
    },
  });

  const done = appliedCount !== null;

  return (
    <Modal>
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div
        className="relative bg-white rounded-2xl w-full max-w-xl overflow-hidden flex flex-col"
        style={{ maxHeight: '92vh', boxShadow: '0 25px 60px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,0,0,0.06)' }}
      >
        {/* ── Header ── */}
        <div className="flex-shrink-0 px-6 py-5 border-b border-gray-100">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-violet-50 flex items-center justify-center">
                <Sparkles className="h-4 w-4 text-violet-600" />
              </div>
              <div>
                <h2 className="text-base font-black text-gray-900 leading-tight">Industry Presets</h2>
                <p className="text-xs text-gray-500 mt-0.5">Select one or more · click the arrow to learn more</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors flex-shrink-0"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0">
          {done ? (
            /* ── Success state ── */
            <div className="py-10 text-center">
              <div className="h-16 w-16 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
                <CircleCheck className="h-8 w-8 text-green-500" />
              </div>
              <div className="flex items-center justify-center gap-2 flex-wrap mb-1">
                {appliedLabels.map((label) => {
                  const preset = allPresets.find((p) => p.label === label);
                  return preset ? (
                    <span key={label} className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold', preset.color)}>
                      <PresetIcon preset={preset} size="sm" />
                      <span className={preset.textColor}>{label}</span>
                    </span>
                  ) : null;
                })}
              </div>
              <p className="text-base font-bold text-gray-900 mt-3">
                {appliedLabels.length === 1 ? `${appliedLabels[0]} preset applied!` : `${appliedLabels.length} presets applied!`}
              </p>
              <p className="text-sm text-gray-500 mt-1.5">
                {appliedCount === 0
                  ? 'All fields were already filled — nothing changed.'
                  : `${appliedCount} blank field${appliedCount === 1 ? '' : 's'} pre-filled. You can override any answer in the wizard.`
                }
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* ── Preset list ── */}
              <div className="space-y-2">
                {allPresets.map((preset) => {
                  const isSelected = selectedIds.has(preset.id);
                  const isExpanded = expandedId === preset.id;
                  const hasDetail = !preset.isCustom && (preset.longDescription || (preset.keyFeatures?.length ?? 0) > 0);
                  return (
                    <div key={preset.id} className={cn(
                      'rounded-xl border-2 transition-all duration-150 group/card overflow-hidden',
                      isSelected
                        ? 'border-brand-400 bg-brand-50/30 shadow-sm'
                        : 'border-gray-100 bg-gray-50/50 hover:border-gray-200 hover:bg-white'
                    )}>
                      {/* Card header row */}
                      <div className="flex items-center gap-3 px-4 py-3">
                        {/* Checkbox — left click to select */}
                        <button
                          onClick={() => togglePreset(preset.id)}
                          className="flex-shrink-0"
                          title={isSelected ? 'Deselect' : 'Select preset'}
                        >
                          <div className={cn(
                            'h-5 w-5 rounded border-2 flex items-center justify-center transition-all',
                            isSelected ? 'border-brand-500 bg-brand-500' : 'border-gray-300 bg-white'
                          )}>
                            {isSelected && <Check className="h-3 w-3 text-white stroke-[3]" />}
                          </div>
                        </button>

                        <PresetIcon preset={preset} />

                        {/* Label + description */}
                        <div className="flex-1 min-w-0" onClick={() => togglePreset(preset.id)} style={{ cursor: 'pointer' }}>
                          <div className="flex items-center gap-2">
                            <p className={cn('text-sm font-bold leading-tight', isSelected ? 'text-brand-800' : 'text-gray-800')}>
                              {preset.label}
                            </p>
                            {preset.isCustom && (
                              <span className="text-[9px] font-black uppercase tracking-wider text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                                Custom
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5 leading-snug">{preset.description}</p>
                        </div>

                        {/* Expand button (only for presets with detail) */}
                        {hasDetail ? (
                          <button
                            onClick={() => toggleExpand(preset.id)}
                            className={cn(
                              'p-1 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-all flex-shrink-0',
                              isExpanded && 'text-brand-500 bg-brand-50'
                            )}
                            title={isExpanded ? 'Hide details' : 'Learn more about this preset'}
                          >
                            {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          </button>
                        ) : null}

                        {/* Delete custom preset button */}
                        {preset.isCustom && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteCustom(preset.id); }}
                            className="p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all flex-shrink-0"
                            title="Delete custom preset"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>

                      {/* Expandable detail panel */}
                      {isExpanded && hasDetail && (
                        <div className="px-4 pb-4 border-t border-brand-100 pt-3">
                          <PresetDetail preset={preset} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* ── Preview panel ── */}
              {selectedIds.size > 0 && (
                <div className="rounded-xl border border-brand-100 bg-brand-50/40 overflow-hidden">
                  <button
                    onClick={() => setShowPreview((v) => !v)}
                    className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-brand-700"
                  >
                    <div className="flex items-center gap-1.5">
                      <Eye className="h-3.5 w-3.5" />
                      Preview: {preview.total} blank field{preview.total !== 1 ? 's' : ''} will be filled
                    </div>
                    {showPreview ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                  {showPreview && (
                    <div className="px-4 pb-3 border-t border-brand-100">
                      {Object.keys(PRESET_SECTIONS).map((sectionKey) => {
                        const sectionLabel = PRESET_SECTIONS[sectionKey];
                        const count = preview.bySection[sectionLabel] ?? 0;
                        if (count === 0) return null;
                        return (
                          <div key={sectionKey} className="flex items-center justify-between mt-2">
                            <span className="text-xs text-gray-600">{sectionLabel}</span>
                            <span className="text-xs font-semibold text-brand-600 bg-brand-50 border border-brand-100 rounded px-1.5 py-0.5">
                              {count} field{count !== 1 ? 's' : ''}
                            </span>
                          </div>
                        );
                      })}
                      {preview.total === 0 && (
                        <p className="text-xs text-gray-400 mt-2">All preset fields are already filled — nothing will change.</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── Save current as custom preset ── */}
              <div className="border-t border-dashed border-gray-200 pt-3">
                {showSaveForm ? (
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSaveCustom(); if (e.key === 'Escape') setShowSaveForm(false); }}
                      placeholder="Custom preset name…"
                      className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-300"
                    />
                    <button
                      onClick={handleSaveCustom}
                      disabled={!customName.trim()}
                      className="px-3 py-1.5 text-xs font-semibold bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-40 transition-colors"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setShowSaveForm(false)}
                      className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowSaveForm(true)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-brand-600 transition-colors"
                  >
                    <BookmarkPlus className="h-3.5 w-3.5" />
                    Save current answers as custom preset
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex-shrink-0 px-6 py-4 border-t border-gray-100 bg-gray-50/50">
          {done ? (
            <button
              onClick={onClose}
              className="w-full px-5 py-2.5 rounded-xl bg-brand-600 text-white text-sm font-bold hover:bg-brand-700 transition-colors"
            >
              Done
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <p className="flex-1 text-xs text-gray-400">Only blank fields will be filled — existing answers stay</p>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={selectedIds.size === 0 || applyMutation.isPending}
                onClick={() => applyMutation.mutate()}
                className={cn(
                  'inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all',
                  selectedIds.size > 0 && !applyMutation.isPending
                    ? 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                )}
              >
                {applyMutation.isPending
                  ? <><Loader className="h-4 w-4 animate-spin" />Applying…</>
                  : <><Sparkles className="h-4 w-4" />Apply{selectedIds.size > 1 ? ` ${selectedIds.size} Presets` : ' Preset'}</>
                }
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
    </Modal>
  );
}
