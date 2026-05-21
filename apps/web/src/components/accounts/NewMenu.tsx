/**
 * Phase 56.2 — `+ New` menu + three creation modals.
 *
 * Surfaced from the AccountsPage header (and reusable elsewhere).
 * Drives the three creation flows Hesham asked for:
 *
 *   - New Lead → POST /leads (existing account OR new account)
 *   - New Customer → POST /accounts (no project yet)
 *   - New Project → POST /accounts/:id/projects (existing account)
 *
 * All three are advisory only until the user submits.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ChevronDown, X, Loader2 } from 'lucide-react';
import {
  accountsApi,
  leadsApi,
  type AccountSummary,
  type ProjectKind,
  type CustomerStage,
} from '@/lib/api';
import { cn } from '@/lib/utils';

type Flow = 'lead' | 'customer' | 'project';

export interface NewMenuProps {
  accounts: AccountSummary[];
  onSuccess?: () => void;
  /** When set, the project flow defaults its account selector to this id. */
  defaultAccountId?: string;
}

export function NewMenu({ accounts, onSuccess, defaultAccountId }: NewMenuProps) {
  const [open, setOpen] = useState(false);
  const [activeFlow, setActiveFlow] = useState<Flow | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const closeModal = (): void => setActiveFlow(null);

  return (
    <>
      <div className="relative" ref={containerRef} data-testid="new-menu">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          data-testid="new-menu-trigger"
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700"
        >
          <Plus className="h-3.5 w-3.5" />
          New
          <ChevronDown className="h-3 w-3 opacity-80" />
        </button>
        {open && (
          <div
            className="absolute right-0 top-full mt-1 w-44 rounded-lg border border-gray-200 bg-white shadow-lg z-40 overflow-hidden"
            data-testid="new-menu-items"
          >
            <MenuItem
              testid="new-menu-item-lead"
              label="New Lead"
              hint="Sales just heard from someone"
              onClick={() => {
                setOpen(false);
                setActiveFlow('lead');
              }}
            />
            <MenuItem
              testid="new-menu-item-customer"
              label="New Customer"
              hint="Register a company"
              onClick={() => {
                setOpen(false);
                setActiveFlow('customer');
              }}
            />
            <MenuItem
              testid="new-menu-item-project"
              label="New Project"
              hint="Phase 2 / follow-on"
              onClick={() => {
                setOpen(false);
                setActiveFlow('project');
              }}
            />
          </div>
        )}
      </div>

      {activeFlow === 'lead' && (
        <NewLeadModal
          accounts={accounts}
          onClose={closeModal}
          onSuccess={() => {
            closeModal();
            onSuccess?.();
          }}
        />
      )}
      {activeFlow === 'customer' && (
        <NewCustomerModal
          onClose={closeModal}
          onSuccess={() => {
            closeModal();
            onSuccess?.();
          }}
        />
      )}
      {activeFlow === 'project' && (
        <NewProjectModal
          accounts={accounts}
          defaultAccountId={defaultAccountId}
          onClose={closeModal}
          onSuccess={() => {
            closeModal();
            onSuccess?.();
          }}
        />
      )}
    </>
  );
}

function MenuItem({
  label,
  hint,
  onClick,
  testid,
}: {
  label: string;
  hint: string;
  onClick: () => void;
  testid: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-0"
    >
      <div className="text-sm font-semibold text-gray-900">{label}</div>
      <div className="text-[11px] text-gray-500">{hint}</div>
    </button>
  );
}

// ─── New Lead ────────────────────────────────────────────────────────────

