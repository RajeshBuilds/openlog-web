import Link from "next/link";
import { Activity } from "lucide-react";

import { cn } from "@/lib/utils";

/** Sticky top chrome shared by all pages: logo (links home) + optional
 *  breadcrumb children + right-aligned slot. */
export function AppHeader({
  containerClassName,
  children,
  right,
}: {
  containerClassName?: string;
  children?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur-md">
      <div
        className={cn(
          "mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-6",
          containerClassName
        )}
      >
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Activity className="size-4" strokeWidth={2.5} />
          </div>
          <span className="text-[15px] font-semibold tracking-tight">
            OpenLog
          </span>
        </Link>
        {children}
        {right && (
          <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2">
            {right}
          </div>
        )}
      </div>
    </header>
  );
}
