/**
 * Commit sermon JSON files to the GitHub repository via the GitHub Contents API.
 * This triggers a Vercel rebuild automatically.
 */

const GITHUB_API = "https://api.github.com";

function getConfig() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token) throw new Error("GITHUB_TOKEN is not configured");
  if (!repo) throw new Error("GITHUB_REPO is not configured");
  return { token, repo };
}

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/**
 * Check whether data/sermons/{sermonId}.json already exists in the repo.
 */
export async function sermonFileExists(sermonId: string): Promise<boolean> {
  const { token, repo } = getConfig();
  const path = `data/sermons/${sermonId}.json`;
  const res = await fetch(`${GITHUB_API}/repos/${repo}/contents/${path}`, {
    headers: headers(token),
  });
  return res.ok;
}

/**
 * Commit a sermon JSON file to data/sermons/{sermonId}.json on the main branch.
 * If the file already exists it will be updated; otherwise it will be created.
 */
export async function commitSermonToGitHub(
  sermonId: string,
  sermonData: Record<string, unknown>,
): Promise<{ sha: string; htmlUrl: string }> {
  const { token, repo } = getConfig();
  const path = `data/sermons/${sermonId}.json`;
  const content = Buffer.from(
    JSON.stringify(sermonData, null, 2) + "\n",
  ).toString("base64");

  // Check if the file already exists (we need its SHA to update)
  let existingSha: string | undefined;
  const getRes = await fetch(
    `${GITHUB_API}/repos/${repo}/contents/${path}`,
    { headers: headers(token) },
  );
  if (getRes.ok) {
    const existing = await getRes.json();
    existingSha = existing.sha;
  }

  // Create or update the file
  const putRes = await fetch(
    `${GITHUB_API}/repos/${repo}/contents/${path}`,
    {
      method: "PUT",
      headers: headers(token),
      body: JSON.stringify({
        message: `Add sermon: ${(sermonData.title as string) || sermonId}`,
        content,
        ...(existingSha ? { sha: existingSha } : {}),
      }),
    },
  );

  if (!putRes.ok) {
    const err = await putRes.text();
    throw new Error(`GitHub commit failed (${putRes.status}): ${err}`);
  }

  const result = await putRes.json();
  return {
    sha: result.content?.sha ?? "",
    htmlUrl: result.content?.html_url ?? "",
  };
}
