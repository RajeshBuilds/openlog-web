import Link from "next/link";
import { SearchX } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-1 flex-col bg-muted/40">
      <AppHeader />
      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <SearchX className="size-5" />
        </div>
        <div className="space-y-1">
          <h1 className="text-lg font-semibold tracking-tight">
            Page not found
          </h1>
          <p className="text-sm text-muted-foreground">
            The session may have been deleted, or the link is wrong.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="bg-card"
          nativeButton={false}
          render={<Link href="/" />}
        >
          Back to sessions
        </Button>
      </main>
    </div>
  );
}
