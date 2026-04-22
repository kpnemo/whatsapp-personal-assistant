import { MoreHorizontal } from "lucide-react";
import type { JSX } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import type { InvitationRecord } from "../../api/client";

type InviteStatus = "pending" | "used" | "expired";

function getStatus(row: InvitationRecord, now: Date): InviteStatus {
  if (row.usedAt) return "used";
  if (new Date(row.expiresAt).getTime() <= now.getTime()) return "expired";
  return "pending";
}

function formatAbsolute(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

// Best-effort "in N days" / "N days ago" label via Intl.RelativeTimeFormat.
// Zero dependencies; good enough for admin table chrome.
function formatRelative(iso: string, now: Date): string {
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return iso;
  const diffMs = target - now.getTime();
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  const abs = Math.abs(diffMs);
  if (abs < hour) {
    return rtf.format(Math.round(diffMs / minute), "minute");
  }
  if (abs < day) {
    return rtf.format(Math.round(diffMs / hour), "hour");
  }
  return rtf.format(Math.round(diffMs / day), "day");
}

function StatusBadge({ status }: { status: InviteStatus }): JSX.Element {
  if (status === "used") {
    return <Badge variant="secondary">Used</Badge>;
  }
  if (status === "expired") {
    return <Badge variant="outline">Expired</Badge>;
  }
  return <Badge variant="default">Pending</Badge>;
}

function RowActions({ status }: { status: InviteStatus }): JSX.Element {
  // Both menu items are currently informational — the backend doesn't expose a
  // re-fetch or revoke endpoint yet. We wrap the disabled items in Tooltips so
  // admins understand why.
  const copyDisabled = true;
  const revokeDisabled = true;
  return (
    <TooltipProvider delayDuration={200}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="size-8 p-0" aria-label="Row actions">
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuItem
                disabled={copyDisabled}
                onSelect={(event) => {
                  event.preventDefault();
                }}
              >
                Copy link
              </DropdownMenuItem>
            </TooltipTrigger>
            <TooltipContent>Copy link only available immediately after creation.</TooltipContent>
          </Tooltip>
          {status === "pending" ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuItem
                  disabled={revokeDisabled}
                  onSelect={(event) => {
                    event.preventDefault();
                  }}
                >
                  Revoke
                </DropdownMenuItem>
              </TooltipTrigger>
              <TooltipContent>Coming soon.</TooltipContent>
            </Tooltip>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </TooltipProvider>
  );
}

interface InvitationsTableProps {
  rows: InvitationRecord[];
  now?: Date;
}

export function InvitationsTable({ rows, now = new Date() }: InvitationsTableProps): JSX.Element {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Email</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Expires</TableHead>
          <TableHead>Created</TableHead>
          <TableHead className="w-[60px] text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
              No invitations yet. Click "Invite member" to create one.
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => {
            const status = getStatus(row, now);
            const expiresLabel =
              status === "used" && row.usedAt
                ? `used ${formatRelative(row.usedAt, now)}`
                : formatRelative(row.expiresAt, now);
            return (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{row.email}</TableCell>
                <TableCell>
                  <StatusBadge status={status} />
                </TableCell>
                <TableCell title={formatAbsolute(row.expiresAt)} className="text-muted-foreground">
                  {expiresLabel}
                </TableCell>
                <TableCell title={formatAbsolute(row.createdAt)} className="text-muted-foreground">
                  {formatRelative(row.createdAt, now)}
                </TableCell>
                <TableCell className="text-right">
                  <RowActions status={status} />
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}
