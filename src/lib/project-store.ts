/**
 * Screen-facing facade for the session mock store.
 *
 * Components import the store contract through this module so the mock
 * implementation stays behind the data-layer boundary enforced by ESLint.
 */
export {
  AGENT_QUOTA_LIMIT,
  MAX_UPLOAD_BYTES,
  MockStore,
  STORAGE_LIMIT_BYTES,
  agentRequestsRemaining,
  createSeedState,
  fileExtension,
  fileTypeLabel,
  formatBytes,
  projectDisplayName,
} from "@/lib/mock/store"

export type {
  AgentDiff,
  AgentDiffReview,
  AgentQuota,
  AgentRun,
  AgentRunStatus,
  AgentStep,
  AgentStepStatus,
  ChatChannel,
  ChatChannelKind,
  ChatMessage,
  ChatMessageStatus,
  CreateResult,
  FileKind,
  FileNode,
  FileUpload,
  LabEnvironment,
  LabEnvironmentKind,
  LabSessionStatus,
  MockProject,
  MockState,
  MutationResult,
  RejectedUpload,
  UploadBatchResult,
  UploadFileInput,
  UploadStatus,
} from "@/lib/mock/store"
