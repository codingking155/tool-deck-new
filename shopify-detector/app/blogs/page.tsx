import type { Metadata } from "next";
import PostCard from "@/components/blog/PostCard";
import { getAllPosts } from "@/lib/content";
import { siteConfig } from "@/site.config";

export const metadata: Metadata = {
  title: "Blog — Guides, Benchmarks, and Stories",
  description: `Guides on detecting Shopify stores, qualifying leads and automating sales workflows, from the ${siteConfig.brand} team.`,
  alternates: { canonical: "/blogs" },
};

export default async function BlogIndex() {
  const posts = await getAllPosts();
  const featured = posts.find((p) => p.featured) ?? posts[0];
  const rest = posts.filter((p) => p !== featured);

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 pb-16 pt-10 sm:px-6 sm:pt-14">
      <section className="flex flex-col gap-6 rounded-3xl bg-gradient-to-br from-[#0b2a22] to-[#123a2f] p-8 text-white shadow-xl sm:flex-row sm:items-end sm:justify-between sm:p-10">
        <div className="max-w-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">{siteConfig.brand} blog</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Guides, Benchmarks, and Stories</h1>
          <p className="mt-3 text-emerald-50/85">
            Practical playbooks for Shopify app teams: how detection works, how to qualify leads faster, and how to automate the boring parts.
          </p>
          <p className="mt-4 text-sm text-emerald-100/80">
            {posts.length} article{posts.length === 1 ? "" : "s"} • Built for sales and product teams
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-2 self-start rounded-full border border-white/20 bg-white/10 px-3 py-1 text-sm font-medium sm:self-auto">
          <span className="size-2 rounded-full bg-emerald-400" aria-hidden="true" /> Updated regularly
        </span>
      </section>

      {featured && <PostCard post={featured} featured />}

      {rest.length > 0 && (
        <div className="grid gap-6 md:grid-cols-2">
          {rest.map((p) => (
            <PostCard key={p.slug} post={p} />
          ))}
        </div>
      )}
    </div>
  );
}
