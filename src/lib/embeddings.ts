import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";

const EMBEDDING_PROVIDER = process.env.EMBEDDING_PROVIDER || "openai";
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";

/**
 * Generate embeddings for a list of texts using the configured provider.
 *
 * Set EMBEDDING_PROVIDER=pinecone to use Pinecone's hosted inference API,
 * or EMBEDDING_PROVIDER=openai (default) for OpenAI.
 */
export async function embed(
  texts: string[],
  inputType: "passage" | "query" = "query"
): Promise<number[][]> {
  if (EMBEDDING_PROVIDER === "pinecone") {
    return embedViaPinecone(texts, inputType);
  }
  return embedViaOpenAI(texts);
}

async function embedViaOpenAI(texts: string[]): Promise<number[][]> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });
  return res.data.map((d) => d.embedding);
}

async function embedViaPinecone(
  texts: string[],
  inputType: "passage" | "query"
): Promise<number[][]> {
  const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  const res = await pinecone.inference.embed(EMBEDDING_MODEL, texts, {
    inputType,
  });
  return res.data.map((d) => d.values as number[]);
}
