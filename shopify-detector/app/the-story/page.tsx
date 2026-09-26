import type { Metadata } from "next";
import { renderMdx } from "@/components/blog/mdx";
import { formatDate, getStory } from "@/lib/content";
import { siteConfig } from "@/site.config";

export async function generateMetadata(): Promise<Metadata> {
  const story = await getStory();
  return {
    title: "The Story",
    description: story.subtitle || `How and why ${siteConfig.brand} was built.`,
    alternates: { canonical: "/the-story" },
  };
}

export default async function StoryPage() {
  const story = await getStory();
  const body = await renderMdx(story.body);

  return (
    <article className="mx-auto max-w-2xl px-4 pb-16 pt-10 sm:px-6 sm:pt-16">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">Origin story</p>
      <h1 className="mt-3 text-4xl font-bold tracking-tight text-ink sm:text-5xl">{story.title}</h1>
      {story.subtitle && <p className="mt-4 text-lg text-muted">{story.subtitle}</p>}
      {story.date && (
        <p className="mt-4 text-sm text-muted">
          Published on <time dateTime={story.date}>{formatDate(story.date)}</time>
        </p>
      )}
      <div className="mt-8 border-t border-line pt-4 [&_blockquote]:border-l-4 [&_blockquote]:italic">{body}</div>
      <p className="mt-10 font-semibold text-ink">— {siteConfig.author}</p>
    </article>
  );
}
