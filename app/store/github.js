// A GitHub Contents API client, just big enough for sync (SPEC Phase 7).
//
// The token is a fine-grained personal access token scoped to this one
// repository with Contents: read and write, and nothing else. It is held in
// IndexedDB on the device that entered it and is never exported, never synced
// and never committed — see db.js's `meta` store.
//
// `fetch` is injected so the whole thing is testable under Node against a fake
// transport, with no network and no token.

export const API_ROOT = 'https://api.github.com';

/** GitHub stops inlining file content in the Contents API at 1 MB. */
export const INLINE_LIMIT_BYTES = 1024 * 1024;

export class GitHubError extends Error {
  constructor(message, { status = 0, path = null } = {}) {
    super(message);
    this.status = status;
    this.path = path;
  }
}

export class ConflictError extends GitHubError {}

/** A repository with no commits at all has no branch to write a file onto. */
export class EmptyRepoError extends GitHubError {}

const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');

/**
 * GitHub wraps base64 at 60 characters. atob tolerates the newlines; being
 * explicit costs nothing and has bitten every client that assumed otherwise.
 */
const unwrap = (text) => (text ?? '').replace(/\s+/g, '');

export function createClient({
  owner, repo, branch = 'main', token, fetch: fetchImpl = globalThis.fetch,
}) {
  if (!owner || !repo) throw new Error('Sync needs an owner and a repository.');
  if (!token) throw new Error('Sync needs a token.');

  const call = async (path, { method = 'GET', body, accept } = {}) => {
    const response = await fetchImpl(`${API_ROOT}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: accept ?? 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (response.status === 404) return { missing: true, status: 404 };
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw errorFor(response.status, detail, path);
    }
    return response.json();
  };

  return {
    owner,
    repo,
    branch,

    /** The file's content and sha, or `{ missing: true }` if it is not there. */
    async read(path) {
      const meta = await call(`/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`);
      if (meta.missing) return meta;
      if (Array.isArray(meta)) throw new GitHubError(`${path} is a directory, not a file.`, { path });

      // Over 1 MB the Contents API returns metadata with no content. The Blob
      // API carries the same file up to 100 MB, addressed by the sha we just
      // read, so photo bundles still come back.
      if (meta.encoding === 'base64' && meta.content) {
        return { sha: meta.sha, size: meta.size, text: decodeBase64(unwrap(meta.content)) };
      }
      const blob = await call(`/repos/${owner}/${repo}/git/blobs/${meta.sha}`);
      if (blob.missing) return { missing: true, status: 404 };
      return { sha: meta.sha, size: meta.size, text: decodeBase64(unwrap(blob.content)) };
    },

    /**
     * Create or replace a file. `sha` is the version being replaced; GitHub
     * rejects the write with 409 or 422 if the file moved on in the meantime,
     * which is the whole point — a second device's work is never clobbered.
     */
    async write(path, text, { sha = null, message }) {
      const result = await call(`/repos/${owner}/${repo}/contents/${encodePath(path)}`, {
        method: 'PUT',
        body: {
          message,
          content: encodeBase64(text),
          branch,
          ...(sha ? { sha } : {}),
        },
      });
      if (result.missing) throw new GitHubError(`Could not write ${path}.`, { status: 404, path });
      return { sha: result.content?.sha ?? null, commit: result.commit?.sha ?? null };
    },

    /** Files directly inside a directory, or [] when it does not exist yet. */
    async list(dir) {
      const result = await call(`/repos/${owner}/${repo}/contents/${encodePath(dir)}?ref=${encodeURIComponent(branch)}`);
      if (result.missing) return [];
      if (!Array.isArray(result)) throw new GitHubError(`${dir} is a file, not a directory.`, { path: dir });
      return result.filter((entry) => entry.type === 'file').map((entry) => ({
        name: entry.name, path: entry.path, sha: entry.sha, size: entry.size,
      }));
    },
  };
}

function errorFor(status, detail, path) {
  // A repository created without a README has no commits and no default
  // branch, and GitHub reports that as a 409 — the same status as a stale sha.
  // Reading it as a conflict sends you to pull from a repository that has
  // nothing in it, which is the first thing anyone setting sync up would hit.
  if (/repository is empty/i.test(detail || '')) {
    return new EmptyRepoError(
      'That repository has no commits yet, so there is no branch to write to. '
      + 'Add a README to it on GitHub — one file is enough — and try again.',
      { status, path },
    );
  }
  if (status === 409 || status === 422) {
    return new ConflictError(
      'That file changed on GitHub since this device last read it. Pull first, then push.',
      { status, path },
    );
  }
  if (status === 401) return new GitHubError('GitHub rejected the token. Check it has not expired.', { status, path });
  if (status === 403) {
    return new GitHubError(
      'GitHub refused the request. The token needs Contents: read and write on this repository.',
      { status, path },
    );
  }
  const short = (detail || '').slice(0, 200);
  return new GitHubError(`GitHub returned ${status}${short ? `: ${short}` : ''}`, { status, path });
}

// Text is UTF-8 first, then base64 — btoa alone mangles anything non-ASCII,
// and titles carry en dashes and accents.
export function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

export function decodeBase64(text) {
  if (typeof Buffer !== 'undefined') return Buffer.from(text, 'base64').toString('utf8');
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
