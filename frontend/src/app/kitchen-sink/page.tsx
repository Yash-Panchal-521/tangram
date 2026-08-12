import { ConfirmDialogDemo } from "@/app/kitchen-sink/ConfirmDialogDemo";
import { CardDetailDemo } from "@/app/kitchen-sink/CardDetailDemo";
import { MenuDemo } from "@/app/kitchen-sink/MenuDemo";
import { SelectMenuDemo } from "@/app/kitchen-sink/SelectMenuDemo";
import { DatePickerDemo } from "@/app/kitchen-sink/DatePickerDemo";
import { InlineEditDemo } from "@/app/kitchen-sink/InlineEditDemo";
import { InviteChipsDemo } from "@/app/kitchen-sink/InviteChipsDemo";
import { BoardSkeleton } from "@/components/board/BoardSkeleton";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { PriorityIcon } from "@/components/ui/PriorityIcon";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { ThemePicker } from "@/components/ui/ThemePicker";

export default function KitchenSinkPage() {
  return (
    <div className="mx-auto max-w-3xl w-full p-10 flex flex-col gap-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Kitchen sink</h1>
        <ThemeToggle />
      </div>

      <section className="flex flex-col gap-3 max-w-sm">
        <h2 className="text-sm font-semibold text-text-muted">Theme</h2>
        <p className="text-xs text-text-dim">
          Every surface in the app is built on the same token names, so switching palettes
          changes one attribute on <code>&lt;html&gt;</code> and nothing else — no component
          knows a colour. This page is the fastest way to judge one: it holds every primitive at
          once. Each swatch is painted in its <em>own</em> palette rather than the active one,
          which is the only way a picker can answer &ldquo;which of these do I want&rdquo;.
        </p>
        <ThemePicker />
      </section>

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

      <section className="flex flex-col gap-3 max-w-sm">
        <h2 className="text-sm font-semibold text-text-muted">Inline edit</h2>
        <p className="text-xs text-text-dim">
          Reads as text, edits in place. Enter or blur commits, Escape reverts — and Escape is
          contained, so a dialog above stays open. A failed save reverts and says why{" "}
          <em>next to the field</em>, because with each field saving on its own, &ldquo;that
          didn&apos;t save&rdquo; means nothing unless it names which one.
        </p>
        <InlineEditDemo />
      </section>

      <section className="flex flex-col gap-3 max-w-sm">
        <h2 className="text-sm font-semibold text-text-muted">Date picker</h2>
        <p className="text-xs text-text-dim">
          Replaces <code>&lt;input type=&quot;date&quot;&gt;</code>, whose calendar is the
          browser&apos;s and takes none of the app&apos;s tokens. Arrow keys move a day, Page
          moves a month, Home and End reach the ends of the week.
        </p>
        <DatePickerDemo />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-text-muted">Card detail</h2>
        <p className="text-xs text-text-dim">
          Two columns, as Jira lays out a work item: the description on the left because it is
          what the work <em>is</em>, the context fields on the right because they are what you
          sort and filter by. Every field saves on its own — there is no Save button for the
          card — and a failure lands on the field that caused it. Below 1024px it becomes a
          full-screen sheet and the columns stack. Here because it is otherwise unreachable
          without signing in and opening a board.
        </p>
        <p className="text-xs text-text-dim">
          The label picker both applies labels and manages the board&apos;s vocabulary, because a
          label is nearly always invented at the moment someone wants to apply it — sending them
          to a settings screen first is how labels end up unused.
        </p>
        <p className="text-xs text-text-dim">
          The comment thread runs oldest-first under the description, with the composer above
          it — reversed from a chat window because the card is read top to bottom rather than
          scrolled, so the conversation continues the order the card already started. Ctrl or ⌘
          plus Enter sends; a bare Enter makes a paragraph. Edit and delete appear on your own
          comments only, and a failed send keeps the draft.
        </p>
        <CardDetailDemo />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-text-muted">Select field</h2>
        <p className="text-xs text-text-dim">
          Draws its own list instead of using <code>&lt;select&gt;</code>. The native control was
          chosen for one reason — keyboard and mobile behaviour for free — and the cost turned out
          to be worse: the option list is painted by the operating system, so it arrives as a white
          box with a system-blue highlight in a warm-toned app, and an <code>&lt;option&gt;</code>
          can hold text and nothing else, so neither the priority icon nor an assignee&apos;s
          avatar could appear in it. The keyboard contract is implemented here instead — arrows
          move, Home and End reach the ends, Enter chooses, Escape closes without choosing and
          hands focus back. Picking the value that is already set sends nothing.
        </p>
        <SelectMenuDemo />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-text-muted">Overflow menu</h2>
        <p className="text-xs text-text-dim">
          The <code>⋯</code> behind the card&apos;s and each column&apos;s actions. Two things it
          gets right that are easy to miss: it positions itself <em>fixed</em>, measured from the
          trigger, because the board area is <code>overflow-y-hidden</code> and an absolutely
          positioned dropdown is clipped by an ancestor several levels up; and it registers with{" "}
          <code>useDialog</code> so Escape closes it rather than the modal behind it. Selecting an
          item does not close it automatically — &ldquo;Copy link&rdquo; needs to stay open, because
          the label changing is the only confirmation it worked.
        </p>
        <div className="flex items-center gap-3">
          <MenuDemo />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-text-muted">Board skeleton</h2>
        <p className="text-xs text-text-dim">
          Here so its header can be compared against the loaded one by eye. It drifted once
          without anyone noticing — the skeleton still described the header as it stood before
          the activity feed, the workspace home and the account menu existed, and three
          controls appeared out of nowhere on arrival.
        </p>
        <div className="h-[260px] flex rounded-lg border border-border overflow-hidden">
          <BoardSkeleton />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-text-muted">Priority</h2>
        <p className="text-xs text-text-dim">
          Direction carries the meaning, colour reinforces it, and the extremes are doubled.
          Five levels rendered only in shades of red would be indistinguishable to anyone who
          can&apos;t separate them — and on a card face this icon is often 13px with no label.
        </p>
        <div className="flex items-center gap-5">
          {(["Highest", "High", "Medium", "Low", "Lowest"] as const).map((p) => (
            <span key={p} className="flex items-center gap-1.5 text-[11px] text-text-muted">
              <PriorityIcon priority={p} size={14} />
              {p}
            </span>
          ))}
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
