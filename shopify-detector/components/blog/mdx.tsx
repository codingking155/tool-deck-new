import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { compileMDX } from "next-mdx-remote/rsc";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import type { ComponentPropsWithoutRef } from "react";

function CheckCta({ title = "Check any store instantly →" }: { title?: string }) {
  return (
    <div className="my-8 flex flex-col items-start gap-3 rounded-2xl border border-brand/20 bg-success-bg p-5 sm:flex-row sm:items-center sm:justify-between">
      <p className="font-semibold text-ink">Want the answer without opening DevTools?</p>
      <Link href="/" className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-hover">
        {title.replace(/\s*→$/, "")} <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
    </div>
  );
}

const components = {
  h2: (p: ComponentPropsWithoutRef<"h2">) => <h2 className="mb-3 mt-10 scroll-mt-24 text-2xl font-bold tracking-tight text-ink" {...p} />,
  h3: (p: ComponentPropsWithoutRef<"h3">) => <h3 className="mb-2 mt-8 scroll-mt-24 text-xl font-semibold tracking-tight text-ink" {...p} />,
  p: (p: ComponentPropsWithoutRef<"p">) => <p className="my-4 leading-7 text-ink/90" {...p} />,
  a: ({ href = "", ...p }: ComponentPropsWithoutRef<"a">) =>
    href.startsWith("/") ? (
      <Link href={href} className="font-medium text-brand underline underline-offset-4" {...p} />
    ) : (
      <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-brand underline underline-offset-4" {...p} />
    ),
  ul: (p: ComponentPropsWithoutRef<"ul">) => <ul className="my-4 list-disc space-y-2 pl-6 text-ink/90 marker:text-brand" {...p} />,
  ol: (p: ComponentPropsWithoutRef<"ol">) => <ol className="my-4 list-decimal space-y-2 pl-6 text-ink/90 marker:font-semibold marker:text-brand" {...p} />,
  blockquote: (p: ComponentPropsWithoutRef<"blockquote">) => (
    <blockquote className="my-6 rounded-r-xl border-l-4 border-brand bg-gray-100/80 px-5 py-1 text-ink [&>p]:my-3" {...p} />
  ),
  table: (p: ComponentPropsWithoutRef<"table">) => (
    <div className="card my-6 overflow-x-auto">
      <table className="w-full min-w-[32rem] text-left text-sm" {...p} />
    </div>
  ),
  thead: (p: ComponentPropsWithoutRef<"thead">) => <thead className="border-b border-line bg-mint/60" {...p} />,
  th: (p: ComponentPropsWithoutRef<"th">) => <th className="px-4 py-3 font-semibold text-ink" {...p} />,
  td: (p: ComponentPropsWithoutRef<"td">) => <td className="border-t border-line px-4 py-3 align-top text-muted" {...p} />,
  pre: (p: ComponentPropsWithoutRef<"pre">) => (
    <pre className="my-6 overflow-x-auto rounded-2xl bg-[#0d1714] p-4 font-mono text-sm leading-relaxed text-emerald-50 [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-inherit" {...p} />
  ),
  code: (p: ComponentPropsWithoutRef<"code">) => <code className="rounded bg-mint px-1 py-0.5 font-mono text-[0.9em] text-ink" {...p} />,
  hr: () => <hr className="my-10 border-line" />,
  CheckCta,
};

export async function renderMdx(source: string) {
  const { content } = await compileMDX({
    source,
    components,
    options: { mdxOptions: { remarkPlugins: [remarkGfm], rehypePlugins: [rehypeSlug] } },
  });
  return content;
}
