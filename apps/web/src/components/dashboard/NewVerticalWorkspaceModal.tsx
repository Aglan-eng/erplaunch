import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { engagementsApi, verticalsApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  X, Bird, ShoppingCart, Factory, Package, Briefcase, Heart, Layers,
  ArrowRight, Loader2, ExternalLink,
} from 'lucide-react';

const ICON_MAP: Record<string, React.ElementType> = {
  Bird, ShoppingCart, Factory, Package, Briefcase, Heart,
};

function VerticalIcon({ iconId, className }: { iconId: string; className?: string }) {
  const Icon = ICON_MAP[iconId] ?? Layers;
  return <Icon className={className} />;
}

interface Vertical {
  id: string;
  name: string;
  description: string;
  iconId: string;
  color: string;
  textColor: string;
  tag?: string;
  productUrl?: string;
  moduleCount: number;
  riskCount: number;
}

interface Props {
  engagementId: string;
  onClose: () => void;
}

export function NewVerticalWorkspaceModal({ engagementId, onClose }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: verticals, isLoading } = useQuery<Vertical[]>({
    queryKey: ['verticals'],
    queryFn: () => verticalsApi.list(),
  });

  const createMutation = useMutation({
    mutationFn: () => engagementsApi.createVerticalWorkspace(engagementId, { verticalType: selected! }),
    onSuccess: (workspace: Record<string, unknown>) => {
      qc.invalidateQueries({ queryKey: ['verticalWorkspaces', engagementId] });
      onClose();
      navigate(`/engagements/${workspace.id}/vertical`);
    },
  });

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-900">Add Vertical Workspace</h2>
            <p className="text-xs text-gray-400 mt-0.5">Choose a vertical to create a linked workspace with industry-specific configuration</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Vertical list */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 text-brand-400 animate-spin" />
            </div>
          ) : (
            <div className="space-y-3">
              {(verticals ?? []).map((v) => (
                <button
                  key={v.id}
                  onClick={() => setSelected(v.id === selected ? null : v.id)}
                  className={cn(
                    'w-full text-left rounded-xl border-2 p-4 transition-all',
                    selected === v.id
                      ? 'border-brand-400 bg-brand-50'
                      : 'border-gray-100 hover:border-gray-200 bg-white',
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className={cn('h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0', v.color)}>
                      <VerticalIcon iconId={v.iconId} className={cn('h-5 w-5', v.textColor)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-gray-900">{v.name}</p>
                        {v.tag && (
                          <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full border border-amber-100">
                            {v.tag}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{v.description}</p>
                      <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-400">
                        <span>{v.moduleCount} modules</span>
                        <span>·</span>
                        <span>{v.riskCount} pre-seeded risks</span>
                        {v.productUrl && (
                          <>
                            <span>·</span>
                            <a
                              href={v.productUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center gap-0.5 text-brand-500 hover:text-brand-700"
                            >
                              Product docs <ExternalLink className="h-2.5 w-2.5" />
                            </a>
                          </>
                        )}
                      </div>
                    </div>
                    <div className={cn(
                      'h-5 w-5 rounded-full border-2 flex items-center justify-center flex-shrink-0',
                      selected === v.id ? 'border-brand-500 bg-brand-500' : 'border-gray-200',
                    )}>
                      {selected === v.id && <div className="h-2 w-2 rounded-full bg-white" />}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50">
          <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">Cancel</button>
          <button
            onClick={() => createMutation.mutate()}
            disabled={!selected || createMutation.isPending}
            className={cn(
              'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all',
              !selected || createMutation.isPending
                ? 'bg-gray-100 text-gray-400'
                : 'bg-brand-600 text-white hover:bg-brand-700',
            )}
          >
            {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            Create workspace
          </button>
        </div>
      </div>
    </div>
  );
}
