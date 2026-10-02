import { getAllPosts, getPost } from "@/lib/content";
import { OG_SIZE, renderOgImage } from "@/lib/og";

export const alt = "Blog post";
export const size = OG_SIZE;
export const contentType = "image/png";

export async function generateStaticParams() {
  return (await getAllPosts()).map((p) => ({ slug: p.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const post = await getPost((await params).slug);
  return renderOgImage({ eyebrow: "Blog", title: post?.meta.title ?? "Blog", subtitle: post?.meta.readTime });
}
