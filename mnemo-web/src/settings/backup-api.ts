import { apiFetch, apiFetchOptional, apiSend } from "@/api/client"
import { exportRequest } from "@/api/export-file"

export interface BackupContents {
  notes: number
  noteFolders: number
  flashcardDecks: number
  flashcardCards: number
  flashcardTestAttempts: number
  mindmaps: number
  mindmapFolders: number
  trashEntries: number
  conversations: number
  managedFiles: number
  portableSettings: number
}

export interface BackupInspection {
  createdAtUtc: string
  createdByAppVersion: string
  fromThisCollection: boolean
  contents: BackupContents
}

export interface BackupSelection {
  available: boolean
  cancelled: boolean
  grant: string | null
  inspection: BackupInspection | null
}

export interface RestoreStage {
  operationId: string
}

export interface RestoreState {
  staged: boolean
  restartRequested: boolean
}

export interface RestoreStatus {
  success: boolean
  code: string
  recoveryDirectoryName: string | null
  backupCreatedAtUtc: string | null
  backupAppVersion: string | null
}

export function requestBackupExport(grant: string | null): Promise<Response> {
  return exportRequest("/backups/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant }),
  })
}

export function selectBackup(title: string): Promise<BackupSelection> {
  return apiFetch<BackupSelection>("/backups/select", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  })
}

export function stageBackupRestore(grant: string): Promise<RestoreStage> {
  return apiFetch<RestoreStage>("/backups/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant }),
  })
}

export function restartForBackupRestore(operationId: string): Promise<void> {
  return apiSend("/backups/restore/restart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operationId }),
  })
}

export function getBackupRestoreState(operationId: string): Promise<RestoreState> {
  return apiFetch<RestoreState>(`/backups/restore/${encodeURIComponent(operationId)}/state`)
}

export function cancelBackupRestore(operationId: string): Promise<void> {
  return apiSend(`/backups/restore/${encodeURIComponent(operationId)}`, { method: "DELETE" })
}

export function consumeRestoreStatus(): Promise<RestoreStatus | null> {
  return apiFetchOptional<RestoreStatus>("/backups/restore-status")
}
