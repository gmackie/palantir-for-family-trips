"use client";

import { Button } from "@gmacko/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@gmacko/ui/dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { useTRPC } from "~/trpc/react";

interface WorkspaceSwitcherProps {
  currentWorkspaceSlug: string | null;
}

export function WorkspaceSwitcher({ currentWorkspaceSlug }: WorkspaceSwitcherProps) {
  const router = useRouter();
  const trpc = useTRPC();
  const { data: workspaces, isLoading } = useQuery(
    trpc.settings.listMyWorkspaces.queryOptions(),
  );

  if (isLoading || !workspaces) {
    return (
      <Button variant="outline" size="sm" disabled>
        Loading workspaces…
      </Button>
    );
  }

  // Hide entirely if the user only has one workspace — nothing to switch to.
  if (workspaces.length <= 1) {
    return null;
  }

  const current =
    workspaces.find((w) => w.slug === currentWorkspaceSlug) ?? workspaces[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-[14rem] truncate">
          <span className="truncate">{current?.name ?? "Workspaces"}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-xs uppercase tracking-wider text-muted-foreground">
          Switch workspace
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {workspaces.map((workspace) => (
          <DropdownMenuItem
            key={workspace.id}
            onSelect={() => {
              router.push(`/w/${workspace.slug}`);
            }}
            className="flex items-center justify-between gap-2"
          >
            <span className="truncate">{workspace.name}</span>
            {workspace.slug === current?.slug ? (
              <span className="text-xs text-muted-foreground">current</span>
            ) : (
              <span className="text-xs uppercase text-muted-foreground">
                {workspace.role}
              </span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
