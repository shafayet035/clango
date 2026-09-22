import { ClangoError, type FilesConfig } from "@clango/core";
import { AwsClient } from "aws4fetch";

/**
 * R2 signing.
 *
 * The R2 *binding* cannot sign anything, so presigned URLs need an S3 API token: an access key id,
 * a secret, the account id and the bucket name. Those are read from the Worker environment on every
 * call rather than captured at config time, because `clango.config.ts` is evaluated without one.
 *
 * Constraints that shape the API: only `GET`, `HEAD`, `PUT` and `DELETE` can be presigned (no POST
 * multipart forms), expiry is between one second and seven days, and a presigned URL cannot be
 * revoked before it expires — so upload URLs are short-lived and the key is treated as untrusted
 * until the record references it.
 */

/** Longest expiry R2 accepts, in seconds. */
export const MAX_PRESIGN_TTL_SECONDS = 604_800;

/** Puts that never reach this are rejected before signing. */
const MIN_PRESIGN_TTL_SECONDS = 1;

function required<T>(env: object, name: string, what: string): T {
  const value = (env as Record<string, unknown>)[name];
  if (value === undefined || value === "") {
    throw new ClangoError(
      `Missing ${what} "${name}". Declare it in wrangler.jsonc or as a secret.`,
    );
  }
  return value as T;
}

/** A presigned upload target. */
export interface SignedUpload {
  readonly key: string;
  readonly uploadUrl: string;
  /** ISO timestamp after which the URL stops working. */
  readonly expiresAt: string;
}

function clampTtl(seconds: number): number {
  if (
    !Number.isInteger(seconds) ||
    seconds < MIN_PRESIGN_TTL_SECONDS ||
    seconds > MAX_PRESIGN_TTL_SECONDS
  ) {
    throw new ClangoError(
      `Upload URL lifetime must be between ${MIN_PRESIGN_TTL_SECONDS} and ${MAX_PRESIGN_TTL_SECONDS} seconds.`,
    );
  }
  return seconds;
}

/** Signs and performs R2 operations for one environment. */
export class FileStorage {
  private readonly r2: R2Bucket;
  private readonly client: AwsClient;
  private readonly endpoint: string;
  private readonly bucket: string;
  private readonly uploadTtlSeconds: number;

  constructor(env: object, config: FilesConfig) {
    this.r2 = required<R2Bucket>(env, config.binding, "R2 binding");
    this.bucket = config.bucket;
    this.uploadTtlSeconds = clampTtl(config.uploadTtlSeconds ?? 900);
    this.endpoint = `https://${required<string>(env, config.accountId, "account id")}.r2.cloudflarestorage.com`;
    this.client = new AwsClient({
      service: "s3",
      region: "auto",
      accessKeyId: required<string>(env, config.accessKeyId, "access key id"),
      secretAccessKey: required<string>(env, config.secretAccessKey, "secret access key"),
    });
  }

  /** The URL a browser PUTs an upload to, and the key to store on the record afterwards. */
  async signUpload(
    key: string,
    options: { contentType?: string; ttlSeconds?: number } = {},
  ): Promise<SignedUpload> {
    const ttl = clampTtl(options.ttlSeconds ?? this.uploadTtlSeconds);
    const headers: Record<string, string> = {};
    if (options.contentType !== undefined) headers["Content-Type"] = options.contentType;

    const signed = await this.client.sign(
      new Request(`${this.endpoint}/${this.bucket}/${key}?X-Amz-Expires=${ttl}`, {
        method: "PUT",
        headers,
      }),
      // Signing every header pins the declared content type into the URL, so the upload cannot
      // arrive as something else.
      { aws: { signQuery: true, allHeaders: true } },
    );

    return {
      key,
      uploadUrl: signed.url.toString(),
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    };
  }

  /** Streams a stored object, or `null` when it is missing. */
  async object(key: string): Promise<R2ObjectBody | null> {
    return this.r2.get(key);
  }

  /** Reports whether a key exists, without downloading it. */
  async exists(key: string): Promise<boolean> {
    return (await this.r2.head(key)) !== null;
  }

  /** Deletes keys in one round trip. */
  async delete(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.r2.delete([...keys]);
  }

  /**
   * Finds keys written by uploads that were never attached to a record.
   *
   * A presigned URL hands the client a key before the record exists, so an abandoned upload leaves
   * an unreferenced object. Sweeping a prefix is the only way to find them: it lists the keys and
   * returns those no record claims.
   */
  async orphans(
    prefix: string,
    keep: (key: string, uploaded: Date) => Promise<boolean>,
    options: { readonly limit?: number } = {},
  ): Promise<readonly string[]> {
    const limit = options.limit ?? 1000;
    const orphans: string[] = [];
    let cursor: string | undefined;

    while (orphans.length < limit) {
      const listed = await this.r2.list({
        prefix,
        limit: 1000,
        ...(cursor === undefined ? {} : { cursor }),
      });
      for (const object of listed.objects) {
        if (await keep(object.key, object.uploaded)) continue;
        orphans.push(object.key);
        if (orphans.length >= limit) break;
      }
      cursor = listed.truncated ? listed.cursor : undefined;
      if (cursor === undefined) break;
    }

    return orphans;
  }
}

/** Creates storage for one environment. */
export function createFileStorage(env: object, config: FilesConfig): FileStorage {
  return new FileStorage(env, config);
}
