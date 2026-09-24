import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { cache } from "react";
import GithubSlugger from "github-slugger";
import matter from "gray-matter";
import { siteConfig } from "@/site.config";

const CONTENT_DIR = path.join(process.cwd(), "content");
const BLOG_DIR = path.join(CONTENT_DIR, "blog");
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface PostMeta {
  slug: string;
  title: string;
  description: string;
  date: string;
  author: string;
  readTime: string;
  tags: string[];
  featured: boolean;
}

export interface Heading {
  depth: 2 | 3;
  text: string;
  id: string;
}

function toMeta(slug: string, data: Record<string, unknown>): PostMeta {
  const date = data.date instanceof Date ? data.date.toISOString().slice(0, 10) : String(data.date ?? "");
  return {
    slug,
    title: String(data.title ?? slug),
    description: String(data.description ?? ""),
    date,
    author: String(data.author ?? siteConfig.author),
    readTime: String(data.readTime ?? ""),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    featured: data.featured === true,
  };
}

export const getAllPosts = cache(async (): Promise<PostMeta[]> => {
  const files = (await readdir(BLOG_DIR)).filter((f) => f.endsWith(".mdx"));
  const posts = await Promise.all(
    files.map(async (file) => {
      const slug = file.replace(/\.mdx$/, "");
      const { data } = matter(await readFile(path.join(BLOG_DIR, file), "utf8"));
      return toMeta(slug, data);
    }),
  );
  return posts.sort((a, b) => b.date.localeCompare(a.date));
});

export const getPost = cache(async (slug: string): Promise<{ meta: PostMeta; body: string } | null> => {
  if (!SLUG.test(slug)) return null;
  try {
    const { data, content } = matter(await readFile(path.join(BLOG_DIR, `${slug}.mdx`), "utf8"));
    return { meta: toMeta(slug, data), body: content };
  } catch {
    return null;
  }
});

export const getStory = cache(async () => {
  const { data, content } = matter(await readFile(path.join(CONTENT_DIR, "the-story.mdx"), "utf8"));
  const date = data.date instanceof Date ? data.date.toISOString().slice(0, 10) : String(data.date ?? "");
  return { title: String(data.title ?? "Our story"), subtitle: String(data.subtitle ?? ""), date, body: content };
});

/** ## and ### headings with the same ids rehype-slug will generate. */
export function extractHeadings(markdown: string): Heading[] {
  const slugger = new GithubSlugger();
  const headings: Heading[] = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const m = line.match(/^(#{2,3})\s+(.+?)\s*#*\s*$/);
    if (!m) continue;
    const text = m[2].replace(/[*_`]/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
    headings.push({ depth: m[1].length as 2 | 3, text, id: slugger.slug(text) });
  }
  return headings;
}

export function relatedPosts(all: PostMeta[], current: PostMeta, limit = 2): PostMeta[] {
  return all
    .filter((p) => p.slug !== current.slug)
    .map((p) => ({ p, shared: p.tags.filter((t) => current.tags.includes(t)).length }))
    .sort((a, b) => b.shared - a.shared || b.p.date.localeCompare(a.p.date))
    .slice(0, limit)
    .map(({ p }) => p);
}

export function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}
