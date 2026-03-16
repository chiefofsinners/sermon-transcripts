import OpenAI from "openai";

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";

/**
 * Generate embeddings for a list of texts using OpenAI.
 */
export async function embed(
  texts: string[],
  inputType: "passage" | "query" = "query"
): Promise<number[][]> {
  // inputType is kept for API compatibility but OpenAI doesn't use it
  void inputType;
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });
  return res.data.map((d) => d.embedding);
}
