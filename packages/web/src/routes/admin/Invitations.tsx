import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { type JSX, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { invitations } from "../../api/client";
import { InvitationsTable } from "../../components/admin/InvitationsTable";
import { InviteMemberDialog } from "../../components/admin/InviteMemberDialog";

export function AdminInvitations(): JSX.Element {
  const [dialogOpen, setDialogOpen] = useState(false);

  const listQuery = useQuery({
    queryKey: ["invitations"],
    queryFn: () => invitations.list(),
  });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Invitations</h2>
          <p className="text-sm text-muted-foreground">
            Invite family members. They create their account via the generated link and pair their
            own WhatsApp.
          </p>
        </div>
        <Button
          onClick={() => {
            setDialogOpen(true);
          }}
        >
          <Plus className="size-4" aria-hidden="true" />
          Invite member
        </Button>
      </div>

      {listQuery.isError ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Could not load invitations</AlertTitle>
          <AlertDescription>
            Something went wrong fetching the invitation list. Try refreshing the page.
          </AlertDescription>
        </Alert>
      ) : listQuery.isPending ? (
        <div className="flex flex-col gap-2" data-testid="invitations-loading">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : (
        <InvitationsTable rows={listQuery.data} />
      )}

      <InviteMemberDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
