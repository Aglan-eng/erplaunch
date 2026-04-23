import React, { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { engagementsApi, adaptorsApi, type AdaptorListing } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

interface NewEngagementModalProps {
  open: boolean;
  onClose: () => void;
}

// Shape used for "coming soon" adaptors that aren't registered on the backend
// yet. Adaptors that ARE registered (e.g. NetSuite, Odoo) get filtered out at
// render time so we don't show a disabled card for a live platform.
const COMING_SOON: Array<{ id: string; name: string; tagline: string }> = [
  { id: 'sap', name: 'SAP S/4HANA', tagline: 'SAP flagship ERP' },
  { id: 'oracle-fusion', name: 'Oracle Fusion', tagline: 'Oracle Cloud ERP' },
  { id: 'ms-dynamics', name: 'Microsoft Dynamics 365', tagline: 'Business Central + F&O' },
  { id: 'erpnext', name: 'ERPNext', tagline: 'Open-source Python ERP' },
  { id: 'custom', name: 'Custom / In-house system', tagline: 'Upload your own questionnaire' },
];

export function NewEngagementModal({ open, onClose }: NewEngagementModalProps) {
  const [clientName, setClientName] = useState('');
  const [adaptorId, setAdaptorId] = useState<string>('netsuite');
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const adaptorsQuery = useQuery({
    queryKey: ['adaptors'],
    queryFn: adaptorsApi.list,
    enabled: open,
  });
  const availableAdaptors: AdaptorListing[] = adaptorsQuery.data ?? [];
  const availableIds = new Set(availableAdaptors.map((a) => a.id));

  const mutation = useMutation({
    mutationFn: () => engagementsApi.create({ clientName: clientName.trim(), adaptorId }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['engagements'] });
      onClose();
      setClientName('');
      setAdaptorId('netsuite');
      navigate(`/engagements/${data.id}/wizard`);
    },
  });

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-xl z-50 w-full max-w-xl p-6 max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-5">
            <Dialog.Title className="text-base font-semibold text-gray-900">
              New Engagement
            </Dialog.Title>
            <button
              onClick={onClose}
              className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (clientName.trim()) mutation.mutate();
            }}
            className="space-y-5"
          >
            <Input
              label="Client Name"
              id="clientName"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="e.g. Acme Corporation"
              autoFocus
            />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Target platform</label>
              <p className="text-xs text-gray-500 mb-3">
                Which ERP or system this engagement is implementing. The wizard,
                rule engine, and generators adjust to the target.
              </p>

              <div className="grid grid-cols-2 gap-2">
                {/* Available adaptors first */}
                {availableAdaptors.map((a) => (
                  <PlatformCard
                    key={a.id}
                    id={a.id}
                    name={a.name}
                    tagline={a.tagline}
                    selected={adaptorId === a.id}
                    disabled={false}
                    onSelect={() => setAdaptorId(a.id)}
                  />
                ))}
                {/* Then "coming soon" — disabled, visible so firms see the roadmap */}
                {COMING_SOON.filter((c) => !availableIds.has(c.id)).map((c) => (
                  <PlatformCard
                    key={c.id}
                    id={c.id}
                    name={c.name}
                    tagline={c.tagline}
                    selected={false}
                    disabled
                    onSelect={() => { /* no-op */ }}
                  />
                ))}
              </div>

              {adaptorsQuery.isLoading && (
                <p className="mt-2 text-xs text-gray-400">Loading available platforms…</p>
              )}
            </div>

            <div className="flex gap-3 justify-end pt-2 border-t border-gray-100">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                loading={mutation.isPending}
                disabled={!clientName.trim() || !adaptorId}
              >
                Create & Open Wizard
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PlatformCard({
  name, tagline, selected, disabled, onSelect,
}: {
  id: string;
  name: string;
  tagline?: string;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={[
        'text-left p-3 rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400',
        disabled
          ? 'border-gray-100 bg-gray-50 cursor-not-allowed opacity-60'
          : selected
            ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500'
            : 'border-gray-200 bg-white hover:border-gray-300',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <p className={['text-sm font-semibold leading-tight', disabled ? 'text-gray-500' : 'text-gray-900'].join(' ')}>
          {name}
        </p>
        {disabled && (
          <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
            Coming soon
          </span>
        )}
        {!disabled && selected && (
          <span className="text-[10px] font-semibold text-brand-700 bg-brand-100 px-1.5 py-0.5 rounded">
            Selected
          </span>
        )}
      </div>
      {tagline && (
        <p className={['text-[11px] mt-1 leading-snug', disabled ? 'text-gray-400' : 'text-gray-500'].join(' ')}>
          {tagline}
        </p>
      )}
    </button>
  );
}
