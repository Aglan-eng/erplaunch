import React, { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { engagementsApi } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

interface NewEngagementModalProps {
  open: boolean;
  onClose: () => void;
}

export function NewEngagementModal({ open, onClose }: NewEngagementModalProps) {
  const [clientName, setClientName] = useState('');
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const mutation = useMutation({
    mutationFn: () => engagementsApi.create(clientName.trim()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['engagements'] });
      onClose();
      setClientName('');
      navigate(`/engagements/${data.id}/wizard`);
    },
  });

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-xl z-50 w-full max-w-md p-6">
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
          >
            <Input
              label="Client Name"
              id="clientName"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="e.g. Acme Corporation"
              autoFocus
            />

            <div className="mt-5 flex gap-3 justify-end">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                loading={mutation.isPending}
                disabled={!clientName.trim()}
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
