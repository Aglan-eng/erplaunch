import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL
    ? `${import.meta.env.VITE_API_URL}/api/v1`
    : '/api/v1',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

// ─── Auth ───────────────────────────────────────────────────────────────────

export const authApi = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }).then((r) => r.data.data),

  register: (input: {
    firmName: string;
    firmSlug: string;
    adminName: string;
    adminEmail: string;
    password: string;
  }) => api.post('/auth/register', input).then((r) => r.data.data),

  logout: () => api.post('/auth/logout').then((r) => r.data),

  me: () => api.get('/auth/me').then((r) => r.data.data),

  // Phase 16 — password reset
  requestReset: (email: string) =>
    api.post('/auth/request-reset', { email }).then((r) => r.data),

  resetPassword: (input: { token: string; password: string }) =>
    api.post('/auth/reset-password', input).then((r) => r.data),

  changePassword: (input: { currentPassword: string; newPassword: string }) =>
    api.post('/auth/change-password', input).then((r) => r.data),

  // Phase 19 — email verification
  verifyEmail: (token: string) =>
    api.post('/auth/verify-email', { token }).then((r) => r.data),

  requestEmailVerification: () =>
    api.post('/auth/request-email-verification').then((r) => r.data),

  // Phase 21 — Google OAuth. Probe is a lightweight GET that returns
  // {available: boolean} so the UI can hide the button when the API
  // hasn't been configured with Google credentials.
  googleAvailable: () =>
    api.get<{ data: { available: boolean } }>('/auth/google/available')
      .then((r) => r.data.data.available)
      .catch(() => false),

  /**
   * Returns the absolute URL to start the Google OAuth flow. We expose
   * this as a getter (not a method that POSTs) because the browser must
   * NAVIGATE to this URL — fetch/XHR can't follow Google's redirect to
   * the consent screen. Use as `<a href={authApi.googleStartUrl()}>`.
   */
  googleStartUrl: () => {
    const base = import.meta.env.VITE_API_URL ?? '';
    return `${base}/api/v1/auth/google/start`;
  },
};

// ─── Engagements ─────────────────────────────────────────────────────────────

