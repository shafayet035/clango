/**
 * Clango — a Django-style framework for Cloudflare Workers.
 *
 * This package holds the definition layer: `defineModel`, `fields`, `defineApp`, `defineConfig`
 * and the helpers that resolve them into a registry. It has no runtime dependencies and is safe to
 * import inside Workers, tests and the Node-based CLI.
 */

export {
  type AdminActionMeta,
  type AdminFieldMeta,
  type AdminFieldsetMeta,
  type AdminMeta,
  type AdminModelMeta,
  type AdminModelPermissions,
  type AdminRelationMeta,
  type AdminUser,
  type AdminWidget,
} from "./admin";
export {
  modelPermissions,
  PERMISSION_ACTIONS,
  permissionCodename,
  permissionSubject,
  type AuthAdapter,
  type AuthIdentity,
  type ClangoUser,
  type PermissionAction,
  type PermissionCodename,
} from "./auth";
export { defineApp, isApp, type App, type AppConfig } from "./app";
export {
  collectDatabases,
  collectModels,
  collectRegistry,
  defineConfig,
  findModel,
  SYSTEM_APP_LABEL,
  type AdminConfig,
  type AuthConfig,
  type CacheConfig,
  type ClangoConfig,
  type DatabaseConfig,
  type FilesConfig,
  type RegisteredModel,
  type TasksConfig,
  type Registry,
} from "./config";
export { ClangoError, MigrationError, ModelDefinitionError } from "./errors";
export {
  fields,
  type BaseFieldOptions,
  type BooleanFieldOptions,
  type ChoiceFieldOptions,
  type DateFieldOptions,
  type DateTimeFieldOptions,
  type DecimalFieldOptions,
  type Field,
  type FieldInsertValue,
  type FieldIsInsertOptional,
  type FieldKind,
  type FieldMap,
  type FieldValue,
  type FileFieldOptions,
  type ForeignKeyFieldOptions,
  type IntegerFieldOptions,
  type JsonFieldOptions,
  type ManyToManyFieldOptions,
  type ReferentialAction,
  type SlugFieldOptions,
  type StorageClass,
  type StringFieldOptions,
  type TextFieldOptions,
} from "./fields";
export {
  ALL_API_OPS,
  apiOps,
  AUTOMATIC_FIELDS,
  automaticField,
  AUTOMATIC_FIELD_DEFINITIONS,
  columnFor,
  defineModel,
  isModel,
  manyToManyFields,
  resolveField,
  searchableFields,
  type AnyModel,
  type ApiConfig,
  type ApiOp,
  type AutomaticField,
  type ColumnFieldKeys,
  type Model,
  type ModelConfig,
  type ModelInsert,
  type ModelMeta,
  type ModelRow,
  type ModelUpdate,
  type Simplify,
} from "./model";
export { columnNameFor, parseModelName, tableNameFor, toCamelCase, toSnakeCase } from "./naming";
export {
  ADMIN_LOG_ACTIONS,
  ADMIN_LOG_MODEL_NAME,
  AdminLog,
  AUTH_MODELS,
  CLANGO_GROUP_MODEL,
  CLANGO_GROUP_PERMISSION_MODEL,
  CLANGO_USER_GROUP_MODEL,
  CLANGO_USER_MODEL,
  CLANGO_USER_PERMISSION_MODEL,
  type AdminLogAction,
} from "./system";
export { isUlid, newUlid } from "./ulid";
export { VERSION } from "./version";
