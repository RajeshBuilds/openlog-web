import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Page numbers to render, collapsing long ranges with ellipses. */
function getPages(current: number, total: number): (number | "ellipsis")[] {
  const pages: (number | "ellipsis")[] = [1];
  const left = Math.max(2, current - 1);
  const right = Math.min(total - 1, current + 1);

  if (left > 2) pages.push("ellipsis");
  for (let i = left; i <= right; i++) pages.push(i);
  if (right < total - 1) pages.push("ellipsis");
  if (total > 1) pages.push(total);

  return pages;
}

export function Pagination({
  page,
  totalPages,
  hrefFor,
}: {
  page: number;
  totalPages: number;
  hrefFor: (page: number) => string;
}) {
  if (totalPages <= 1) return null;

  const pages = getPages(page, totalPages);
  const edge = cn(buttonVariants({ variant: "outline", size: "sm" }), "bg-card");

  return (
    <nav aria-label="Pagination" className="flex items-center gap-1">
      {page <= 1 ? (
        <span className={cn(edge, "pointer-events-none opacity-50")} aria-disabled>
          <ChevronLeft className="size-3.5" />
          Prev
        </span>
      ) : (
        <Link href={hrefFor(page - 1)} className={edge} rel="prev">
          <ChevronLeft className="size-3.5" />
          Prev
        </Link>
      )}

      <div className="mx-1 flex items-center gap-1">
        {pages.map((p, i) =>
          p === "ellipsis" ? (
            <span
              key={`ellipsis-${i}`}
              className="px-1 text-sm text-muted-foreground"
              aria-hidden
            >
              …
            </span>
          ) : (
            <Link
              key={p}
              href={hrefFor(p)}
              aria-current={p === page ? "page" : undefined}
              className={cn(
                buttonVariants({
                  variant: p === page ? "default" : "outline",
                  size: "icon-sm",
                }),
                "tabular-nums",
                p !== page && "bg-card"
              )}
            >
              {p}
            </Link>
          )
        )}
      </div>

      {page >= totalPages ? (
        <span className={cn(edge, "pointer-events-none opacity-50")} aria-disabled>
          Next
          <ChevronRight className="size-3.5" />
        </span>
      ) : (
        <Link href={hrefFor(page + 1)} className={edge} rel="next">
          Next
          <ChevronRight className="size-3.5" />
        </Link>
      )}
    </nav>
  );
}
