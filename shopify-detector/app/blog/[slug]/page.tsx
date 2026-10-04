import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { renderMdx } from "@/components/blog/mdx";
import PostCard, { Byline, Tags } from "@/components/blog/PostCard";
import { extractHeadings, getAllPosts, getPost, relatedPosts } from "@/lib/content";
import { siteConfig } from "@/site.config";

export const dynamicParams = false;

export async function generateStaticParams() {
  return (await getAllPosts()).map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: PageProps<"/blog/[slug]">): Promise<Metadata> {
  const post = await getPost((await params).slug);
  if (!post) return {};
  const { meta } = post;
  return {
    title: meta.title,
    description: meta.description,
    alternates: { canonical: `/blog/${meta.slug}` },
    authors: [{ name: meta.author }],
    openGraph: { type: "article", title: meta.title, description: meta.description, publishedTime: meta.date, tags: meta.tags },
  };
}

export default async function PostPage({ params }: PageProps<"/blog/[slug]">) {
  const post = await getPost((await params).slug);
  if (!post) notFound();
  const { meta, body } = post;
  const [content, all] = await Promise.all([renderMdx(body), getAllPosts()]);
  const headings = extractHeadings(body);
  const related = relatedPosts(all, meta);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: meta.title,
    description: meta.description,
    datePublished: meta.date,
    author: { "@type": "Organization", name: meta.author },
    publisher: { "@type": "Organization", name: siteConfig.brand },
    mainEntityOfPage: `${siteConfig.siteUrl}/blog/${meta.slug}`,
    keywords: meta.tags.join(", "),
  };

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:px-6 sm:pt-14">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_14rem] lg:gap-12">
        <article className="mx-auto w-full max-w-2xl lg:mx-0">
          <Link href="/blogs" className="text-sm font-medium text-brand hover:underline">
            ← All articles
          </Link>
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.2em] text-brand">Article{meta.readTime && ` · ${meta.readTime}`}</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl">{meta.title}</h1>
          <p className="mt-4 text-lg text-muted">{meta.description}</p>
          <div className="mt-5 flex flex-wrap items-center gap-3 border-b border-line pb-6">
            <Byline post={meta} />
            <Tags tags={meta.tags} />
          </div>
          <div className="mt-2">{content}</div>
        </article>

        {headings.length > 0 && (
          <aside className="hidden lg:block">
            <nav aria-label="Table of contents" className="sticky top-24">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted">On this page</p>
              <ol className="space-y-2 border-l border-line text-sm">
                {headings.map((h) => (
                  <li key={h.id} className={h.depth === 3 ? "pl-6" : "pl-3"}>
                    <a href={`#${h.id}`} className="text-muted hover:text-brand">
                      {h.text}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </aside>
        )}
      </div>

      {related.length > 0 && (
        <section aria-labelledby="related" className="mt-16 border-t border-line pt-10">
          <h2 id="related" className="mb-6 text-2xl font-bold tracking-tight text-ink">
            Related posts
          </h2>
          <div className="grid gap-6 md:grid-cols-2">
            {related.map((p) => (
              <PostCard key={p.slug} post={p} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