export const engagementsApi = {
  // Phase 37.1 — opt in to ARCHIVED via includeArchived: true. Default
  // (false) keeps the dashboard tidy.
  list: (opts?: { includeArchived?: boolean }) =>
    api
      .get('/engagements', { params: opts?.includeArchived ? { includeArchived: 'true' } : undefined })
      .then((r) => r.data.data),

  create: (input: { clientName: string; adaptorId?: string }) =>
    api.post('/engagements', input).then((r) => r.data.data),

  // Phase 37.1 — soft-archive endpoints. Pair with the kebab menu in
  // WizardTopBar.
  archive: (id: string) =>
    api.post(`/engagements/${id}/archive`).then((r) => r.data.data),

  unarchive: (id: string) =>
    api.post(`/engagements/${id}/unarchive`).then((r) => r.data.data),

  get: (id: string) =>
    api.get(`/engagements/${id}`).then((r) => r.data.data),

  // Generator catalog from the active adaptor (built-in or custom). Phase 3D:
  // surfaces the list the consultant is allowed to trigger without hard-coding
  // NetSuite-only job types in the SPA.
  getGenerators: (id: string) =>
    api.get<{ data: Array<{ id: string; label: string; kind: string; outputMime: string; description?: string }> }>(
      `/engagements/${id}/generators`,
    ).then((r) => r.data.data),

  // Full PlatformAdaptor for this engagement (manifest + schema + license +
  // phases + generators). Phase 3: wizard reads this instead of bundling
  // NetSuite questions statically.
  getAdaptor: (id: string) =>
    api.get(`/engagements/${id}/adaptor`).then((r) => r.data.data as {
      id: string;
      source: 'built-in' | 'custom';
      manifest: Record<string, unknown>;
      schema: { version: string; flows: Array<{ id: string; label: string; sections: Array<{ id: string; label: string; order: number; questions: Array<Record<string, unknown>> }> }> };
      license: Record<string, unknown>;
      phases: Record<string, unknown>;
      generators: Array<Record<string, unknown>>;
      rules?: { id: string; version: string; rules: Array<Record<string, unknown>> };
    }),

  patch: (id: string, data: { status?: string; clientName?: string; startDate?: string | null; contractEndDate?: string | null }) =>
    api.patch(`/engagements/${id}`, data).then((r) => r.data.data),

  delete: (id: string) =>
    api.delete(`/engagements/${id}`),

  // Members
  getMembers: (id: string) =>
    api.get(`/engagements/${id}/members`).then((r) => r.data.data),

  addMember: (id: string, data: { name: string; role: string; team?: string; email?: string; phone?: string }) =>
    api.post(`/engagements/${id}/members`, data).then((r) => r.data.data),

  deleteMember: (id: string, memberId: string) =>
    api.delete(`/engagements/${id}/members/${memberId}`).then((r) => r.data.data),

  updateMember: (id: string, memberId: string, data: { name?: string; role?: string; team?: string; email?: string | null; phone?: string | null }) =>
    api.patch(`/engagements/${id}/members/${memberId}`, data).then((r) => r.data.data),

  // Profile
  getProfile: (id: string) =>
    api.get(`/engagements/${id}/profile`).then((r) => r.data.data),

  patchProfile: (id: string, answers: Record<string, unknown>) =>
    api.patch(`/engagements/${id}/profile`, { answers }).then((r) => r.data.data),

  // Alias for clarity
  saveAnswers: (id: string, answers: Record<string, unknown>) =>
    api.patch(`/engagements/${id}/profile`, { answers }).then((r) => r.data.data),

  // License
  getLicense: (id: string) =>
    api.get(`/engagements/${id}/license`).then((r) => r.data.data),

  putLicense: (id: string, data: { edition: string; modules: string[] }) =>
    api.put(`/engagements/${id}/license`, data).then((r) => r.data.data),

  // Phases
  getPhases: (id: string) =>
    api.get(`/engagements/${id}/phases`).then((r) => r.data.data),

  putPhases: (id: string, phases: unknown[]) =>
    api.put(`/engagements/${id}/phases`, phases).then((r) => r.data.data),

  // Jobs
  createJob: (id: string, type: string) =>
    api.post(`/engagements/${id}/generate`, { type }).then((r) => r.data.data),

  listJobs: (id: string) =>
    api.get(`/engagements/${id}/jobs`).then((r) => r.data.data),

  getJob: (id: string, jobId: string) =>
    api.get(`/engagements/${id}/jobs/${jobId}`).then((r) => r.data.data),

  // Phase 39.3 — deliverable browser. listJobFiles returns the JSON tree;
  // jobFileUrl returns a URL the browser can hit directly (used by <iframe>
  // for HTML preview and by <a download> for binary download).
  listJobFiles: (id: string, jobId: string) =>
    api
      .get<{ data: { name: string; type: 'dir' | 'file'; size?: number; children?: unknown[] } }>(
        `/engagements/${id}/jobs/${jobId}/files`,
      )
      .then((r) => r.data.data),

  jobFileUrl: (id: string, jobId: string, relPath: string): string => {
    const base = api.defaults.baseURL ?? '/api/v1';
    const encoded = relPath.split('/').map(encodeURIComponent).join('/');
    return `${base}/engagements/${id}/jobs/${jobId}/files/${encoded}`;
  },

  // Comments
  getComments: (id: string) =>
    api.get(`/engagements/${id}/comments`).then((r) => r.data.data),

  putComment: (id: string, sectionKey: string, text: string) =>
    api.put(`/engagements/${id}/comments/${sectionKey}`, { text }).then((r) => r.data.data),

  // Images
  getImages: (id: string) =>
    api.get(`/engagements/${id}/images`).then((r) => r.data.data),

  uploadImage: (id: string, sectionKey: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('sectionKey', sectionKey);
    return api.post(`/engagements/${id}/images`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data.data);
  },

  deleteImage: (id: string, imageId: string) =>
    api.delete(`/engagements/${id}/images/${imageId}`).then((r) => r.data.data),

  // AI Advice
  getAdvice: (id: string, sectionKey: string) =>
    api.get(`/engagements/${id}/ai-advice/${sectionKey}`).then((r) => r.data.data),

  getAllAdvice: (id: string) =>
    api.get(`/engagements/${id}/ai-advice`).then((r) => r.data.data),

  generateAdvice: (id: string, sectionKey: string) =>
    api.post(`/engagements/${id}/ai-advice/${sectionKey}`).then((r) => r.data.data),

  // AI Profile Generation
  generateProfile: (id: string, data: { industry: string; companySize: string; country: string; additionalContext?: string }) =>
    api.post(`/engagements/${id}/generate-profile`, data).then((r) => r.data.data),

  suggestAnswers: (id: string, sectionKey: string, data: { industry: string; companySize: string; country: string }) =>
    api.post(`/engagements/${id}/suggest-answers/${sectionKey}`, data).then((r) => r.data.data),

  // Risks
  listRisks: (id: string) =>
    api.get(`/engagements/${id}/risks`).then((r) => r.data.data),

  createRisk: (id: string, data: object) =>
    api.post(`/engagements/${id}/risks`, data).then((r) => r.data.data),

  updateRisk: (id: string, riskId: string, data: object) =>
    api.patch(`/engagements/${id}/risks/${riskId}`, data).then((r) => r.data.data),

  deleteRisk: (id: string, riskId: string) =>
    api.delete(`/engagements/${id}/risks/${riskId}`).then((r) => r.data.data),

  // Issues
  listIssues: (id: string) =>
    api.get(`/engagements/${id}/issues`).then((r) => r.data.data),

  createIssue: (id: string, data: object) =>
    api.post(`/engagements/${id}/issues`, data).then((r) => r.data.data),

  updateIssue: (id: string, issueId: string, data: object) =>
    api.patch(`/engagements/${id}/issues/${issueId}`, data).then((r) => r.data.data),

  deleteIssue: (id: string, issueId: string) =>
    api.delete(`/engagements/${id}/issues/${issueId}`).then((r) => r.data.data),

  // Decisions
  listDecisions: (id: string) =>
    api.get(`/engagements/${id}/decisions`).then((r) => r.data.data),

  createDecision: (id: string, data: object) =>
    api.post(`/engagements/${id}/decisions`, data).then((r) => r.data.data),

  updateDecision: (id: string, decId: string, data: object) =>
    api.patch(`/engagements/${id}/decisions/${decId}`, data).then((r) => r.data.data),

  deleteDecision: (id: string, decId: string) =>
    api.delete(`/engagements/${id}/decisions/${decId}`).then((r) => r.data.data),

  // Phase 36 — flip clientSignoffStatus from NONE → PENDING so the decision
  // surfaces on the client portal. 409 on any other transition.
  requestDecisionSignoff: (id: string, decId: string) =>
    api.post(`/engagements/${id}/decisions/${decId}/request-signoff`).then((r) => r.data.data),

  // Meetings
  listMeetings: (id: string) =>
    api.get(`/engagements/${id}/meetings`).then((r) => r.data.data),

  createMeeting: (id: string, data: object) =>
    api.post(`/engagements/${id}/meetings`, data).then((r) => r.data.data),

  updateMeeting: (id: string, meetingId: string, data: object) =>
    api.patch(`/engagements/${id}/meetings/${meetingId}`, data).then((r) => r.data.data),

  deleteMeeting: (id: string, meetingId: string) =>
    api.delete(`/engagements/${id}/meetings/${meetingId}`).then((r) => r.data.data),

  // Migration
  listMigrationItems: (id: string) =>
    api.get(`/engagements/${id}/migration`).then((r) => r.data.data),

  createMigrationItem: (id: string, data: object) =>
    api.post(`/engagements/${id}/migration`, data).then((r) => r.data.data),

  updateMigrationItem: (id: string, itemId: string, data: object) =>
    api.patch(`/engagements/${id}/migration/${itemId}`, data).then((r) => r.data.data),

  deleteMigrationItem: (id: string, itemId: string) =>
    api.delete(`/engagements/${id}/migration/${itemId}`).then((r) => r.data.data),

  // Activity
  listActivity: (id: string) =>
    api.get(`/engagements/${id}/activity`).then((r) => r.data.data),

  // Phase 46.8.3 — alias the listActivity surface as getActivity so
  // sales-side pages reading activity follow the same naming as the
  // closeoutApi.list / threadsApi.list family. Returns the same array
  // shape; the alias exists purely for call-site readability.
  getActivity: (id: string) =>
    api.get(`/engagements/${id}/activity`).then((r) => r.data.data),

  // Phase 46.8.3 — manual activity-log entry. The server enforces
  // a whitelist (NOTE/OBSERVATION/TODO/DECISION + PROPOSAL_*); the
  // sales lifecycle UIs use this to mark proposal SENT/ACCEPTED/
  // DECLINED transitions.
  logActivity: (
    id: string,
    action: string,
    detail: string,
  ) =>
    api
      .post(`/engagements/${id}/activity`, {
        action,
        detail: detail.trim() || action,
      })
      .then((r) => r.data.data),

  // Phase 28 — Pending Submissions (consultant side). The client-side
  // POST /portal/submissions hangs off the portal session, not this API
  // surface, and is added in Phase 29 when the first interactive client
  // capture flow ships.
  listPendingSubmissions: (id: string, status?: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'ALL') => {
    const qs = status ? `?status=${status}` : '';
    return api.get(`/engagements/${id}/pending-submissions${qs}`).then((r) => r.data.data);
  },

  acceptPendingSubmission: (id: string, submissionId: string, comment?: string) =>
    api
      .post(`/engagements/${id}/pending-submissions/${submissionId}/accept`, { comment })
      .then((r) => r.data.data),

  rejectPendingSubmission: (id: string, submissionId: string, comment?: string) =>
    api
      .post(`/engagements/${id}/pending-submissions/${submissionId}/reject`, { comment })
      .then((r) => r.data.data),

  // Phase 31 — Conversation threads + messages (consultant side)
  listThreads: (id: string) =>
    api.get(`/engagements/${id}/threads`).then((r) => r.data.data),
  createThread: (id: string, input: { subject: string; body: string }) =>
    api.post(`/engagements/${id}/threads`, input).then((r) => r.data.data),
  getThread: (id: string, threadId: string) =>
    api.get(`/engagements/${id}/threads/${threadId}`).then((r) => r.data.data),
  postThreadMessage: (id: string, threadId: string, body: string) =>
    api
      .post(`/engagements/${id}/threads/${threadId}/messages`, { body })
      .then((r) => r.data.data),
  patchThreadStatus: (id: string, threadId: string, status: 'OPEN' | 'RESOLVED') =>
    api.patch(`/engagements/${id}/threads/${threadId}`, { status }).then((r) => r.data.data),

  // Answer templates (copy from another engagement)
  copyAnswers: (id: string, sourceEngagementId: string) =>
    api.post(`/engagements/${id}/copy-answers`, { sourceEngagementId }).then((r) => r.data.data),

  // Portal settings
  getPortalSettings: (id: string) =>
    api.get(`/engagements/${id}/portal-settings`).then((r) => r.data.data),

  patchPortalSettings: (id: string, settings: Record<string, unknown>) =>
    api.patch(`/engagements/${id}/portal-settings`, settings).then((r) => r.data.data),

  // Portal token
  generatePortalToken: (id: string) =>
    api.post(`/engagements/${id}/portal-token`).then((r) => r.data.data),

  // Portal invites — sends email to all CLIENT members with email addresses
  sendPortalInvites: (id: string) =>
    api.post(`/engagements/${id}/portal-invites`).then((r) => r.data.data),

  // Portal Todos (consultant CRUD)
  listPortalTodos: (id: string) =>
    api.get(`/engagements/${id}/portal-todos`).then((r) => r.data.data),

  createPortalTodo: (id: string, data: { title: string; description?: string; dueDate?: string; assignedTo?: string; priority?: string }) =>
    api.post(`/engagements/${id}/portal-todos`, data).then((r) => r.data.data),

  updatePortalTodo: (id: string, todoId: string, data: object) =>
    api.patch(`/engagements/${id}/portal-todos/${todoId}`, data).then((r) => r.data.data),

  deletePortalTodo: (id: string, todoId: string) =>
    api.delete(`/engagements/${id}/portal-todos/${todoId}`).then((r) => r.data.data),

  // Vertical Workspaces
  listVerticalWorkspaces: (id: string) =>
    api.get(`/engagements/${id}/vertical-workspaces`).then((r) => r.data.data),

  createVerticalWorkspace: (id: string, data: { verticalType: string; verticalSettings?: Record<string, unknown> }) =>
    api.post(`/engagements/${id}/vertical-workspaces`, data).then((r) => r.data.data),

  getVerticalSettings: (id: string) =>
    api.get(`/engagements/${id}/vertical-settings`).then((r) => r.data.data),

  patchVerticalSettings: (id: string, settings: Record<string, unknown>) =>
    api.patch(`/engagements/${id}/vertical-settings`, settings).then((r) => r.data.data),

  // Data Collection
  listDataCollection: (id: string) =>
    api.get(`/engagements/${id}/data-collection`).then((r) => r.data.data),

  updateDataCollectionItem: (id: string, itemId: string, data: Record<string, unknown>) =>
    api.patch(`/engagements/${id}/data-collection/${itemId}`, data).then((r) => r.data.data),

  deleteDataCollectionItem: (id: string, itemId: string) =>
    api.delete(`/engagements/${id}/data-collection/${itemId}`).then((r) => r.data.data),

  getDataTemplateDownloadUrl: (id: string, itemId: string) => {
    const base = import.meta.env.VITE_API_URL ?? '';
    return `${base}/api/v1/engagements/${id}/data-collection/${itemId}/download`;
  },

  uploadDataFile: (id: string, itemId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post(`/engagements/${id}/data-collection/${itemId}/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data.data);
  },

  listDataFiles: (id: string, itemId: string) =>
    api.get(`/engagements/${id}/data-collection/${itemId}/files`).then((r) => r.data.data),

  validateDataFile: (id: string, itemId: string, fileId: string) =>
    api.post(`/engagements/${id}/data-collection/${itemId}/files/${fileId}/validate`).then((r) => r.data.data),

  deleteDataFile: (id: string, itemId: string, fileId: string) =>
    api.delete(`/engagements/${id}/data-collection/${itemId}/files/${fileId}`).then((r) => r.data.data),

  markDataUploaded: (id: string, itemId: string) =>
    api.patch(`/engagements/${id}/data-collection/${itemId}/mark-uploaded`).then((r) => r.data.data),

  // Data Template Schemas (AI-generated)
  listDataTemplateSchemas: (id: string) =>
    api.get(`/engagements/${id}/data-templates/schemas`).then((r) => r.data.data),

  generateDataTemplates: (id: string) =>
    api.post(`/engagements/${id}/data-templates/generate`).then((r) => r.data.data),

  generateCustomTemplate: (id: string, data: { requirements: string; answers?: Record<string, string> }) =>
    api.post(`/engagements/${id}/data-templates/custom`, data).then((r) => r.data.data),

  deleteDataTemplateSchema: (id: string, schemaId: string) =>
    api.delete(`/engagements/${id}/data-templates/schemas/${schemaId}`).then((r) => r.data.data),
};

// ─── Portal API (Phase 29) ──────────────────────────────────────────────────
//
// Client-side calls authenticated via the portal_token HttpOnly cookie.
// Same axios instance — the browser sends the cookie automatically with
// same-origin fetches; no Authorization header needed.

export const portalApi = {
  /** Phase 29 — list allowlisted-and-not-yet-answered questions for the
   *  authenticated client member of this engagement. */
  listPendingQuestions: (token: string) =>
    api.get(`/engagements/portal/${token}/questions`).then((r) => r.data.data),

  /** Phase 29 — submit a wizard answer for review. Lands as PENDING in
   *  PendingSubmission; consultant accepts to merge into BusinessProfile.answers. */
  submitWizardAnswer: (questionId: string, answer: unknown) =>
    api
      .post('/portal/submissions', {
        targetType: 'WIZARD_ANSWER',
        payload: { questionId, answer },
      })
      .then((r) => r.data.data),

  /** Phase 30 — upload a file to portal staging. Returns
   *  { stagedFileId, filename, originalName, mimeType, sizeBytes }. */
  uploadStagedFile: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api
      .post('/portal/data-files/staged', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data.data as {
        stagedFileId: string;
        filename: string;
        originalName: string;
        mimeType: string;
        sizeBytes: number;
      });
  },

  /** Phase 30 — submit a staged file against a DataCollectionItem for review. */
  submitDataFile: (input: {
    stagedFileId: string;
    dataCollectionItemId: string;
    originalFilename: string;
    sizeBytes: number;
  }) =>
    api
      .post('/portal/submissions', {
        targetType: 'DATA_FILE',
        payload: input,
      })
      .then((r) => r.data.data),

  // Phase 31 — Q&A threads (read-only client side)
  listThreads: (token: string) =>
    api.get(`/engagements/portal/${token}/threads`).then((r) => r.data.data),
  getThread: (token: string, threadId: string) =>
    api.get(`/engagements/portal/${token}/threads/${threadId}`).then((r) => r.data.data),
  /** Phase 31 — submit a Q&A message for review. threadId=null creates a
   *  new thread; subject is then required. */
  submitQaMessage: (input: { threadId: string | null; subject?: string; body: string }) =>
    api
      .post('/portal/submissions', {
        targetType: 'QA_MESSAGE',
        payload: input,
      })
      .then((r) => r.data.data),

  /** Phase 32 — list decisions awaiting client sign-off (NONE | PENDING). */
  listDecisions: (token: string) =>
    api.get(`/engagements/portal/${token}/decisions`).then((r) => r.data.data),

  /** Phase 32 — submit a sign-off (signed=true) or decline (signed=false). */
  submitDecisionSignoff: (input: { decisionItemId: string; signed: boolean; comment: string }) =>
    api
      .post('/portal/submissions', {
        targetType: 'DECISION_SIGNOFF',
        payload: input,
      })
      .then((r) => r.data.data),

  /** Phase 48.1 — submit a support ticket from the portal. Lands as a
   *  PENDING SUPPORT_TICKET submission; SLA team accept creates a real
   *  Ticket row. */
  submitSupportTicket: (input: {
    title: string;
    severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    description?: string;
  }) =>
    api
      .post('/portal/submissions', {
        targetType: 'SUPPORT_TICKET',
        payload: input,
      })
      .then((r) => r.data.data),

  /** Phase 45.4 — read the current closeout sign-off state. Shape:
   *    { ready: false, stage, reason }       — engagement not in CLOSEOUT
   *    { ready: true,  stage, status, signedBy, signedAt }  — in CLOSEOUT */
  getCloseoutSignoff: (token: string): Promise<
    | { ready: false; stage: string; reason: string }
    | { ready: true; stage: string; status: string; signedBy: string | null; signedAt: string | null }
  > =>
    api.get(`/engagements/portal/${token}/closeout-signoff`).then((r) => r.data.data),

  /** Phase 45.4 — flip CLIENT_SIGNOFF to DONE. The portal session
   *  identifies which client member signed off; their name lands in
   *  the checklist row's notes column. */
  postCloseoutSignoff: (token: string): Promise<{ status: string; signedBy: string; signedAt: string }> =>
    api.post(`/engagements/portal/${token}/closeout-signoff`).then((r) => r.data.data),
};

// ─── Adaptors (platform SPI, Phase 1B) ──────────────────────────────────────

export interface AdaptorListing {
  id: string;
  name: string;
  tagline?: string;
  version: string;
  vendor: string;
  capabilities: string[];
  sourceKind: 'built-in' | 'custom' | 'marketplace';
}

export const adaptorsApi = {
  list: () => api.get<{ data: AdaptorListing[] }>('/adaptors').then((r) => r.data.data),
  get: (id: string) =>
    api.get(`/adaptors/${encodeURIComponent(id)}`).then((r) => r.data.data),
};

// ─── Custom Adaptors (Phase 2 — firm-authored PlatformAdaptors) ─────────────

export type CustomAdaptorStatus = 'DRAFT' | 'PARSING' | 'READY' | 'PUBLISHED' | 'FAILED' | 'ARCHIVED';

export interface CustomAdaptor {
  id: string;
  firmId: string;
  name: string;
  slug: string;
  status: CustomAdaptorStatus;
  sourceDocuments: Array<{ filename: string; originalName: string; mimeType: string; size: number; uploadedAt: string }>;
  parsedManifest: unknown;
  parsedSchema: unknown;
  parsedLicense: unknown;
  parsedPhases: unknown;
  parsedGenerators: unknown;
  parsedRules: unknown;
  parseError: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const customAdaptorsApi = {
  list: () => api.get<{ data: CustomAdaptor[] }>('/custom-adaptors').then((r) => r.data.data),

  create: (input: { name: string; slug: string }) =>
    api.post<{ data: CustomAdaptor }>('/custom-adaptors', input).then((r) => r.data.data),

  get: (id: string) =>
    api.get<{ data: CustomAdaptor }>(`/custom-adaptors/${id}`).then((r) => r.data.data),

  uploadDocument: (id: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post<{ data: CustomAdaptor }>(`/custom-adaptors/${id}/documents`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data.data);
  },

  parse: (id: string) =>
    api.post<{ data: { id: string; status: string } }>(`/custom-adaptors/${id}/parse`).then((r) => r.data.data),

  updateDraft: (id: string, patch: Partial<{ manifest: unknown; schema: unknown; license: unknown; phases: unknown; generators: unknown; rules: unknown }>) =>
    api.patch<{ data: CustomAdaptor }>(`/custom-adaptors/${id}/draft`, patch).then((r) => r.data.data),

  publish: (id: string) =>
    api.post<{ data: CustomAdaptor }>(`/custom-adaptors/${id}/publish`).then((r) => r.data.data),

  archive: (id: string) => api.post(`/custom-adaptors/${id}/archive`),
};

// ─── Verticals ────────────────────────────────────────────────────────────────

export const verticalsApi = {
  list: () => api.get('/verticals').then((r) => r.data.data),
  get: (id: string) => api.get(`/verticals/${id}`).then((r) => r.data.data),
};

// ─── Phase 43.4 — Team / Roles ──────────────────────────────────────────────

export interface TeamMember {
  id: string;
  email: string;
  name: string;
  firmRoles: string[];
}

export interface EngagementRoleAssignmentRow {
  userId: string;
  role: string;
  assignedModules: string[] | null;
}

export interface RoleAuditEntry {
  id: string;
  firmId: string;
  actorUserId: string;
  targetUserId: string;
  action: 'ROLE_GRANTED' | 'ROLE_REVOKED';
  role: string;
  scope: string;
  createdAt: string;
}

// Phase 45.1 — Closeout checklist API.
export type CloseoutChecklistStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'DONE' | 'NA';
export type CloseoutChecklistKey =
  | 'KNOWLEDGE_TRANSFER' | 'SYSTEM_CATALOG_REVIEWED' | 'INTEGRATION_LIST_CONFIRMED'
  | 'SUPPORT_CONTACTS_ASSIGNED' | 'SLA_TERMS_AGREED' | 'FINAL_INVOICE_PAID'
  | 'PRODUCTION_STABLE' | 'CLIENT_SIGNOFF' | 'SLA_TEAM_ACCEPT';

export interface CloseoutChecklistItem {
  id: string;
  engagementId: string;
  key: CloseoutChecklistKey;
  status: CloseoutChecklistStatus;
  completedBy: string | null;
  completedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Sales pipeline (Phase 46.1) ─────────────────────────────────────────────

export type PipelineColumn =
  | 'NEW'
  | 'QUALIFIED'
  | 'DISCOVERY_LITE'
  | 'PROPOSAL_SENT'
  | 'NEGOTIATION'
  | 'WON'
  | 'LOST';

export type LeadSource = 'WEBSITE' | 'REFERRAL' | 'OUTBOUND' | 'EVENT' | 'OTHER';

export type SalesStage = 'PROSPECT' | 'PROPOSED' | 'CONTRACTED' | 'WON' | 'LOST';

export interface PipelineEntry {
  id: string;
  clientName: string;
  status: SalesStage;
  leadSource: LeadSource | null;
  prospectScore: number | null;
  estimatedValue: number | null;
  estimatedCloseDate: string | null;
  lostReason: string | null;
  salesRepUserId: string | null;
  updatedAt: string;
  createdAt: string;
  column: PipelineColumn;
  daysInStage: number;
}

export const salesApi = {
  /** Phase 46.1 — list deals at sales stages, filtered by visibility. */
  listPipeline: (): Promise<PipelineEntry[]> =>
    api.get('/sales/pipeline').then((r) => r.data.data),

  /** Phase 46.1 — quick-add a PROSPECT engagement. */
  createProspect: (input: {
    clientName: string;
    leadSource?: LeadSource | null;
    salesRepUserId?: string | null;
    estimatedValue?: number | null;
    estimatedCloseDate?: string | null;
  }): Promise<PipelineEntry> =>
    api.post('/sales/prospects', input).then((r) => r.data.data),

  /** Phase 46.1 — drag-drop transition between sales stages. */
  setProspectStage: (id: string, status: SalesStage): Promise<PipelineEntry> =>
    api.patch(`/sales/prospects/${id}/stage`, { status }).then((r) => r.data.data),
};

// ─── Sales reports (Phase 46.8.5) ───────────────────────────────────────────

export interface FunnelStage {
  stage: string;
  count: number;
  totalEstimatedValue: number;
}

export interface FunnelReport {
  stages: FunnelStage[];
  totalWon: number;
  totalLost: number;
  winRate: number;
}

export interface LeaderboardEntry {
  salesRepUserId: string;
  dealsWon: number;
  dealsLost: number;
  revenueClosed: number;
  avgDealSize: number;
  winRate: number;
  medianSalesCycleDays: number | null;
}

export interface LossReasonBreakdownEntry {
  count: number;
  pct: number;
  totalEstimatedValue: number;
}

export interface LossReasonsReport {
  breakdown: {
    total: number;
    byReason: Record<string, LossReasonBreakdownEntry>;
  };
  recentLosses: Array<{
    engagementId: string;
    clientName: string;
    lossReason: string;
    competitorName: string | null;
    notes: string | null;
    estimatedValue: number | null;
    lostAt: string | null;
    recordedAt: string;
  }>;
}

export interface TimeToCloseReport {
  median: number | null;
  p90: number | null;
  histogram: Array<{ bucket: string; count: number }>;
}

export const salesReportsApi = {
  funnel: (): Promise<FunnelReport> =>
    api.get('/sales/reports/funnel').then((r) => r.data.data),
  leaderboard: (): Promise<LeaderboardEntry[]> =>
    api.get('/sales/reports/leaderboard').then((r) => r.data.data),
  lossReasons: (): Promise<LossReasonsReport> =>
    api.get('/sales/reports/loss-reasons').then((r) => r.data.data),
  timeToClose: (): Promise<TimeToCloseReport> =>
    api.get('/sales/reports/time-to-close').then((r) => r.data.data),

  /** Phase 46.8.7 — fetch the report as a PDF blob. The route streams
   *  application/pdf with a Content-Disposition filename; the caller
   *  is expected to wire the blob into a download anchor. */
  exportPdf: (): Promise<{ blob: Blob; filename: string }> =>
    api
      .post('/sales/reports/export-pdf', undefined, {
        responseType: 'blob',
      })
      .then((r) => {
        const cd = (r.headers['content-disposition'] as string | undefined) ?? '';
        const m = cd.match(/filename="?([^"]+)"?/);
        const filename = m?.[1] ?? 'Sales_Performance.pdf';
        return { blob: r.data as Blob, filename };
      }),
};

// ─── SOW signatures (Phase 46.8.4) ──────────────────────────────────────────

export type SowSignatureStatus =
  | 'DRAFT'
  | 'SENT'
  | 'VIEWED'
  | 'SIGNED'
  | 'DECLINED'
  | 'EXPIRED';

export type SowSignaturePath = 'DOCUSIGN' | 'MANUAL';

export interface SowSignature {
  id: string;
  engagementId: string;
  sowVersionId: string;
  signaturePath: SowSignaturePath;
  docusignEnvelopeId: string | null;
  signedFileUrl: string | null;
  status: SowSignatureStatus;
  sentAt: string | null;
  signedAt: string | null;
  declinedAt: string | null;
  signedByName: string | null;
  signedByEmail: string | null;
  signedByTitle: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SowSignaturesResponse {
  signatures: SowSignature[];
  docusignConfigured: boolean;
}

export const sowSignatureApi = {
  /** Phase 46.8.4 — list all signature attempts for an engagement. */
  list: (engagementId: string): Promise<SowSignaturesResponse> =>
    api.get(`/engagements/${engagementId}/sow-signatures`).then((r) => r.data.data),

  /** Phase 46.8.4 — send the latest SOW for DocuSign signing. Refused
   *  with 409 DOCUSIGN_NOT_CONFIGURED when env is missing. */
  sendDocuSign: (
    engagementId: string,
    input: { signerName: string; signerEmail: string; signerTitle?: string; emailSubject?: string },
  ): Promise<SowSignature> =>
    api
      .post(`/engagements/${engagementId}/sow-signatures/docusign`, input)
      .then((r) => r.data.data),

  /** Phase 46.8.4 — register a manually-signed PDF. fileBase64 is
   *  the PDF bytes encoded as base64; the route caps at 10MB. */
  uploadManual: (
    engagementId: string,
    input: {
      fileBase64: string;
      signedByName: string;
      signedByEmail?: string;
      signedByTitle?: string;
      signedDate?: string;
    },
  ): Promise<SowSignature> =>
    api
      .post(`/engagements/${engagementId}/sow-signatures/manual-upload`, input)
      .then((r) => r.data.data),
};

// ─── Discovery Lite (Phase 46.8.1) ──────────────────────────────────────────

export type DiscoveryLiteQuestionType =
  | 'text'
  | 'long_text'
  | 'single_select'
  | 'multi_select'
  | 'number';

export interface DiscoveryLiteOption {
  value: string;
  label: string;
}

export interface DiscoveryLiteQuestion {
  id: string;
  label: string;
  helpText?: string;
  type: DiscoveryLiteQuestionType;
  required?: boolean;
  options?: ReadonlyArray<DiscoveryLiteOption>;
  adaptorAware?: boolean;
  min?: number;
  max?: number;
}

export interface DiscoveryLiteRecord {
  engagementId: string;
  answers: Record<string, unknown>;
  completedAt: string | null;
  shareToken: string | null;
  shareTokenIssuedAt: string | null;
  shareTokenExpiresAt: string | null;
  lastEditedBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface DiscoveryLiteResponse {
  questions: DiscoveryLiteQuestion[];
  record: DiscoveryLiteRecord;
}

export const discoveryLiteApi = {
  /** Phase 46.8.1 — get the catalog + current record for an engagement. */
  get: (engagementId: string): Promise<DiscoveryLiteResponse> =>
    api.get(`/engagements/${engagementId}/discovery-lite`).then((r) => r.data.data),

  /** Phase 46.8.1 — save a partial answer set (debounced auto-save). */
  put: (engagementId: string, answers: Record<string, unknown>): Promise<DiscoveryLiteRecord> =>
    api.put(`/engagements/${engagementId}/discovery-lite`, { answers }).then((r) => r.data.data),

  /** Phase 46.8.1 — mark complete; refuses with 409 + missingFields when incomplete. */
  complete: (engagementId: string): Promise<DiscoveryLiteRecord> =>
    api.post(`/engagements/${engagementId}/discovery-lite/complete`).then((r) => r.data.data),

  /** Phase 46.8.2 — mint a self-serve token for the prospect's contact. */
  mintShareToken: (engagementId: string): Promise<{ token: string; expiresAt: string }> =>
    api.post(`/engagements/${engagementId}/discovery-lite/share-token`).then((r) => r.data.data),

  /** Phase 46.8.2 — revoke an outstanding self-serve link. */
  revokeShareToken: (engagementId: string): Promise<DiscoveryLiteRecord> =>
    api.delete(`/engagements/${engagementId}/discovery-lite/share-token`).then((r) => r.data.data),

  /** Phase 46.8.2 — portal-side fetch (no auth, opaque token).
   *  Phase 48.4 — extended to include firm branding + sales-rep name
   *  so the self-serve page can render the firm's brand and the
   *  confirmation screen can name the rep ("<rep> will be in touch"). */
  getByToken: (
    token: string,
  ): Promise<{
    questions: DiscoveryLiteQuestion[];
    clientName: string;
    answers: Record<string, unknown>;
    completedAt: string | null;
    branding: {
      displayName: string;
      logoUrl: string | null;
      primaryColor: string;
      secondaryColor: string;
      supportEmail: string | null;
    } | null;
    salesRepName: string | null;
  }> => api.get(`/discovery-lite/${token}`).then((r) => r.data.data),

  /** Phase 46.8.2 — portal-side save. */
  putByToken: (
    token: string,
    answers: Record<string, unknown>,
  ): Promise<{ answers: Record<string, unknown>; completedAt: string | null }> =>
    api.put(`/discovery-lite/${token}`, { answers }).then((r) => r.data.data),

  /** Phase 46.8.2 — portal-side complete. */
  completeByToken: (token: string): Promise<{ completedAt: string }> =>
    api.post(`/discovery-lite/${token}/complete`).then((r) => r.data.data),
};

/**
 * Phase 46.8.1 — pure helpers for the Discovery Lite wizard.
 *
 * Both consultant + portal flows use the same per-question rendering
 * + answer-validity rules, so the predicates live here and the
 * component just consumes them.
 */
export function isDiscoveryLiteAnswerEmpty(
  question: Pick<DiscoveryLiteQuestion, 'type'>,
  value: unknown,
): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (question.type === 'number') {
    return typeof value !== 'number' || !Number.isFinite(value);
  }
  return false;
}

/**
 * True when an answer is present + (for selects) a known option value.
 * Used to disable "Next" until the current step is filled.
 */
export function isDiscoveryLiteAnswerValid(
  question: DiscoveryLiteQuestion,
  value: unknown,
): boolean {
  if (isDiscoveryLiteAnswerEmpty(question, value)) return false;
  if (question.type === 'single_select') {
    if (typeof value !== 'string') return false;
    if (question.adaptorAware) return true;
    return question.options?.some((o) => o.value === value) ?? false;
  }
  if (question.type === 'multi_select') {
    if (!Array.isArray(value)) return false;
    if (question.adaptorAware) return value.every((v) => typeof v === 'string');
    const allowed = new Set((question.options ?? []).map((o) => o.value));
    return value.every((v) => typeof v === 'string' && allowed.has(v));
  }
  if (question.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    if (question.min !== undefined && value < question.min) return false;
    if (question.max !== undefined && value > question.max) return false;
    return true;
  }
  // text / long_text — non-empty already guaranteed by the empty check.
  return true;
}

/**
 * Whole-number progress out of 100. Counts answers that are present and
 * type-valid; required questions count the same as optional ones so the
 * bar moves predictably even when the operator skips around.
 */
export function discoveryLiteProgressPct(
  questions: ReadonlyArray<DiscoveryLiteQuestion>,
  answers: Record<string, unknown>,
): number {
  if (questions.length === 0) return 0;
  let filled = 0;
  for (const q of questions) {
    if (isDiscoveryLiteAnswerValid(q, answers[q.id])) filled++;
  }
  return Math.round((filled / questions.length) * 100);
}

export const closeoutApi = {
  list: (engagementId: string): Promise<CloseoutChecklistItem[]> =>
    api.get(`/engagements/${engagementId}/closeout-checklist`).then((r) => r.data.data),
  patch: (engagementId: string, key: CloseoutChecklistKey, body: { status?: CloseoutChecklistStatus; notes?: string | null }): Promise<CloseoutChecklistItem> =>
    api.patch(`/engagements/${engagementId}/closeout-checklist/${key}`, body).then((r) => r.data.data),
};

export const teamApi = {
  listTeam: (): Promise<TeamMember[]> =>
    api.get('/firm/team').then((r) => r.data.data),
  grantFirmRole: (userId: string, role: string): Promise<{ ok: true }> =>
    api.post('/firm/roles', { userId, role }).then((r) => r.data.data),
  revokeFirmRole: (userId: string, role: string): Promise<{ ok: true }> =>
    api.delete('/firm/roles', { data: { userId, role } }).then((r) => r.data.data),

  listEngagementRoles: (engagementId: string): Promise<EngagementRoleAssignmentRow[]> =>
    api.get(`/engagements/${engagementId}/roles`).then((r) => r.data.data),
  grantEngagementRole: (engagementId: string, body: { userId: string; role: string; assignedModules?: string[] | null }) =>
    api.post(`/engagements/${engagementId}/roles`, body).then((r) => r.data.data),
  revokeEngagementRole: (engagementId: string, userId: string, role: string) =>
    api.delete(`/engagements/${engagementId}/roles`, { data: { userId, role } }).then((r) => r.data.data),

  listAuditLog: (): Promise<RoleAuditEntry[]> =>
    api.get('/firm/role-audit-log').then((r) => r.data.data),
};

// ─── Renewal API (Phase 45.8 + Phase 48.2 firm-wide rollup) ──────────────────

export type RenewalStatus =
  | 'NOT_STARTED'
  | 'DISCUSSING'
  | 'PROPOSAL_OUT'
  | 'SIGNED'
  | 'LOST'
  | 'NA';

export type RenewalUrgency = 'GREEN' | 'AMBER' | 'RED';

export interface ExpansionOpportunity {
  title: string;
  size?: string;
  notes?: string;
}

export interface RenewalRow {
  engagementId: string;
  clientName: string;
  contractStartAt: string | null;
  contractEndAt: string | null;
  renewalStatus: RenewalStatus;
  expansionOpportunities: ExpansionOpportunity[];
  notes: string | null;
  updatedAt: string;
  urgency: RenewalUrgency;
  daysToExpiry: number | null;
  expired: boolean;
}

export interface RenewalState {
  engagementId: string;
  contractStartAt: string | null;
  contractEndAt: string | null;
  renewalStatus: RenewalStatus;
  expansionOpportunities: ExpansionOpportunity[];
  notes: string | null;
  updatedAt: string;
  urgency: RenewalUrgency;
  daysToExpiry: number | null;
  expired: boolean;
}

export const renewalApi = {
  /** Phase 48.2 — firm-wide pipeline view. */
  listFirm: (): Promise<RenewalRow[]> =>
    api.get('/sla/renewals').then((r) => r.data.data as RenewalRow[]),

  /** Phase 45.8 — per-engagement renewal record. */
  get: (engagementId: string): Promise<RenewalState> =>
    api.get(`/engagements/${engagementId}/renewal-state`).then((r) => r.data.data),

  /** Phase 45.8 — partial update; only fields present are written. */
  patch: (
    engagementId: string,
    body: Partial<{
      contractStartAt: string | null;
      contractEndAt: string | null;
      renewalStatus: RenewalStatus;
      expansionOpportunities: ExpansionOpportunity[];
      notes: string | null;
    }>,
  ): Promise<RenewalState> =>
    api.patch(`/engagements/${engagementId}/renewal-state`, body).then((r) => r.data.data),
};

// ─── Tickets API (Phase 45.6 + Phase 48.1 firm-wide rollup) ──────────────────

export type TicketSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type TicketStatus =
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'WAITING_CUSTOMER'
  | 'RESOLVED'
  | 'CLOSED';

export interface Ticket {
  id: string;
  engagementId: string;
  firmId: string;
  title: string;
  description: string | null;
  severity: TicketSeverity;
  status: TicketStatus;
  openedByUserId: string | null;
  openedByMemberId: string | null;
  assigneeUserId: string | null;
  firstResolvedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TicketSlaState {
  firstResponseTargetHours: number;
  resolutionTargetHours: number;
  firstResponseBreached: boolean;
  resolutionBreached: boolean;
  firstResponseMinutesRemaining: number | null;
  resolutionMinutesRemaining: number | null;
}

export interface FirmTicketRow extends Ticket {
  clientName: string;
  sla: TicketSlaState;
}

export interface TicketMessage {
  id: string;
  ticketId: string;
  senderType: 'CLIENT' | 'SUPPORT';
  senderUserId: string | null;
  senderMemberId: string | null;
  body: string;
  createdAt: string;
}

export interface TicketDetail {
  ticket: Ticket;
  messages: TicketMessage[];
  sla: TicketSlaState;
  firstSupportReplyAt: string | null;
}

export const ticketsApi = {
  /** Phase 48.1 — firm-wide tickets queue, with SLA breach state per row. */
  listFirmTickets: (params?: { status?: TicketStatus | 'ALL'; assignee?: string }): Promise<FirmTicketRow[]> =>
    api
      .get('/sla/tickets', { params })
      .then((r) => r.data.data as FirmTicketRow[]),

  /** Phase 45.6 — engagement-scoped list. */
  listForEngagement: (engagementId: string, status?: TicketStatus | 'ALL'): Promise<Ticket[]> =>
    api
      .get(`/engagements/${engagementId}/tickets`, { params: status ? { status } : undefined })
      .then((r) => r.data.data),

  /** Phase 45.6 — open a new ticket (consultant side). */
  create: (
    engagementId: string,
    payload: { title: string; severity: TicketSeverity; description?: string },
  ): Promise<Ticket> =>
    api.post(`/engagements/${engagementId}/tickets`, payload).then((r) => r.data.data),

  /** Phase 45.6 — fetch ticket detail (ticket + messages + sla state). */
  detail: (engagementId: string, ticketId: string): Promise<TicketDetail> =>
    api.get(`/engagements/${engagementId}/tickets/${ticketId}`).then((r) => r.data.data),

  /** Phase 45.6 — append a SUPPORT-side message to the thread. */
  addMessage: (engagementId: string, ticketId: string, body: string): Promise<TicketMessage> =>
    api
      .post(`/engagements/${engagementId}/tickets/${ticketId}/messages`, { body })
      .then((r) => r.data.data),

  /** Phase 45.6 — update status / assignee. */
  patch: (
    engagementId: string,
    ticketId: string,
    body: { status?: TicketStatus; assigneeUserId?: string | null },
  ): Promise<Ticket> =>
    api.patch(`/engagements/${engagementId}/tickets/${ticketId}`, body).then((r) => r.data.data),
};
