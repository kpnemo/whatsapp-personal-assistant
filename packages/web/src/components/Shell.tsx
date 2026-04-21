import { ChevronDown, LayoutDashboard, Mail, ShieldOff, Smartphone } from "lucide-react";
import { type JSX, type ReactNode, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { apiFetch, ApiError } from "../api/client";
import { useAuth } from "../stores/auth";

import { ThemeToggle } from "./theme-toggle";

interface NavItem {
  to: string;
  label: string;
  Icon: typeof LayoutDashboard;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", Icon: LayoutDashboard },
  { to: "/pair", label: "Pair WhatsApp", Icon: Smartphone },
  { to: "/admin/invitations", label: "Invitations", Icon: Mail, adminOnly: true },
];

function initialsFor(email: string): string {
  const trimmed = email.trim();
  if (!trimmed) return "?";
  return trimmed.charAt(0).toUpperCase();
}

function UserMenu({ email, onSignOut }: { email: string; onSignOut: () => void }): JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2 px-2" aria-label="User menu">
          <Avatar size="sm">
            <AvatarFallback>{initialsFor(email)}</AvatarFallback>
          </Avatar>
          <span className="hidden max-w-[160px] truncate text-sm sm:inline">{email}</span>
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[12rem]">
        <DropdownMenuLabel className="truncate">{email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>Profile</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            onSignOut();
          }}
        >
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function KillSwitch(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function confirmKill(): Promise<void> {
    setPending(true);
    try {
      await apiFetch("/kill", { method: "POST" });
      toast.success("Kill switch armed — assistant muted globally.");
      setOpen(false);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "unknown error";
      toast.error(`Failed to mute: ${message}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm" className="gap-1.5">
          <ShieldOff className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">Kill switch</span>
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Mute the assistant globally?</AlertDialogTitle>
          <AlertDialogDescription>
            This disables all AI replies across every paired conversation until you restore. P3 will
            also close Baileys sockets; today only the Redis flag is flipped.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={(event) => {
              event.preventDefault();
              void confirmKill();
            }}
          >
            {pending ? "Muting…" : "Mute assistant"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Sidebar({ isAdmin }: { isAdmin: boolean }): JSX.Element {
  const { pathname } = useLocation();
  const items = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);

  return (
    <aside className="w-60 shrink-0 border-r border-border bg-muted/30 p-3">
      <p className="px-2 pt-1 pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Navigation
      </p>
      <nav className="flex flex-col gap-1">
        {items.map(({ to, label, Icon, adminOnly }) => {
          const active = pathname === to || (to !== "/" && pathname.startsWith(to));
          return (
            <Button
              key={to}
              asChild
              variant={active ? "secondary" : "ghost"}
              size="sm"
              className="justify-start"
            >
              <Link to={to}>
                <Icon className="size-4" aria-hidden="true" />
                <span>{label}</span>
                {adminOnly ? (
                  <Badge variant="outline" className="ml-auto">
                    Admin
                  </Badge>
                ) : null}
              </Link>
            </Button>
          );
        })}
      </nav>
    </aside>
  );
}

export function Shell({ children }: { children: ReactNode }): JSX.Element {
  const { me, logout } = useAuth();
  const nav = useNavigate();

  async function handleSignOut(): Promise<void> {
    await logout();
    void nav("/login", { replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold sm:text-base">WhatsApp Personal Assistant</h1>
          <Badge variant="outline" className="text-[10px] uppercase">
            P0
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <KillSwitch />
          {me ? (
            <UserMenu
              email={me.email}
              onSignOut={() => {
                void handleSignOut();
              }}
            />
          ) : null}
        </div>
      </header>
      <div className="flex flex-1">
        <Sidebar isAdmin={me?.role === "admin"} />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
