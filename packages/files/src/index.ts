/**
 * R2 file and image storage.
 *
 * The database stores an object key and nothing else. Uploads go straight to R2 through a presigned
 * URL (the R2 binding cannot sign, so an S3 API token is required), private downloads go through a
 * Worker route that checks permissions, and deleting a record cleans up its objects.
 */

export {
  cleanupPayload,
  ensureFileCleanupTask,
  fileKeysIn,
  newUploadRecordId,
  sweepOrphans,
  FILE_CLEANUP_TASK,
  type CleanupPayload,
  type OrphanGroup,
  type StorageFactory,
  type SweepOptions,
} from "./cleanup";
export {
  buildFileKey,
  fileFieldsOf,
  filePrefixFor,
  modelPrefixFor,
  keyBelongsTo,
  parseFileKey,
  sanitizeFilename,
  type FileKeyOptions,
  type ParsedFileKey,
} from "./keys";
export {
  createFileStorage,
  FileStorage,
  MAX_PRESIGN_TTL_SECONDS,
  type SignedUpload,
} from "./storage";
