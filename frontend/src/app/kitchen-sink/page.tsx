import { ConfirmDialogDemo } from "@/app/kitchen-sink/ConfirmDialogDemo";
import { InviteChipsDemo } from "@/app/kitchen-sink/InviteChipsDemo";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

export default function KitchenSinkPage() {
  return (
    <div className="mx-auto max-w-3xl w-full p-10 flex flex-col gap-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Kitchen sink</h1>
        <ThemeToggle />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-text-muted">Buttons</h2>
        <div className="flex flex-wrap gap-3">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
          <Button variant="primary" size="sm">
            Small
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-3 max-w-sm">
        <h2 className="text-sm font-semibold text-text-muted">Inputs</h2>
        <Input label="Email" placeholder="you@example.com" />
        <PasswordInput label="Password" placeholder="••••••••" />
        <PasswordInput label="Password" error="Password is required." />
        <Select label="Role" defaultValue="Editor">
          <option value="Owner">Owner</option>
          <option value="Editor">Editor</option>
          <option value="Viewer">Viewer</option>
        </Select>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-text-muted">Invite chips</h2>
        <InviteChipsDemo />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-text-muted">Confirm dialog</h2>
        <ConfirmDialogDemo />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-text-muted">Skeleton</h2>
        <p className="text-xs text-text-dim">
          Shape comes from the caller — it has to occupy exactly the space its content will.
          Stops pulsing under <code>prefers-reduced-motion</code>.
        </p>
        <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3.5">
          <Skeleton className="w-8 h-8 rounded-full shrink-0" />
          <div className="flex-1 flex flex-col gap-1.5">
            <Skeleton className="h-3 w-32 rounded" />
            <Skeleton className="h-2.5 w-48 rounded" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full shrink-0" />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-text-muted">Avatars</h2>
        <div className="flex items-center gap-2">
          <Avatar name="Yash P." size="sm" />
          <Avatar name="Sara R." />
          <Avatar name="Alex" />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-text-muted">Badges (roles)</h2>
        <div className="flex gap-2">
          <Badge tone="accent">Owner</Badge>
          <Badge tone="neutral">Editor</Badge>
          <Badge tone="neutral">Viewer</Badge>
          <Badge tone="success">Synced</Badge>
          <Badge tone="warn">Reconnecting</Badge>
          <Badge tone="danger">Error</Badge>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-text-muted">Card shell</h2>
        <Card className="p-4 max-w-sm">
          <p className="text-sm font-medium">WebSocket reconnection logic</p>
          <p className="text-xs text-text-muted mt-1">
            Exponential backoff with jitter on disconnect events
          </p>
        </Card>
      </section>
    </div>
  );
}