function NewLeadModal({
  accounts,
  onClose,
  onSuccess,
}: {
  accounts: AccountSummary[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const navigate = useNavigate();
  const hasExisting = accounts.length > 0;
  const [mode, setMode] = useState<'existing' | 'new'>(hasExisting ? 'existing' : 'new');
  const [accountId, setAccountId] = useState<string>(accounts[0]?.id ?? '');
  const [companyName, setCompanyName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [projectName, setProjectName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const body =
        mode === 'existing'
          ? { accountId, projectName }
          : {
              newAccount: {
                name: companyName,
                primaryContactName: contactName || null,
                primaryContactEmail: contactEmail || null,
              },
              projectName,
            };
      const resp = await leadsApi.create(body);
      onSuccess();
      navigate(`/customers/${resp.projectId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create lead');
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit =
    projectName.trim().length > 0 &&
    (mode === 'existing' ? Boolean(accountId) : companyName.trim().length > 0);

  return (
    <Modal
      title="New Lead"
      onClose={onClose}
      testid="new-lead-modal"
      footer={
        <SubmitRow
          onCancel={onClose}
          onSubmit={() => void submit()}
          disabled={!canSubmit || submitting}
          submitting={submitting}
          submitLabel="Create lead"
          submitTestid="new-lead-submit"
        />
      }
    >
      {hasExisting && (
        <div className="mb-3 flex items-center gap-2 text-xs">
          <ModeToggle
            active={mode === 'existing'}
            onClick={() => setMode('existing')}
            testid="new-lead-mode-existing"
          >
            Existing account
          </ModeToggle>
          <ModeToggle
            active={mode === 'new'}
            onClick={() => setMode('new')}
            testid="new-lead-mode-new"
          >
            New company
          </ModeToggle>
        </div>
      )}
      <div className="space-y-3">
        {mode === 'existing' ? (
          <Field label="Account">
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              data-testid="new-lead-account"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-200"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <>
            <Field label="Company name">
              <Input
                value={companyName}
                onChange={setCompanyName}
                placeholder="Acme Industries"
                testid="new-lead-company-name"
              />
            </Field>
            <Field label="Primary contact (optional)">
              <Input
                value={contactName}
                onChange={setContactName}
                placeholder="Lina Said"
                testid="new-lead-contact-name"
              />
            </Field>
            <Field label="Contact email (optional)">
              <Input
                value={contactEmail}
                onChange={setContactEmail}
                placeholder="lina@acme.example"
                type="email"
                testid="new-lead-contact-email"
              />
            </Field>
          </>
        )}
        <Field label="Lead / opportunity name">
          <Input
            value={projectName}
            onChange={setProjectName}
            placeholder="NetSuite implementation"
            testid="new-lead-project-name"
          />
        </Field>
        {error && (
          <p className="text-xs text-rose-600" data-testid="new-lead-error">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

// ─── New Customer ────────────────────────────────────────────────────────

function NewCustomerModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const resp = await accountsApi.create({
        name,
        address: address || null,
        primaryContactName: contactName || null,
        primaryContactEmail: contactEmail || null,
        primaryContactPhone: contactPhone || null,
      });
      onSuccess();
      navigate(`/accounts/${resp.account.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create customer');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="New Customer"
      onClose={onClose}
      testid="new-customer-modal"
      footer={
        <SubmitRow
          onCancel={onClose}
          onSubmit={() => void submit()}
          disabled={name.trim().length === 0 || submitting}
          submitting={submitting}
          submitLabel="Create customer"
          submitTestid="new-customer-submit"
        />
      }
    >
      <div className="space-y-3">
        <Field label="Company name">
          <Input value={name} onChange={setName} placeholder="Acme Industries" testid="new-customer-name" />
        </Field>
        <Field label="Address (optional)">
          <Input value={address} onChange={setAddress} placeholder="HQ address" testid="new-customer-address" />
        </Field>
        <Field label="Primary contact (optional)">
          <Input value={contactName} onChange={setContactName} placeholder="Lina Said" testid="new-customer-contact-name" />
        </Field>
        <Field label="Contact email (optional)">
          <Input
            value={contactEmail}
            onChange={setContactEmail}
            placeholder="lina@acme.example"
            type="email"
            testid="new-customer-contact-email"
          />
        </Field>
        <Field label="Contact phone (optional)">
          <Input value={contactPhone} onChange={setContactPhone} placeholder="+1 555 1234" testid="new-customer-contact-phone" />
        </Field>
        {error && (
          <p className="text-xs text-rose-600" data-testid="new-customer-error">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

// ─── New Project ─────────────────────────────────────────────────────────

const KIND_OPTIONS: ReadonlyArray<{ value: ProjectKind; label: string }> = [
  { value: 'INITIAL_IMPLEMENTATION', label: 'Initial implementation' },
  { value: 'PHASE_2', label: 'Phase 2' },
  { value: 'MODULE_ROLLOUT', label: 'Module rollout' },
  { value: 'OTHER', label: 'Other' },
];

const STAGE_OPTIONS: ReadonlyArray<{ value: CustomerStage; label: string }> = [
  { value: 'LEAD', label: 'Lead' },
  { value: 'QUALIFIED', label: 'Qualified' },
  { value: 'PROPOSAL', label: 'Proposal' },
  { value: 'WON', label: 'Won' },
  { value: 'DISCOVERY', label: 'Discovery' },
];

function NewProjectModal({
  accounts,
  defaultAccountId,
  onClose,
  onSuccess,
}: {
  accounts: AccountSummary[];
  defaultAccountId?: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const navigate = useNavigate();
  const initialAccount = defaultAccountId ?? accounts[0]?.id ?? '';
  const [accountId, setAccountId] = useState(initialAccount);
  const [projectName, setProjectName] = useState('');
  const [kind, setKind] = useState<ProjectKind>('PHASE_2');
  const [startStage, setStartStage] = useState<CustomerStage>('LEAD');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasAccounts = useMemo(() => accounts.length > 0, [accounts]);

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const resp = await accountsApi.createProject(accountId, {
        projectName,
        projectKind: kind,
        startStage,
      });
      onSuccess();
      navigate(`/customers/${resp.projectId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create project');
    } finally {
      setSubmitting(false);
    }
  };

  if (!hasAccounts) {
    return (
      <Modal title="New Project" onClose={onClose} testid="new-project-modal">
        <p className="text-sm text-gray-700">
          You need to create a Customer first. Pick "New Customer" or "New Lead" from the menu.
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      title="New Project"
      onClose={onClose}
      testid="new-project-modal"
      footer={
        <SubmitRow
          onCancel={onClose}
          onSubmit={() => void submit()}
          disabled={!accountId || projectName.trim().length === 0 || submitting}
          submitting={submitting}
          submitLabel="Create project"
          submitTestid="new-project-submit"
        />
      }
    >
      <div className="space-y-3">
        <Field label="Account">
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            data-testid="new-project-account"
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-200"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Project name">
          <Input
            value={projectName}
            onChange={setProjectName}
            placeholder="Subsidiary onboarding"
            testid="new-project-name"
          />
        </Field>
        <Field label="Project kind">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as ProjectKind)}
            data-testid="new-project-kind"
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-200"
          >
            {KIND_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Start at stage">
          <select
            value={startStage}
            onChange={(e) => setStartStage(e.target.value as CustomerStage)}
            data-testid="new-project-stage"
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-200"
          >
            {STAGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </Field>
        {error && (
          <p className="text-xs text-rose-600" data-testid="new-project-error">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

// ─── Reusable bits ───────────────────────────────────────────────────────

function Modal({
  title,
  onClose,
  children,
  footer,
  testid,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  testid: string;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid={testid}
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            data-testid={`${testid}-close`}
            className="text-gray-400 hover:text-gray-900 rounded p-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="px-5 py-3 bg-gray-50 border-t border-gray-100">{footer}</div>}
      </div>
    </div>
  );
}

function SubmitRow({
  onCancel,
  onSubmit,
  disabled,
  submitting,
  submitLabel,
  submitTestid,
}: {
  onCancel: () => void;
  onSubmit: () => void;
  disabled: boolean;
  submitting: boolean;
  submitLabel: string;
  submitTestid: string;
}) {
  return (
    <div className="flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onSubmit}
        disabled={disabled}
        data-testid={submitTestid}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {submitting && <Loader2 className="h-3 w-3 animate-spin" />}
        {submitLabel}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  type = 'text',
  testid,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  testid?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      data-testid={testid}
      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-200"
    />
  );
}

function ModeToggle({
  active,
  onClick,
  children,
  testid,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testid: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      className={cn(
        'rounded-full px-2.5 py-1 text-xs font-semibold border',
        active
          ? 'bg-brand-50 text-brand-700 border-brand-200'
          : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300',
      )}
    >
      {children}
    </button>
  );
}
