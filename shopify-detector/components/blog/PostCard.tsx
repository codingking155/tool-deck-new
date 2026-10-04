import Link from "next/link";
import { formatDate, type PostMeta } from "@/lib/content";

export function Tags({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
      {tags.map((t) => (
        <li key={t} className="rounded-full border border-line bg-white/80 px-2.5 py-0.5 text-xs font-medium text-muted">
          #{t}
        </li>
      ))}
    </ul>
  );
}

export function Byline({ post }: { post: PostMeta }) {
  return (
    <p className="text-sm text-muted">
      {post.author} • <time dateTime={post.date}>{formatDate(post.date)}</time>
    </p>
  );
}

export default function PostCard({ post, featured = false }: { post: PostMeta; featured?: boolean }) {
  return (
    <article className={`card group relative flex flex-col gap-3 p-6 transition-shadow hover:shadow-lg ${featured ? "sm:p-8" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        {featured ? (
          <span className="rounded-full bg-brand px-2.5 py-0.5 text-xs font-semibold text-white">Featured</span>
        ) : (
          <span className="text-xs font-semibold tracking-[0.18em] text-brand">ARTICLE</span>
        )}
        {featured && post.readTime && (
          <span className="rounded-full bg-success-bg px-2.5 py-0.5 text-xs font-medium text-brand">{post.readTime}</span>
        )}
      </div>
      <h2 className={`font-bold tracking-tight text-ink ${featured ? "text-2xl sm:text-3xl" : "text-xl"}`}>
        <Link href={`/blog/${post.slug}`} className="after:absolute after:inset-0 after:rounded-2xl group-hover:text-brand">
          {post.title}
        </Link>
      </h2>
      <p className="text-muted">{post.description}</p>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-2">
        <Byline post={post} />
        <Tags tags={post.tags} />
      </div>
    </article>
  );
}
