/**
 * Phase 52.3 — kanban view of the Customers page.
 *
 * Layout: a horizontal scroll of 6 phase-group columns. Each group
 * header carries its constituent stages as sub-columns underneath,
 * stacked vertically. Drag-and-drop uses native HTML5 events:
 *
 *   - `dragstart` on a card sets `dataTransfer` to the customerId
 *   - `dragover` on a column calls `preventDefault()` so the
 *     browser allows the drop
 *   - `drop` on a column reads the customerId + calls back to the
 *     parent with `(customerId, toStage)`
 *
 * On drop, the parent optimistically updates state, fires the
 * PATCH, snaps back on failure, and surfaces a toast either way.
 */
import React, { useState } from 'react';
import type { CustomerStage, CustomerSummary } from '@/lib/api';
import {
  STAGE_DETAILS_ORDERED,
  STAGE_GROUPS_ORDERED,
  type StageDetail,
} from './stageMetadata';
import { CustomerCard } from './CustomerCard';
import { cn } from '@/lib/utils';

interface CustomerKanbanViewProps {
  customers: CustomerSummary[];
  /** Called when a card is dropped onto a different stage column.
   *  The parent owns the network round-trip and optimistic state. */
  onMove: (customerId: string, toStage: CustomerStage) => void;
}

const DRAG_MIME = 'application/x-customer-id';

export function CustomerKanbanView({ customers, onMove }: CustomerKanbanViewProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverStage, setHoverStage] = useState<CustomerStage | null>(null);

  // Bucket customers by stage. Stages that have no customers still
  // render a column (empty drop target) so the user can drag into
  // every lifecycle stage.
  const byStage = new Map<CustomerStage, CustomerSummary[]>();
  for (const detail of STAGE_DETAILS_ORDERED) {
    byStage.set(detail.key, []);
  }
  for (const c of customers) {
    const bucket = byStage.get(c.currentStage);
    if (bucket) bucket.push(c);
  }

  const handleDragStart =
    (id: string) => (event: React.DragEvent<HTMLDivElement>) => {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(DRAG_MIME, id);
      setDraggingId(id);
    };

  const handleDragEnd = () => {
    setDraggingId(null);
    setHoverStage(null);
  };

  const handleDragOver =
    (stage: CustomerStage) => (event: React.DragEvent<HTMLDivElement>) => {
      // preventDefault is required to permit a drop. Without it the
      // browser silently refuses and the drop handler never fires.
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (hoverStage !== stage) setHoverStage(stage);
    };

  const handleDragLeave = (stage: CustomerStage) => () => {
    if (hoverStage === stage) setHoverStage(null);
  };

  const handleDrop =
    (stage: CustomerStage) => (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const id = event.dataTransfer.getData(DRAG_MIME);
      setDraggingId(null);
      setHoverStage(null);
      if (!id) return;
      // No-op when dropping back onto the same stage.
      const current = customers.find((c) => c.id === id);
      if (!current || current.currentStage === stage) return;
      onMove(id, stage);
    };

  return (
    <div
      className="overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 p-3"
      data-testid="customers-kanban-view"
    >
      <div className="flex gap-3 min-w-max">
        {STAGE_GROUPS_ORDERED.map((group) => {
          const groupStages: StageDetail[] = STAGE_DETAILS_ORDERED.filter(
            (s) => s.group === group.id,
          );
          const groupCount = groupStages.reduce(
            (acc, s) => acc + (byStage.get(s.key)?.length ?? 0),
            0,
          );
          return (
            <section
              key={group.id}
              className="flex-shrink-0 w-fit"
              data-testid={`kanban-group-${group.id}`}
            >
              <header className="mb-2 flex items-center gap-2 px-1">
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                    group.badgeClass,
                  )}
                >
                  {group.label}
                </span>
                <span className="text-xs text-gray-500 tabular-nums">{groupCount}</span>
              </header>
              <div className="flex gap-2">
                {groupStages.map((stage) => {
                  const cards = byStage.get(stage.key) ?? [];
                  const isHover = hoverStage === stage.key;
                  return (
                    <div
                      key={stage.key}
                      className={cn(
                        'w-64 rounded-lg border bg-white p-2 transition-colors',
                        isHover ? 'border-brand-400 bg-brand-50/30' : 'border-gray-200',
                      )}
                      data-testid={`kanban-column-${stage.key}`}
                      data-stage={stage.key}
                      onDragOver={handleDragOver(stage.key)}
                      onDragLeave={handleDragLeave(stage.key)}
                      onDrop={handleDrop(stage.key)}
                    >
                      <header className="mb-2 flex items-center justify-between px-1">
                        <span className="text-xs font-semibold text-gray-700">
                          {stage.label}
                        </span>
                        <span className="text-[10px] text-gray-400 tabular-nums">
                          {cards.length}
                        </span>
                      </header>
                      <div className="flex flex-col gap-2 min-h-[40px]">
                        {cards.map((c) => (
                          <CustomerCard
                            key={c.id}
                            customer={c}
                            draggable
                            onDragStart={handleDragStart(c.id)}
                            onDragEnd={handleDragEnd}
                          />
                        ))}
                        {cards.length === 0 && !isHover && (
                          <p className="text-[11px] text-gray-300 text-center py-2">
                            Drop here
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      {/* Hidden marker that surfaces the dragging id in the DOM so
          e2e + SSR tests can confirm the handler wired correctly. */}
      {draggingId && (
        <span className="sr-only" data-testid="kanban-dragging-id">
          {draggingId}
        </span>
      )}
    </div>
  );
}
