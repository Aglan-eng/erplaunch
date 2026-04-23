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
};

// ─── Engagements ─────────────────────────────────────────────────────────────

export const engagementsApi = {
  list: () => api.get('/engagements').then((r) => r.data.data),

  create: (input: { clientName: string; adaptorId?: string }) =>
    api.post('/engagements', input).then((r) => r.data.data),

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
